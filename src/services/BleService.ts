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
import { classifyLine } from '@/utils/serialLineClassify'
import type { FirmwareFlashResult } from './SerialService'

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
  private disconnectCallback: (() => void) | null = null
  private _connected = false
  private _deviceName = ''
  private buf = ''

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator
  }

  get isConnected(): boolean {
    return this._connected && !!this.server?.connected
  }

  get portInfo(): null {
    return null
  }

  get deviceName(): string {
    return this._deviceName
  }

  /** 弹出系统蓝牙选择框并连接 NUS 设备（需在用户手势中调用） */
  async connect(): Promise<boolean> {
    await this.disconnect()

    try {
      const device = await navigator.bluetooth.requestDevice({
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

      const service = await server.getPrimaryService(NUS_SERVICE_UUID)
      this.rx = await service.getCharacteristic(NUS_RX_UUID)
      this.tx = await service.getCharacteristic(NUS_TX_UUID)

      this.tx.addEventListener('characteristicvaluechanged', ev => this.handleNotify(ev))
      await this.tx.startNotifications()

      this._connected = true
      return true
    } catch (e) {
      console.error('[BLE] connect failed:', e)
      this._connected = false
      this.server = null
      this.rx = null
      this.tx = null
      return false
    }
  }

  /** 断开 BLE 连接 */
  async disconnect(): Promise<void> {
    this._connected = false
    try { await this.tx?.stopNotifications() } catch { /* ignore */ }
    try { this.server?.disconnect() } catch { /* ignore */ }
    this.server = null
    this.rx = null
    this.tx = null
    this.device = null
  }

  /** 发送 JSON 命令（自动添加换行符，UTF-8 写入 NUS RX） */
  async sendCommand(cmd: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.isConnected || !this.rx) return
    const json = JSON.stringify(params ? { cmd, ...params } : { cmd })
    const data = new TextEncoder().encode(json + '\n')
    try {
      // 固件 RX 特征属性 = WRITE | WRITE_NR，优先无响应写
      await this.rx.writeValueWithoutResponse(data)
    } catch {
      try { await this.rx.writeValueWithResponse(data) } catch { /* ignore */ }
    }
  }

  /** 注册行监听器（JSON + crash 行） */
  onLine(cb: (line: string) => void): void {
    this.addLineListener(cb)
  }

  addLineListener(cb: (line: string) => void): void {
    this.lineListeners.add(cb)
  }

  removeLineListener(cb: (line: string) => void): void {
    this.lineListeners.delete(cb)
  }

  /** 注册断开回调 */
  onDisconnect(cb: () => void): void {
    this.disconnectCallback = cb
  }

  onFirmwareLog(): () => void {
    return () => { }
  }

  /** BLE 无 DTR 信号，不支持硬件复位 */
  async resetDevice(): Promise<boolean> {
    return false
  }

  async flashFirmware(): Promise<FirmwareFlashResult> {
    return { success: false, error: 'BLE 模式不支持桌面刷写，请使用 USB 串口或页面内 OTA' }
  }

  // ── 内部方法 ──

  private handleNotify(ev: Event): void {
    const char = ev.target as BluetoothRemoteGATTCharacteristic
    const value = char.value
    if (!value) return
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    this.buf += new TextDecoder().decode(bytes)
    let nl: number
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.substring(0, nl).trim()
      this.buf = this.buf.substring(nl + 1)
      if (line) this.dispatchLine(line)
    }
  }

  private dispatchLine(line: string): void {
    const cls = classifyLine(line)
    if (cls !== 'json') {
      if (import.meta.env.DEV && cls !== 'unknown') {
        console.debug(`[BLE][${cls}]`, line)
      }
      // 崩溃信息始终传给 listeners，让 UI 可以显示 panic 日志
      if (cls === 'crash') {
        this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
      }
      return
    }
    this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
  }
}

/** BLE 模式下的全局服务实例 */
export const bleService = new BleService()
