/**
 * 串口连接状态 Store
 * 支持两种模式：
 *   - Web Serial API (浏览器)
 *   - Electron 原生串口 (桌面端)
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  SerialService,
  ElectronSerialService,
  serialService as webSerial,
  electronSerialService,
} from '@/services/SerialService'

export const useSerialStore = defineStore('serial', () => {
  const connected = ref(false)
  const connecting = ref(false)
  const supported = ref(SerialService.isSupported() || ElectronSerialService.isSupported())
  const error = ref<string | null>(null)
  const availablePorts = ref<SerialPortDescriptor[]>([])
  const loadingPorts = ref(false)

  // 运行时确定使用哪个后端
  const isElectron = ElectronSerialService.isSupported()
  const backend = isElectron ? electronSerialService : webSerial

  const statusIcon = computed(() =>
    connected.value ? 'mdi-usb' : 'mdi-usb-port',
  )
  const statusColor = computed(() =>
    connected.value ? 'success' : connecting.value ? 'warning' : 'grey',
  )
  const statusText = computed(() => {
    if (!supported.value) return '浏览器不支持串口'
    if (connecting.value) return '连接中…'
    if (connected.value) return '已连接'
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

  /** 连接设备（自动适配 Web Serial / Electron） */
  async function connect(portPath?: string): Promise<boolean> {
    if (!supported.value) {
      error.value = isElectron
        ? '串口服务不可用'
        : '当前浏览器不支持 Web Serial API，请使用 Chrome/Edge'
      return false
    }

    connecting.value = true
    error.value = null

    try {
      if (isElectron) {
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
            targetPath = ports[0].path
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
              targetPath = ports[0].path
            }
          }
        }

        const ok = await (backend as ElectronSerialService).connect(targetPath)
        if (ok) {
          connected.value = true
        } else {
          error.value = '串口打开失败'
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

  async function disconnect(): Promise<void> {
    await backend.disconnect()
    connected.value = false
  }

  // 注册断线回调
  backend.onDisconnect(() => {
    connected.value = false
  })

  return {
    connected,
    connecting,
    supported,
    error,
    availablePorts,
    loadingPorts,
    isElectron,
    statusIcon,
    statusColor,
    statusText,
    connect,
    disconnect,
    listPorts,
    refreshPorts,
  }
})
