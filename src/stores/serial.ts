/**
 * 串口连接状态 Store
 * 支持多种模式：
 *   - Web Serial API (浏览器)
 *   - Electron 原生串口 (桌面端)
 *   - WebSocket (固件 Web 控制台)
 *   - Web Bluetooth NUS (桌面端/浏览器，经 connectBLE())
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  SerialService,
  ElectronSerialService,
  WebSocketService,
  BleService,
  bleService,
  getSerialService,
  setSerialBackend,
  resetSerialBackend,
  type SerialBackend,
  serialService as webSerial,
  electronSerialService,
  webSocketService,
} from '@/services/SerialService'

export const useSerialStore = defineStore('serial', () => {
  const connected = ref(false)
  const connecting = ref(false)
  const supported = ref(
    SerialService.isSupported() || ElectronSerialService.isSupported() || WebSocketService.isSupported() || BleService.isSupported(),
  )
  const error = ref<string | null>(null)
  const availablePorts = ref<SerialPortDescriptor[]>([])
  const loadingPorts = ref(false)
  const lastPortPath = ref('')
  const isBluetooth = ref(false)

  // 运行时确定使用哪个后端
  const isElectron = ElectronSerialService.isSupported()
  const isWebConsole = !isElectron && WebSocketService.isWebConsolePage()
  const bluetoothSupported = BleService.isSupported()

  // 活动后端（可运行时切换为 BLE）
  let backend: SerialBackend = isElectron
    ? electronSerialService
    : isWebConsole
      ? webSocketService
      : webSerial

  const statusIcon = computed(() => {
    if (!connected.value) return 'mdi-usb-port'
    return isBluetooth.value ? 'mdi-bluetooth' : 'mdi-usb'
  })
  const statusColor = computed(() =>
    connected.value ? 'success' : connecting.value ? 'warning' : 'grey',
  )
  const statusText = computed(() => {
    if (!supported.value) return '浏览器不支持串口'
    if (connecting.value) return '连接中…'
    if (connected.value) return isBluetooth.value ? '蓝牙已连接' : '已连接'
    return '未连接'
  })

  /** 刷新可用串口列表 */
  async function refreshPorts(): Promise<void> {
    loadingPorts.value = true
    error.value = null
    try {
      availablePorts.value = await listPorts()
    } catch {
      availablePorts.value = []
    } finally {
      loadingPorts.value = false
    }
  }

  /** Electron 模式下列出可用串口 */
  async function listPorts(): Promise<SerialPortDescriptor[]> {
    if (isElectron) {
      return (backend as ElectronSerialService).listPorts()
    }
    return []
  }

  /** 连接设备（自动适配 Web Serial / Electron / WebSocket / BLE） */
  async function connect(portPath?: string): Promise<boolean> {
    if (isBluetooth.value) {
      // 用户主动选择串口连接，切回默认后端
      resetSerialBackend()
      backend = getSerialService()
      isBluetooth.value = false
    }

    if (!supported.value) {
      error.value = isElectron
        ? '串口服务不可用'
        : '当前浏览器不支持 Web Serial API，请使用 Chrome/Edge'
      return false
    }

    connecting.value = true
    error.value = null

    try {
      if (isWebConsole) {
        // Web 控制台模式：同源 WebSocket，自动连接
        const ok = await (backend as WebSocketService).connect()
        if (ok) {
          connected.value = true
        } else {
          error.value = 'WebSocket 连接失败，请确认设备已开机并处于 Web 控制台模式'
        }
      } else if (isElectron) {
        // Electron 模式
        let targetPath = portPath

        if (!targetPath) {
          // 自动扫描可用串口
          const ports = await listPorts()
          if (ports.length === 0) {
            error.value = '未检测到串口设备，请连接 ESP32-S3 后重试'
            return false
          }
          if (ports.length === 1) {
            targetPath = ports[0]?.path
          } else {
            // 多个串口：优先选择 USB 串口设备（通常 ESP32 的 manufacturer 包含特定字符）
            const usbPort = ports.find(p =>
              p.manufacturer.toLowerCase().includes('espressif') ||
              p.manufacturer.toLowerCase().includes('silicon') ||
              p.manufacturer.toLowerCase().includes('wch') ||
              p.path.toLowerCase().includes('usb')
            )
            if (usbPort) {
              targetPath = usbPort.path
            } else {
              // 回退到第一个
              targetPath = ports[0]?.path
            }
          }
        }

        if (!targetPath) return false
        const ok = await (backend as ElectronSerialService).connect(targetPath)
        if (ok) {
          connected.value = true
          lastPortPath.value = targetPath
        } else {
          error.value = '串口打开失败'
        }
      } else if (isBluetooth.value) {
        // BLE 兜底分支（浏览器场景，通常由 connectBLE() 直接处理）
        const ok = await (backend as BleService).connect()
        if (ok) {
          connected.value = true
        } else {
          error.value = '蓝牙连接失败或已取消'
        }
      } else {
        // Web Serial 模式：弹出浏览器串口选择对话框
        const port = await (backend as SerialService).requestPort()
        if (!port) {
          connecting.value = false
          return false
        }
        const ok = await (backend as SerialService).connect(port)
        if (ok) {
          connected.value = true
        } else {
          error.value = '串口打开失败'
        }
      }
    } catch (e: unknown) {
      error.value = `连接错误: ${String(e)}`
    } finally {
      connecting.value = false
    }
    return connected.value
  }

  let bleDisconnectRegistered = false
  function ensureBleDisconnect(): void {
    if (bleDisconnectRegistered) return
    bleDisconnectRegistered = true
    bleService.onDisconnect(() => {
      connected.value = false
    })
  }

  /** 通过 BLE (NUS) 连接设备（需用户点击触发弹窗） */
  async function connectBLE(): Promise<boolean> {
    if (!bluetoothSupported) {
      error.value = '当前环境不支持 Web Bluetooth，请使用 Chromium/Edge 内核浏览器'
      return false
    }
    ensureBleDisconnect()
    // 切换全局后端：所有直接 import serialService 的模块自动跟随
    setSerialBackend(bleService)
    backend = bleService
    isBluetooth.value = true

    connecting.value = true
    error.value = null
    try {
      const ok = await bleService.connect()
      if (ok) {
        connected.value = true
      } else {
        error.value = '蓝牙连接失败或已取消'
      }
    } catch (e: unknown) {
      error.value = `蓝牙连接错误: ${String(e)}`
    } finally {
      connecting.value = false
    }
    return connected.value
  }

  async function disconnect(): Promise<void> {
    await backend.disconnect()
    connected.value = false
  }

  // 注册断线回调
  backend.onDisconnect(() => {
    connected.value = false
  })

  // Web 控制台模式：断线自动重连，连接状态由 WS 事件驱动
  if (isWebConsole) {
    ;(backend as WebSocketService).onStatusChange(ok => {
      connected.value = ok
    })
  }

  // Web 控制台模式：页面加载即自动连接（无需手动选择端口）
  if (isWebConsole && !connected.value) {
    void connect()
  }

  return {
    connected,
    connecting,
    supported,
    error,
    availablePorts,
    loadingPorts,
    lastPortPath,
    isElectron,
    isBluetooth,
    bluetoothSupported,
    statusIcon,
    statusColor,
    statusText,
    connect,
    connectBLE,
    disconnect,
    listPorts,
    refreshPorts,
  }
})
