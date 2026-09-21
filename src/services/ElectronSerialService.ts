/**
 * ElectronSerialService - Electron 原生串口后端
 *
 * 接口与 SerialService 完全一致，通过 IPC 桥接 Electron 主进程的 serialport。
 * 固件响应的行解析（classifyLine）在主进程完成原始读行后，仍在这里做 JSON 过滤，
 * 保持与 Web Serial 模式一致的行为。
 */

import type { FirmwareFlashPayload, FirmwareFlashResult } from './SerialService'
import { BinaryHandler } from '@/utils/binaryHandler'
import { encodeRequest } from '@/utils/commands'

export class ElectronSerialService {
  private lineListeners: Set<(line: string) => void> = new Set()
  private objListeners: Set<(obj: Record<string, unknown>) => void> = new Set()
  private disconnectCallback: (() => void) | null = null
  private handler = new BinaryHandler()
  private cleanups: (() => void)[] = []
  private _connected = false
  private _portPath = ''

  constructor () {
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
    return !!window.electronSerialAPI
  }

  private get api (): ElectronSerialAPI {
    if (!window.electronSerialAPI) {
      throw new Error('electronSerialAPI 不可用，请通过桌面应用启动')
    }
    return window.electronSerialAPI
  }

  /** 列出可用串口 */
  async listPorts (): Promise<SerialPortDescriptor[]> {
    try {
      return await this.api.list()
    } catch {
      return []
    }
  }

  /** 连接指定串口 */
  async connect (portPath: string, baudRate = 115_200): Promise<boolean> {
    await this.disconnect()

    const result = await this.api.connect(portPath, baudRate)
    if (!result.success) {
      console.error('[ElectronSerial] connect failed:', result.error)
      return false
    }

    this._connected = true
    this._portPath = result.path || portPath
    this.setupListeners()
    return true
  }

  /** 断开串口 */
  async disconnect (): Promise<void> {
    this.cleanupListeners()
    if (this._connected) {
      try {
        await this.api.disconnect()
      } catch { /* ignore */ }
    }
    this._connected = false
    this._portPath = ''
  }

  get isConnected (): boolean {
    return this._connected
  }

  /** 发送二进制命令帧 */
  /**
   * 发送二进制命令帧
   * @returns 首帧的帧头 seq；未发送（未连接/未知命令）时返回 undefined。
   *   固件构建 RESPONSE 时原样回显该 seq，调用方可据此精确匹配响应，
   *   避免同一命令连续收发时把迟到的旧应答当成新应答。
   */
  async sendCommand (cmd: string, params?: Record<string, unknown>): Promise<number | undefined> {
    // 串行化：多帧命令（set_model 大 TLV / OTA chunk）与其它命令并发写入时，分片会交错成
    // "A1 B1 A2 A3"，固件侧帧重组会出错。串到队尾可保证一条命令的所有分片连续落地。
    const run = this._txTail.then(() => this._sendCommand(cmd, params))
    this._txTail = run.catch(() => undefined)
    return run
  }

  /** 发送队列尾：所有 sendCommand 串行排队，保证一条命令的全部分片连续写入 */
  private _txTail: Promise<unknown> = Promise.resolve()

  /** sendCommand 的实际实现（由 _txTail 串行调用，勿直接调用） */
  private async _sendCommand (cmd: string, params?: Record<string, unknown>): Promise<number | undefined> {
    if (!this._connected) {
      return undefined
    }
    let frames: Uint8Array[]
    try {
      frames = encodeRequest(cmd, params)
    } catch (error) {
      console.error('[ElectronSerial] 未知命令:', cmd, error)
      return undefined
    }
    if (cmd === 'stream_start') {
      this.handler.setStreamFlags(Number(params?.flags ?? 0))
    }
    const seq = frames[0]?.[7]
    for (const f of frames) {
      const result = await this.api.send(f)
      if (!result.success) {
        console.error('[ElectronSerial] send error:', result.error)
        break
      }
    }
    return seq
  }

  /** 注册行监听器（crash 日志行） */
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

  /** 注册断开回调 */
  onDisconnect (cb: () => void): void {
    this.disconnectCallback = cb
  }

  onFirmwareLog (cb: (line: string) => void): () => void {
    return this.api.onFirmwareLog(cb)
  }

  /** 通过 DTR 信号复位设备（硬件复位，适用于设备跑飞时） */
  async resetDevice (): Promise<boolean> {
    if (!this._connected) {
      return false
    }
    const result = await this.api.reset()
    return result.success
  }

  async flashFirmware (payload: FirmwareFlashPayload): Promise<FirmwareFlashResult> {
    return this.api.flashFirmware(payload)
  }

  get portInfo (): { vid?: number, pid?: number } | null {
    // Electron serialport 模式下暂无 USB VID/PID
    return null
  }

  // ── 内部方法 ──

  private setupListeners (): void {
    this.cleanupListeners()

    this.cleanups.push(
      this.api.onData((bytes: Uint8Array) => {
        // 原始字节流 → 二进制帧解码（内部同步帧头/校验 CRC/过滤 ESP_LOG）
        this.handler.feed(bytes)
      }),
    )

    this.cleanups.push(
      this.api.onDisconnected(() => {
        this._connected = false
        this._portPath = ''
        this.disconnectCallback?.()
      }),
    )

    this.cleanups.push(
      this.api.onError(data => {
        console.error('[ElectronSerial]', data.message)
      }),
    )
  }

  private cleanupListeners (): void {
    for (const fn of this.cleanups) {
      try {
        fn()
      } catch { /* ignore */ }
    }
    this.cleanups = []
  }
}

/** Electron 模式下的全局串口服务实例 */
export const electronSerialService = new ElectronSerialService()
