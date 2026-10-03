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

// ── BLE 后端（Web Bluetooth NUS） ──
import type { BleService } from './BleService'
import { BinaryHandler } from '@/utils/binaryHandler'
import { encodeRequest } from '@/utils/commands'
import { classifyLine, type LineClass } from '@/utils/serialLineClassify'
// ── 导入 Electron 后端（延迟导入避免循环依赖） ──
import { ElectronSerialService, electronSerialService } from './ElectronSerialService'

export { bleService, BleService } from './BleService'

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
  /** 读循环的 Promise：断开时必须等它跑完，否则锁没释放，port.close() 会被浏览器拒绝 */
  private readTask: Promise<void> | null = null
  private closing = false
  /** 软断开（暂停）：端口仍 open，读循环继续把数据读走后丢弃，只是不再发送与解析 */
  private paused = false
  /** 软断开期间读到的字节数：>0 说明设备仍在持续输出（不读就会顶满设备端缓冲） */
  private pausedBytes = 0
  private drainTimer: ReturnType<typeof setInterval> | null = null
  private lineListeners: Set<(line: string) => void> = new Set()
  private objListeners: Set<(obj: Record<string, unknown>) => void> = new Set()
  private disconnectCallback: (() => void) | null = null
  private handler = new BinaryHandler()
  /** OTA 期间非 OTA 命令直接丢弃，避免轮询干扰传输 */
  private otaInProgress = false
  /** 会话锁丢弃日志节流（轮询命令每 5s 一条会淹没日志） */
  private lastDropLog = 0

  constructor () {
    // 二进制帧 → 对象分发；ESP_LOG 混流中的 crash 行 → lineListeners
    this.handler.onObject(obj => {
      for (const cb of this.objListeners) {
        try {
          cb(obj)
        } catch { /* ignore */ }
      }
    })
    this.handler.onLog(line => {
      for (const cb of this.lineListeners) {
        try {
          cb(line)
        } catch { /* ignore */ }
      }
    })
  }

  static isSupported (): boolean {
    return 'serial' in navigator
  }

  async requestPort (): Promise<SerialPort | null> {
    if (!navigator.serial) {
      return null
    }
    try {
      // 刻意不写 this.port: 端口真正被接管是在 connect() 里。若在这里先赋值,
      // connect() 开头的 disconnect() 会把这个尚未打开的端口当"旧连接"走一遍关闭流程
      return await navigator.serial.requestPort()
    } catch {
      return null
    }
  }

  async connect (port?: SerialPort, options: SerialOptions = {}): Promise<boolean> {
    // 确保先完全断开上次连接
    await this.disconnect()

    if (port) {
      this.port = port
    }
    if (!this.port) {
      return false
    }

    // Windows 上 close() 后串口由 OS 异步释放, 紧接着 open 会报
    // "Failed to open serial port" —— "断开后立刻重连"是最常见的触发路径 → 退避重试
    const target = this.port
    let opened = false
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      try {
        await target.open({
          baudRate: options.baudRate ?? 115_200,
          dataBits: options.dataBits ?? 8,
          stopBits: options.stopBits ?? 1,
          parity: options.parity ?? 'none',
        })
        opened = true
      } catch (error) {
        // "The port is already open" 说明这个端口对象仍是 open 状态（上一次会话泄漏）
        // 浏览器对同一物理设备复用同一个 SerialPort 实例，不先关掉就再也连不上，只能刷新页面
        try {
          await target.close()
        } catch { /* ignore */ }
        if (attempt === 3) {
          console.error('[Serial] 打开端口失败:', error)
        }
        await this.delay(250 * (attempt + 1))
      }
    }
    if (!opened) {
      this.port = null
      return false
    }

    if (!this.port.readable || !this.port.writable) {
      try {
        await this.port.close()
      } catch { /* ignore */ }
      this.port = null
      return false
    }

    this.closing = false
    this.writer = this.port.writable.getWriter()
    this.startReadLoop()
    // 诊断：观察主机打开端口后 DTR/RTS 的实际电平（定位"断开即复位"用）
    void this.logSignals('open')
    return true
  }

  async disconnect (): Promise<void> {
    // FE-04: 清掉解码器半帧与未收齐分片，避免跨连接残留
    this.handler.reset()
    this.paused = false
    this.clearDrainTimer()

    // 先立旗 + 摘掉引用：读循环的 finally 是并发执行的，摘引用后两边各清各的，互不干扰
    // （旧实现在 finally 之前一直持有 this.port，finally 里又按 this.port 去关，
    //  断开后立刻重连时就会把新连接的端口一起关掉）
    this.closing = true
    const reader = this.reader
    const writer = this.writer
    const port = this.port
    const readTask = this.readTask
    this.reader = null
    this.writer = null
    this.port = null
    this.readTask = null

    // 1. 让 pending 的 read() 结束（cancel 只负责让 read() settle，锁的释放在读循环的 finally 里）
    if (reader) {
      try {
        await this.withTimeout(reader.cancel(), 1000)
      } catch { /* 已断开 */ }
    }

    // 2. 关键：等读循环的 finally 跑完。
    //    releaseLock() 必须发生在 read() settle 之后，而这一步只有读循环自己知道何时完成；
    //    若在这里抢先调 port.close()，readable stream 仍被锁定 → close 抛 InvalidStateError，
    //    异常一被吞掉端口就永远保持 open，下次 open() 只会报 "The port is already open"。
    if (readTask) {
      await this.withTimeout(readTask, 3000)
    }
    // 读循环超时收尾时补一次释放：此时 read() 多半已 settle，成功就省掉后面的 close 失败
    if (reader) {
      try {
        reader.releaseLock()
      } catch { /* 仍持有锁或已释放 */ }
    }

    // 3. 兜底清理（读循环没跑起来 / finally 没能关掉时）
    if (writer) {
      try {
        await this.withTimeout(writer.close(), 1000)
      } catch { /* 已断开 */ }
      try {
        writer.releaseLock()
      } catch { /* 已释放 */ }
    }

    if (port) {
      try {
        await this.withTimeout(port.close(), 2000)
      } catch { /* 已关闭 */ }
      // 给操作系统一点时间释放设备（Windows 上 USB CDC 的关闭是异步的）
      await this.delay(200)
    }
  }

  /** 端口是否仍处于打开状态（软断开后为 true）：可跳过选择弹窗直接复用 */
  hasOpenPort (): boolean {
    // close() 之后 readable 会被置回 null，这是 Web Serial 里唯一的"已打开"判据
    return this.port !== null && this.port.readable !== null
  }

  /**
   * 软断开（暂停）：**读循环不停**，继续把设备发来的数据读走后丢弃，只是不再发送与解析。
   *
   * 为什么不能停读（这是踩过的坑）：端口保持 open 却不读，设备侧的 USB 发送缓冲会被顶满，
   * 写操作阻塞 → 任务卡死 → 看门狗复位。IDF 文档对 USB Serial/JTAG 明确写了这个行为。
   * 而**拔掉 USB 反而不复位** —— 那时设备端写 USB 会立刻失败返回，不会卡住。
   * 两者对比正好说明：致命的不是"主机消失"，而是"主机连着却不取数" + "close() 的信号跳变"。
   *
   * 于是软断开的正确形态就是"继续取数、只停发送"，让设备侧完全无感。
   */
  async softDisconnect (): Promise<void> {
    this.handler.reset()
    this.paused = true
    this.pausedBytes = 0

    // 诊断：软断开期间若仍在持续收字节，说明设备一直在输出（停流命令没盖住日志输出）
    this.clearDrainTimer()
    this.drainTimer = setInterval(() => {
      if (this.paused) {
        console.debug(`[Serial] 软断开期间仍收到 ${this.pausedBytes} 字节（设备持续输出）`)
      }
    }, 5000)
  }

  /** 结束暂停，恢复收发（无需用户再选端口、不产生断开事件）；失败返回 false */
  async resume (): Promise<boolean> {
    const port = this.port
    if (!port?.readable || !port.writable) {
      return false
    }
    this.clearDrainTimer()
    console.debug(`[Serial] 软断开期间共收到 ${this.pausedBytes} 字节`)
    this.pausedBytes = 0
    this.handler.reset()
    this.paused = false

    if (!this.writer) {
      try {
        this.writer = port.writable.getWriter()
      } catch {
        // 锁没释放干净 / 端口已被拔除：彻底释放，让调用方走重新选端口的流程
        await this.disconnect()
        return false
      }
    }
    // 暂停期间读循环若已退出（设备被拔过），重新拉起
    if (!this.reader) {
      this.startReadLoop()
    }
    return true
  }

  /** 诊断：打印主机侧控制信号（DTR/RTS），用于判断设备复位是否与信号跳变有关 */
  async logSignals (stage: string): Promise<void> {
    try {
      const port = this.port as (SerialPort & {
        getSignals?: () => Promise<Record<string, boolean>>
      }) | null
      if (!port?.getSignals) {
        return
      }
      console.debug(`[Serial] signals @${stage}:`, await port.getSignals())
    } catch { /* 不支持则忽略 */ }
  }

  get isConnected (): boolean {
    return this.port !== null && !!this.writer && !this.closing && !this.paused
  }

  get portInfo (): { vid?: number, pid?: number } | null {
    if (!this.port) {
      return null
    }
    const info = this.port.getInfo()
    return {
      vid: info.usbVendorId,
      pid: info.usbProductId,
    }
  }

  /** 通过 DTR 信号复位设备（硬件复位，适用于设备跑飞时） */
  async resetDevice (): Promise<boolean> {
    if (!this.port) {
      return false
    }
    try {
      const serialPort = this.port as SerialPort & {
        setSignals?: (signals: { dataTerminalReady: boolean }) => Promise<void>
      }
      await serialPort.setSignals?.({ dataTerminalReady: true })
      await this.delay(100)
      await serialPort.setSignals?.({ dataTerminalReady: false })
      return true
    } catch {
      return false
    }
  }

  async flashFirmware (): Promise<FirmwareFlashResult> {
    return { success: false, error: '浏览器模式不支持在线升级，请使用桌面版应用' }
  }

  onLine (cb: (line: string) => void): void {
    this.addLineListener(cb)
  }

  addLineListener (cb: (line: string) => void): void {
    this.lineListeners.add(cb)
  }

  removeLineListener (cb: (line: string) => void): void {
    this.lineListeners.delete(cb)
  }

  /** 注册解析后的响应/事件对象回调 */
  onObject (cb: (obj: Record<string, unknown>) => void): void {
    this.objListeners.add(cb)
  }

  removeObjectListener (cb: (obj: Record<string, unknown>) => void): void {
    this.objListeners.delete(cb)
  }

  onDisconnect (cb: () => void): void {
    this.disconnectCallback = cb
  }

  onFirmwareLog (): () => void {
    return () => {}
  }

  /** 发送队列尾：所有 sendCommand 串行排队，保证一条命令的全部分片连续写入 */
  private _txTail: Promise<unknown> = Promise.resolve()

  /**
   * @returns 首帧的帧头 seq；未发送（未连接/未知命令/被会话锁丢弃）时返回 undefined。
   *   固件构建 RESPONSE 时原样回显该 seq，调用方可据此精确匹配响应。
   */
  async sendCommand (cmd: string, params?: Record<string, unknown>): Promise<number | undefined> {
    // 串行化：多帧命令（set_model 大 TLV / OTA chunk）与其它命令并发写入时，分片会交错成
    // "A1 B1 A2 A3"，固件侧帧重组会出错。串到队尾可保证一条命令的所有分片连续落地。
    const run = this._txTail.then(() => this._sendCommand(cmd, params))
    this._txTail = run.catch(() => undefined)
    return run
  }

  /** sendCommand 的实际实现（由 _txTail 串行调用，勿直接调用） */
  private async _sendCommand (cmd: string, params?: Record<string, unknown>): Promise<number | undefined> {
    if (this.closing || this.paused || !this.writer) {
      return undefined
    }
    // 大流量会话锁: OTA / 外部模块烧录 的 begin 加锁, finish/abort 解锁, chunk 放行, 其他命令丢弃
    if (cmd === 'ota_begin' || cmd === 'elrs_flash_begin') {
      this.otaInProgress = true
    } else if (cmd === 'ota_finish' || cmd === 'ota_abort'
      || cmd === 'elrs_flash_finish' || cmd === 'elrs_flash_abort') {
      this.otaInProgress = false
    } else if (this.otaInProgress && cmd !== 'ota_chunk' && cmd !== 'elrs_flash_chunk') {
      // 烧录/OTA 会话期间丢弃其它命令是设计行为（避免轮询干扰传输），但后台轮询
      // 每 5s 触发一次会把日志淹没 —— 每秒最多留一条
      const nowDrop = Date.now()
      if (nowDrop - this.lastDropLog >= 1000) {
        this.lastDropLog = nowDrop
        console.warn(`[Serial] session in progress, dropping: ${cmd}`)
      }
      return undefined
    }
    let frames: Uint8Array[]
    try {
      frames = encodeRequest(cmd, params)
    } catch (error) {
      console.error('[Serial] 未知命令:', cmd, error)
      return undefined
    }
    if (cmd === 'stream_start') {
      this.handler.setStreamFlags(Number(params?.flags ?? 0))
    }
    const seq = frames[0]?.[7]
    try {
      for (const f of frames) {
        await this.writer.write(f)
      }
    } catch {
      // write 失败说明设备断开，触发清理
    }
    return seq
  }

  /** 停止软断开期间的取数诊断定时器 */
  private clearDrainTimer (): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer)
      this.drainTimer = null
    }
  }

  /** 不等到底层 Promise，避免 close()/cancel() 挂起时整个断开流程卡死 */
  private async withTimeout (task: Promise<unknown>, ms: number): Promise<void> {
    await Promise.race([
      Promise.resolve(task).catch(() => undefined),
      this.delay(ms),
    ])
  }

  private startReadLoop (): void {
    if (!this.port?.readable) {
      return
    }
    const port = this.port
    if (!port.readable) {
      return
    }
    this.reader = port.readable.getReader()
    const capturedReader = this.reader
    const myWriter = this.writer

    const read = async () => {
      try {
        while (true) {
          if (!capturedReader) {
            return
          }
          const { value, done } = await capturedReader.read()
          if (done) {
            break
          }
          if (value) {
            // 软断开期间仍要把字节读走（只是丢弃）：端口 open 却不读会让设备端
            // USB 发送缓冲被顶满 → 写阻塞 → 看门狗复位
            if (this.paused) {
              this.pausedBytes += value.byteLength
              continue
            }
            // 字节流 → 二进制帧解码（内部同步帧头/校验 CRC/过滤 ESP_LOG）
            this.handler.feed(value)
          }
        }
      } catch {
        // 设备断开或端口关闭
      } finally {
        // 清理 reader
        if (capturedReader) {
          try {
            capturedReader.releaseLock()
          } catch { /* ignore */ }
        }

        // 清理 writer：只动属于本次会话的那个。断开后立刻重连时 this.writer 已指向新会话,
        // 若按 this.writer 去关, 会把刚建立的新连接写端关掉（表现为"连上又掉"）
        if (myWriter) {
          try {
            await this.withTimeout(myWriter.close(), 1000)
          } catch { /* ignore */ }
          try {
            myWriter.releaseLock()
          } catch { /* ignore */ }
          if (this.writer === myWriter) {
            this.writer = null
          }
        }

        // 关闭端口：只关自己捕获的这个 port，且必须关 ——
        // 之前用 if (this.port === port) 包住 close()，导致主动断开时（this.port 已被 disconnect 摘成 null）
        // 端口根本没被关闭，泄漏成"永远 open"，重连就必然失败
        try {
          await this.withTimeout(port.close(), 2000)
        } catch { /* ignore */ }

        // 只有仍由本会话持有引用时才清理状态 / 通知断开（非主动关闭时通知）
        if (this.port === port) {
          this.port = null
          if (!this.closing) {
            this.closing = true
            this.disconnectCallback?.()
          }
        }
      }
    }

    // 保存句柄：disconnect() 必须 await 它，才能保证锁已释放、端口已关闭
    this.readTask = read()
  }

  private delay (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const webSerialService = new SerialService()

export function isElectronEnv (): boolean {
  return ElectronSerialService.isSupported()
}

export type SerialBackend = SerialService | ElectronSerialService | BleService

export function getSerialService (): SerialBackend {
  if (ElectronSerialService.isSupported()) {
    return electronSerialService
  }
  return webSerialService
}

/**
 * 统一导出的活动后端实例。
 * - 默认按环境选择：Electron 桌面端 → ElectronSerialService；浏览器 → SerialService
 * - 可通过 setSerialBackend() 切换为 BleService（蓝牙 NUS）
 *
 * 所有 Store 与页面通过此导出使用，无需关心后端差异。
 */
export let serialService: SerialBackend = getSerialService()

/** 切换当前活动后端（如切到 BLE）。所有 import 该实例的模块自动跟随。 */
export function setSerialBackend (svc: SerialBackend): void {
  serialService = svc
}

/** 切回默认后端（按当前环境自动选择） */
export function resetSerialBackend (): void {
  serialService = getSerialService()
}

export { ElectronSerialService, electronSerialService } from './ElectronSerialService'
// 重新导出供 ElectronSerialService 使用
export { classifyLine, type LineClass } from '@/utils/serialLineClassify'
