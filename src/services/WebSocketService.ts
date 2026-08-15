/**
 * WebSocket 串口服务封装（Web 控制台模式）
 *
 * 固件侧：ESP32-S3 运行 WiFi AP + esp_http_server，提供 /ws WebSocket 端点。
 * 每条文本帧 = 一条 JSON 命令，固件 SerialCmd::dispatch() 处理后回发 JSON 响应（\n 结尾）。
 * 与 Web Serial / Electron 串口共用同一命令协议，前端 store 无需感知差异。
 *
 * 特性：
 *  - 断线自动重连（指数退避），适配 ESP 重启 / WiFi 短暂中断场景
 *  - 同源 WebSocket（页面由固件 192.168.4.1 提供，无需跨域配置）
 */
import { classifyLine } from '@/utils/serialLineClassify'
import type { FirmwareFlashResult } from './SerialService'

export class WebSocketService {
  private ws: WebSocket | null = null
  private closing = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private lineListeners: Set<(line: string) => void> = new Set()
  private disconnectCallback: (() => void) | null = null
  private statusCallbacks: Set<(connected: boolean) => void> = new Set()
  private readonly url: string

  constructor(url?: string) {
    this.url = url ?? this.defaultUrl()
  }

  /** 浏览器均支持 WebSocket；此处仅用于类型判断 */
  static isSupported(): boolean {
    return typeof WebSocket !== 'undefined'
  }

  /** 页面是否由固件 Web 控制台提供（非本地开发地址即视为固件页面） */
  static isWebConsolePage(): boolean {
    if (typeof window === 'undefined' || typeof window.location === 'undefined') {
      return false
    }
    const { protocol, hostname } = window.location
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== ''
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && !this.closing
  }

  get portInfo(): null {
    return null
  }

  async requestPort(): Promise<null> {
    return null
  }

  /** WebSocket 模式下无端口参数，直接连接同源 /ws */
  async connect(_port?: unknown): Promise<boolean> {
    this.closing = false
    if (this.isConnected) return true

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.open()
    }
    return this.waitOpen()
  }

  async disconnect(): Promise<void> {
    this.closing = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.ws
    this.ws = null
    if (ws) {
      try { ws.close() } catch { /* ignore */ }
    }
    this.statusCallbacks.forEach(cb => { try { cb(false) } catch { /* ignore */ } })
  }

  /** 通过 DTR 复位仅适用于串口；WebSocket 模式下不支持 */
  async resetDevice(): Promise<boolean> {
    return false
  }

  /** 浏览器模式不支持原生刷写；请使用页面内 OTA 流程（ota_begin/ota_chunk/ota_finish） */
  async flashFirmware(): Promise<FirmwareFlashResult> {
    return { success: false, error: 'Web 控制台模式不支持桌面刷写，请使用页面内在线升级' }
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

  /** 连接状态变化通知（含自动重连恢复），WebSocket 模式专用 */
  onStatusChange(cb: (connected: boolean) => void): () => void {
    this.statusCallbacks.add(cb)
    return () => this.statusCallbacks.delete(cb)
  }

  onFirmwareLog(): () => void {
    return () => { }
  }

  async sendCommand(cmd: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.isConnected) return
    const json = JSON.stringify(params ? { cmd, ...params } : { cmd })
    try {
      this.ws?.send(json + '\n')
    } catch { /* 连接可能刚断开，等待重连 */ }
  }

  private defaultUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }

  private open(): void {
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectDelay = 1000
        this.statusCallbacks.forEach(cb => { try { cb(true) } catch { /* ignore */ } })
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return
        this.handleMessage(ev.data)
      }

      ws.onerror = () => { /* 由 onclose 统一处理 */ }

      ws.onclose = () => {
        if (this.ws === ws) this.ws = null
        if (!this.closing) {
          this.disconnectCallback?.()
          this.statusCallbacks.forEach(cb => { try { cb(false) } catch { /* ignore */ } })
          this.scheduleReconnect()
        }
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closing) this.open()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
  }

  private waitOpen(): Promise<boolean> {
    return new Promise(resolve => {
      const check = () => {
        if (this.isConnected) {
          resolve(true)
          return
        }
        if (!this.ws) {
          resolve(false)
          return
        }
        setTimeout(check, 50)
      }
      check()
    })
  }

  private handleMessage(data: string): void {
    let buf = data
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.substring(0, nl).trim()
      buf = buf.substring(nl + 1)
      this.dispatchLine(line)
    }
    if (buf.trim()) this.dispatchLine(buf.trim())
  }

  private dispatchLine(line: string): void {
    if (!line) return
    const cls = classifyLine(line)
    if (cls !== 'json') {
      // 崩溃信息始终传给 listeners，让 UI 可以显示 panic 日志
      if (cls === 'crash') {
        this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
      }
      return
    }
    this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
  }
}

export const webSocketService = new WebSocketService()
