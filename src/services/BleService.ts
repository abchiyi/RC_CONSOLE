import type { FirmwareFlashResult } from './SerialService'
/**
 * BleService - Web Bluetooth (NUS) 后端
 *
 * 通过 Web Bluetooth API 连接 ESP32-S3 的 Nordic UART Service (NUS)。
 * 接口与 ElectronSerialService / SerialService 保持一致：
 *  - connect()      弹出系统蓝牙选择框，连接 NUS 设备
 *  - sendCommand()  将 JSON + '\n' 按 UTF-8 写入 NUS RX 特征
 *  - TX 特征通知    按 '\n' 拼帧，classifyLine 过滤后发给 lineListeners
 *
 * 注意：
 *  - requestDevice() 必须在用户手势（点击）中调用
 *  - Electron 主进程需处理 'select-bluetooth-device' 事件，否则无设备选择弹窗
 */
import { BinaryHandler } from '@/utils/binaryHandler'
import { encodeRequest } from '@/utils/commands'

/** Nordic UART Service (NUS) */
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
/** NUS RX（手机 → 设备，写） */
const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
/** NUS TX（设备 → 手机，通知） */
const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

export class BleService {
  private device: BluetoothDevice | null = null
  private server: BluetoothRemoteGATTServer | null = null
  private rx: BluetoothRemoteGATTCharacteristic | null = null
  private tx: BluetoothRemoteGATTCharacteristic | null = null
  private lineListeners: Set<(line: string) => void> = new Set()
  private objListeners: Set<(obj: Record<string, unknown>) => void> = new Set()
  private disconnectCallback: (() => void) | null = null
  private handler = new BinaryHandler()
  private _connected = false
  private _deviceName = ''
  /** OTA 期间非 OTA 命令直接丢弃，避免轮询干扰传输 */
  private otaInProgress = false

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
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator
  }

  get isConnected (): boolean {
    return this._connected && !!this.server?.connected
  }

  get portInfo (): null {
    return null
  }

  get deviceName (): string {
    return this._deviceName
  }

  /** 弹出系统蓝牙选择框并连接 NUS 设备（需在用户手势中调用） */
  async connect (): Promise<boolean> {
    await this.disconnect()

    try {
      // Web Bluetooth 类型未随 DOM lib 提供，这里就地声明
      const bt = navigator as Navigator & {
        bluetooth: { requestDevice: (options: object) => Promise<any> }
      }
      const device = await bt.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE_UUID] }],
        optionalServices: [NUS_SERVICE_UUID],
      })
      this.device = device
      this._deviceName = device.name || ''

      device.addEventListener('gattserverdisconnected', () => {
        this._connected = false
        this.disconnectCallback?.()
      })

      const server = await device.gatt!.connect()
      this.server = server

      const service = await this.getServiceWithRetry(server, NUS_SERVICE_UUID)

      // 调试：打印设备实际广播的所有 GATT 服务
      // （Web Bluetooth 类型未随 DOM lib 提供，用 any 断言访问）
      const btServer = server as unknown as any
      const svcs = (await btServer.getPrimaryServices()) as Array<{ uuid: string }>
      console.log('[BLE] primary services:', svcs.map(s => s.uuid).join(', '))
      const anyService = service as unknown as any
      console.log('[BLE] NUS service found:', anyService.uuid)
      // 调试：打印 NUS 服务下所有特征及属性
      const chrs = (await anyService.getCharacteristics()) as Array<{
        uuid: string
        properties: Record<string, boolean>
      }>
      for (const c of chrs) {
        const props: string[] = []
        if (c.properties.read) {
          props.push('read')
        }
        if (c.properties.write) {
          props.push('write')
        }
        if (c.properties.writeWithoutResponse) {
          props.push('writeWithoutResponse')
        }
        if (c.properties.notify) {
          props.push('notify')
        }
        if (c.properties.indicate) {
          props.push('indicate')
        }
        console.log(`[BLE]   char ${c.uuid} → ${props.join(', ')}`)
      }

      this.rx = await service.getCharacteristic(NUS_RX_UUID)
      this.tx = await service.getCharacteristic(NUS_TX_UUID)

      this.tx!.addEventListener('characteristicvaluechanged', ev => this.handleNotify(ev))
      await this.tx!.startNotifications()

      this._connected = true
      return true
    } catch (error) {
      console.error('[BLE] connect failed:', error)
      this._connected = false
      this.server = null
      this.rx = null
      this.tx = null
      return false
    }
  }

  /** 断开 BLE 连接 */
  async disconnect (): Promise<void> {
    // FE-04: 清掉解码器半帧与未收齐分片，避免跨连接残留
    this.handler.reset()
    this._connected = false
    try {
      await this.tx?.stopNotifications()
    } catch { /* ignore */ }
    try {
      this.server?.disconnect()
    } catch { /* ignore */ }
    this.server = null
    this.rx = null
    this.tx = null
    this.device = null
  }

  /**
   * 发送二进制命令帧（自动切块写入 NUS RX，队列满时降块重试，OTA 期间加大节流）
   * @returns 首帧的帧头 seq；未发送（未连接/未知命令/被会话锁丢弃）时返回 undefined。
   *   固件构建 RESPONSE 时原样回显该 seq，调用方可据此精确匹配响应。
   */
  async sendCommand (cmd: string, params?: Record<string, unknown>): Promise<number | undefined> {
    // 串行化：BLE 写入带重试退避，到达顺序本就无保证；若多帧命令（set_model 大 TLV /
    // OTA chunk）与其它命令并发，分片会交错成 "A1 B1 A2 A3"，固件帧重组会出错。
    const run = this._txTail.then(() => this._sendCommand(cmd, params))
    this._txTail = run.catch(() => undefined)
    return run
  }

  /** 发送队列尾：所有 sendCommand 串行排队，保证一条命令的全部分片/切块连续写入 */
  private _txTail: Promise<unknown> = Promise.resolve()

  /** sendCommand 的实际实现（由 _txTail 串行调用，勿直接调用） */
  private async _sendCommand (cmd: string, params?: Record<string, unknown>): Promise<number | undefined> {
    if (!this.isConnected || !this.rx) {
      return undefined
    }
    // 大流量会话锁: OTA / 外部模块烧录 的 begin 加锁, finish/abort 解锁, chunk 放行, 其他命令丢弃
    if (cmd === 'ota_begin' || cmd === 'elrs_flash_begin') {
      this.otaInProgress = true
    } else if (cmd === 'ota_finish' || cmd === 'ota_abort'
      || cmd === 'elrs_flash_finish' || cmd === 'elrs_flash_abort') {
      this.otaInProgress = false
    } else if (this.otaInProgress && cmd !== 'ota_chunk' && cmd !== 'elrs_flash_chunk') {
      console.warn(`[BLE] session in progress, dropping: ${cmd}`)
      return undefined
    }
    let frames: Uint8Array[]
    try {
      frames = encodeRequest(cmd, params)
    } catch (error) {
      console.error('[BLE] 未知命令:', cmd, error)
      return undefined
    }
    if (cmd === 'stream_start') {
      this.handler.setStreamFlags(Number(params?.flags ?? 0))
    }
    const seq = frames[0]?.[7]
    const isOta = cmd === 'ota_begin' || cmd === 'ota_chunk' || cmd === 'ota_finish' || cmd === 'ota_abort'
      || cmd === 'elrs_flash_begin' || cmd === 'elrs_flash_chunk'
      || cmd === 'elrs_flash_finish' || cmd === 'elrs_flash_abort'
    // 调试：打印实际写入 BLE 的帧字节
    const hex = frames.map(f =>
      Array.from(f).map(b => b.toString(16).padStart(2, '0')).join(' '),
    ).join(' | ')
    console.log(`[BLE TX] ${cmd} (${frames.length} frame): ${hex}`)
    try {
      // PC Chrome 协商 MTU=247 → 244B；OTA 期间固定 244 不降块，避免与前端切片错位
      const chunkSize = 244
      // OTA 严格请求-响应：加大节流避免与响应撞 TX；普通命令对齐连接间隔即可
      const PACE_MS = isOta ? 40 : 15
      for (const f of frames) {
        const multiChunk = f.length > chunkSize
        for (let i = 0; i < f.length; i += chunkSize) {
          const chunk = f.subarray(i, i + chunkSize)
          const ab = new Uint8Array(chunk).buffer
          let sent = false
          for (let attempt = 0; attempt < 3 && !sent; attempt++) {
            try {
              await this.rx!.writeValueWithoutResponse(ab)
              sent = true
            } catch {
              // 特征队列满 / 状态异常：退避后重试 (OTA 不降块, 避免切片错位)
              await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)))
            }
          }
          if (!sent) {
            console.warn(`[BLE TX] ${cmd} chunk@${i} dropped after retries`)
            continue
          }
          // 块间节流(仅当还有后续块)
          if (multiChunk && i + chunkSize < f.length) {
            await new Promise(resolve => setTimeout(resolve, PACE_MS))
          }
        }
        // 帧间节流(多分片帧时)
        if (f !== frames[frames.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, PACE_MS))
        }
      }
    } catch { /* ignore */ }
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

  onFirmwareLog (): () => void {
    return () => {}
  }

  /** BLE 无 DTR 信号，不支持硬件复位 */
  async resetDevice (): Promise<boolean> {
    return false
  }

  async flashFirmware (): Promise<FirmwareFlashResult> {
    return { success: false, error: 'BLE 模式不支持桌面刷写，请使用 USB 串口或页面内 OTA' }
  }

  // ── 内部方法 ──

  /**
   * 首次连接竞态修复：Windows/Chromium 在 requestDevice 后可能已建立隐藏 ACL，
   * 紧接着的 getPrimaryService 会因连接被挤断而抛 "GATT Server is disconnected"。
   * 失败时等待 300ms，若 server 已断开则重新 gatt.connect() 后重试。
   */
  private async getServiceWithRetry (
    server: BluetoothRemoteGATTServer,
    uuid: string,
    retries = 1,
  ): Promise<BluetoothRemoteGATTService> {
    for (let i = 0; i <= retries; i++) {
      try {
        return await server.getPrimaryService(uuid)
      } catch (error) {
        if (i === retries) {
          throw error
        }
        await new Promise(r => setTimeout(r, 300))
        if (!server.connected) {
          await server.connect()
        }
      }
    }
    throw new Error('getPrimaryService failed')
  }

  private handleNotify (ev: Event): void {
    const char = ev.target as BluetoothRemoteGATTCharacteristic
    const value = char.value
    if (!value) {
      return
    }
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    this.handler.feed(bytes)
  }
}

/** BLE 模式下的全局服务实例 */
export const bleService = new BleService()
