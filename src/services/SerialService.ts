/**
 * Web Serial API 封装
 * 负责串口连接、JSON 行协议收发、ESP_LOG 噪声过滤
 *
 * 固件背景：
 * - ESP32-S3 的 USB Serial/JTAG 通道同时承载 JSON 协议数据 + ESP_LOG 输出
 *   (sdkconfig: CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG=y)
 * - JSON 由 cJSON_PrintUnformatted() 生成，始终单行、{ 开头 } 结尾
 * - ESP_LOG 格式: X (timestamp) TAG: message (X∈{E,W,I,D,V})
 * - 此外还有 watchdog/backtrace/panic/boot 等系统输出
 */

export interface SerialOptions {
  baudRate?: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
}

// ----------------------------------------------------------------
// 完备的 ESP32 串口行分类
// ----------------------------------------------------------------

/** 分类结果 */
export type LineClass = 'json' | 'esp_log' | 'crash' | 'boot' | 'unknown'

const ESP_LOG_RE = /^[EWIDV] \(\d+\) \w+:/
const HEX_ADDR_RE = /^0x4[0-9a-f]{7}/i
const BOOT_PREFIXES = [
  'ESP-ROM:', 'Build:', 'rst:', 'load:',
  'entry ', 'ho ', 'SPIWP:', 'mode:',
  'clk_drv:', 'waiting',
]

/**
 * 对固件串口输出的每一行进行分类
 * 供 read loop 使用，也可被外部调用（调试面板）
 */
export function classifyLine(line: string): LineClass {
  // 1) JSON 协议数据 —— { 开头 + } 结尾（cJSON_PrintUnformatted 保证）
  if (line.startsWith('{') && line.endsWith('}')) return 'json'

  // 2) ESP_LOG 标准格式 —— X (timestamp) TAG: message
  if (ESP_LOG_RE.test(line)) return 'esp_log'

  // 3) 崩溃/异常输出
  if (
    line.startsWith('Backtrace:')
    || line.includes('Guru Meditation')
    || line.includes('Panic')
    || line.startsWith('PC ')
    || line.startsWith('EXCVADDR:')
    || line.startsWith('AIO:')
    || line.startsWith('A1 ')
    || line.startsWith('A2 ')
    || (HEX_ADDR_RE.test(line) && line.length < 30)
  ) return 'crash'

  // 4) 启动引导信息
  if (BOOT_PREFIXES.some(p => line.startsWith(p))) return 'boot'
  if (line.includes('second stage bootloader')) return 'boot'

  // 5) 残余未知行
  return 'unknown'
}

export class SerialService {
  private port: SerialPort | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private closing = false
  private lineCallback: ((line: string) => void) | null = null
  private disconnectCallback: (() => void) | null = null

  static isSupported(): boolean {
    return 'serial' in navigator
  }

  async requestPort(): Promise<SerialPort | null> {
    try {
      const port = await navigator.serial.requestPort()
      this.port = port
      return port
    } catch {
      return null
    }
  }

  async connect(port?: SerialPort, options: SerialOptions = {}): Promise<boolean> {
    // 确保先完全断开上次连接
    await this.disconnect()

    try {
      if (port) this.port = port
      if (!this.port) return false

      await this.port.open({
        baudRate: options.baudRate ?? 115200,
        dataBits: options.dataBits ?? 8,
        stopBits: options.stopBits ?? 1,
        parity: options.parity ?? 'none',
      })
    } catch {
      this.port = null
      return false
    }

    if (!this.port.readable || !this.port.writable) {
      try { await this.port.close() } catch { /* ignore */ }
      this.port = null
      return false
    }

    this.closing = false
    this.writer = this.port.writable.getWriter()
    this.startReadLoop()
    return true
  }

  async disconnect(): Promise<void> {
    if (!this.port) return

    this.closing = true

    // 1. 撤销 reader 上的 pending read()，等它完成
    const reader = this.reader
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // cancel 失败，尝试直接释放锁
        try { reader.releaseLock() } catch { /* ignore */ }
      }
      this.reader = null
    }

    // 2. 关闭 writer（先确保缓冲区数据写完）
    if (this.writer) {
      const writer = this.writer
      this.writer = null
      try { await writer.close() } catch { /* ignore */ }
      try { writer.releaseLock() } catch { /* ignore */ }
    }

    // 3. 关闭底层串口
    if (this.port) {
      const port = this.port
      this.port = null
      try { await port.close() } catch { /* ignore */ }
    }

    // 4. 给操作系统一点时间释放设备
    await this.delay(200)
  }

  get isConnected(): boolean {
    return this.port !== null && !!this.writer && !this.closing
  }

  get portInfo(): { vid?: number; pid?: number } | null {
    if (!this.port) return null
    const info = this.port.getInfo()
    return {
      vid: info.usbVendorId,
      pid: info.usbProductId,
    }
  }

  onLine(cb: (line: string) => void): void {
    this.lineCallback = cb
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCallback = cb
  }

  async sendCommand(cmd: string, params?: Record<string, unknown>): Promise<void> {
    if (this.closing || !this.writer) return
    const json = JSON.stringify(params ? { cmd, ...params } : { cmd })
    const data = new TextEncoder().encode(json + '\n')
    try {
      await this.writer.write(data)
    } catch {
      // write 失败说明设备断开，触发清理
    }
  }

  private startReadLoop(): void {
    if (!this.port?.readable) return
    const port = this.port
    this.reader = port.readable.getReader()
    const capturedReader = this.reader

    const read = async () => {
      let buf = ''
      try {
        while (true) {
          const { value, done } = await capturedReader.read()
          if (done) break
          if (value) {
            buf += new TextDecoder().decode(value)
            let nl: number
            while ((nl = buf.indexOf('\n')) !== -1) {
              const line = buf.substring(0, nl).trim()
              buf = buf.substring(nl + 1)
              if (line) {
                const cls = classifyLine(line)
                if (cls !== 'json') {
                  // 开发环境输出过滤掉的非 JSON 行，方便调试
                  if (import.meta.env.DEV && cls !== 'unknown') {
                    console.debug(`[Serial][${cls}]`, line)
                  }
                  continue
                }
                if (line.length > 500) {
                  console.log('[Serial] large line:', line.length, 'B',
                    'preview:', line.substring(0, 80))
                }
                try { this.lineCallback?.(line) } catch { /* ignore */ }
              }
            }
          }
        }
      } catch {
        // 设备断开或端口关闭
      } finally {
        // 清理 reader
        try { capturedReader.releaseLock() } catch { /* ignore */ }

        // 清理 writer
        if (this.writer) {
          try { this.writer.close() } catch { /* ignore */ }
          try { this.writer.releaseLock() } catch { /* ignore */ }
          this.writer = null
        }

        // 关闭端口
        if (this.port) {
          try { await this.port.close() } catch { /* ignore */ }
          this.port = null
        }

        // 通知断开（仅在非主动关闭时通知）
        if (!this.closing) {
          this.closing = true
          this.disconnectCallback?.()
        }
      }
    }

    read()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const serialService = new SerialService()
