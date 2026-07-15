/**
 * Web Serial API 封装
 * 负责串口连接、JSON 行协议收发、ESP_LOG 噪声过滤
 *
 * 固件背景：
 * - ESP32-S3 的 USB Serial/JTAG 通道同时承载 JSON 协议数据 + ESP_LOG 输出
 *   (sdkconfig: CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG=y)
 * - JSON 由 cJSON_PrintUnformatted() 生成，始终单行、{ 开头 } 结尾
 * - ESP_LOG 格式: X (timestamp) TAG: message (X∈{E,W,I,D,V})
 */

import { classifyLine, type LineClass } from '@/utils/serialLineClassify'

// 重新导出供 ElectronSerialService 使用
export { classifyLine, type LineClass } from '@/utils/serialLineClassify'

export interface SerialOptions {
  baudRate?: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
}

export interface FirmwareFlashPayload {
  portPath: string
  fileName: string
  data: ArrayBuffer
}

export interface FirmwareFlashResult {
  success: boolean
  message?: string
  error?: string
}

export class SerialService {
  private port: SerialPort | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private closing = false
  private lineListeners: Set<(line: string) => void> = new Set()
  private disconnectCallback: (() => void) | null = null

  static isSupported(): boolean {
    return 'serial' in navigator
  }

  async requestPort(): Promise<SerialPort | null> {
    if (!navigator.serial) return null
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

  /** 通过 DTR 信号复位设备（硬件复位，适用于设备跑飞时） */
  async resetDevice(): Promise<boolean> {
    if (!this.port) return false
    try {
      const serialPort = this.port as SerialPort & {
        setSignals?: (signals: { dataTerminalReady: boolean }) => Promise<void>
      }
      await serialPort.setSignals?.({ dataTerminalReady: true })
      await this.delay(100)
      await serialPort.setSignals?.({ dataTerminalReady: false })
      return true
    } catch { return false }
  }

  async flashFirmware(): Promise<FirmwareFlashResult> {
    return { success: false, error: '浏览器模式不支持在线升级，请使用桌面版应用' }
  }

  onLine(cb: (line: string) => void): void {
    this.addLineListener(cb)
  }

  addLineListener(cb: (line: string) => void): void {
    this.lineListeners.add(cb)
  }

  removeLineListener(cb: (line: string) => void): void {
    this.lineListeners.delete(cb)
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCallback = cb
  }

  onFirmwareLog(): () => void {
    return () => { }
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
    if (!port.readable) return
    this.reader = port.readable.getReader()
    const capturedReader = this.reader

    const read = async () => {
      let buf = ''
      try {
        while (true) {
          if (!capturedReader) return
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
                  // 崩溃信息始终传给 listeners，让 UI 可以显示 panic 日志
                  if (cls === 'crash') {
                    this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
                  }
                  continue
                }
                if (import.meta.env.DEV && line.length > 2000) {
                  console.debug('[Serial] large line:', line.length, 'B',
                    'preview:', line.substring(0, 80))
                }
                this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
              }
            }
          }
        }
      } catch {
        // 设备断开或端口关闭
      } finally {
        // 清理 reader
        if (capturedReader) {
          try { capturedReader.releaseLock() } catch { /* ignore */ }
        }

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

export const webSerialService = new SerialService()

// ── 导入 Electron 后端（延迟导入避免循环依赖） ──
import { ElectronSerialService, electronSerialService } from './ElectronSerialService'

export { ElectronSerialService, electronSerialService }

export function isElectronEnv(): boolean {
  return ElectronSerialService.isSupported()
}

export function getSerialService() {
  if (ElectronSerialService.isSupported()) {
    return electronSerialService
  }
  return webSerialService
}

/**
 * 统一导出的串口服务实例。
 * - Electron 桌面端 → ElectronSerialService (原生 serialport)
 * - 浏览器 → SerialService (Web Serial API)
 *
 * 所有 Store 通过此导出使用，无需关心后端差异。
 */
export const serialService = ElectronSerialService.isSupported()
  ? electronSerialService
  : webSerialService
