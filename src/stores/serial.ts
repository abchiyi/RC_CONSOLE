/**
 * 串口连接状态 Store
 * 支持多种模式：
 *   - Web Serial API (浏览器)
 *   - Electron 原生串口 (桌面端)
 *   - Web Bluetooth NUS (桌面端/浏览器，经 connectBLE())
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  SerialService,
  ElectronSerialService,
  BleService,
  bleService,
  getSerialService,
  setSerialBackend,
  resetSerialBackend,
  type SerialBackend,
  serialService as webSerial,
  electronSerialService,
} from '@/services/SerialService'
import { useChannelStore } from './channels'

export const useSerialStore = defineStore('serial', () => {
  const connected = ref(false)
  const connecting = ref(false)
  const supported = ref(
    SerialService.isSupported() || ElectronSerialService.isSupported() || BleService.isSupported(),
  )
  const error = ref<string | null>(null)
  const availablePorts = ref<SerialPortDescriptor[]>([])
  const loadingPorts = ref(false)
  const lastPortPath = ref('')
  const isBluetooth = ref(false)
  /** 端口仍被保持打开（软断开）：可免弹窗直接复用，设备侧感知不到断开 */
  const portHeld = ref(false)

  /** 只有 Web Serial 后端支持软断开/复用端口（Electron 的端口由主进程持有，不在此列） */
  function isWebSerial (b: SerialBackend): b is SerialService {
    return typeof (b as SerialService).softDisconnect === 'function'
  }

  // 运行时确定使用哪个后端
  const isElectron = ElectronSerialService.isSupported()
  const bluetoothSupported = BleService.isSupported()

  // 活动后端（可运行时切换为 BLE）
  let backend: SerialBackend = isElectron ? electronSerialService : webSerial

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

  /** 连接设备（自动适配 Web Serial / Electron / BLE） */
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
      // 端口仍保持打开（上一次是软断开）→ 直接复用：不弹选择框，也不产生断开事件
      if (!isElectron && !isBluetooth.value && portHeld.value && isWebSerial(backend)) {
        if (await backend.resume()) {
          portHeld.value = false
          connected.value = true
          return true
        }
        // 复用失败（设备被拔 / 端口失效）→ 退回正常的选端口流程
        portHeld.value = false
        await backend.disconnect()
      }

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
          portHeld.value = false
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
    // 改用蓝牙前先彻底释放串口端口：软断开保持的端口会一直占用着 USB 设备
    if (portHeld.value) await releasePort()

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
        // 连接成功即开启通道实时传输（BLE 无 onMounted 自动触发）
        useChannelStore().startPolling()
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

  /**
   * 断开连接
   *
   * 默认走**软断开**：只停收发、保留端口 open，设备侧感知不到断开，
   * 避免主机 deassert 控制信号引发的复位（对通讯中的 RC 链路是致命的）。
   * 需要真正释放端口的场景（切换端口 / OTA / 设备已自行重启）传 releasePort: true。
   */
  async function disconnect (options: { releasePort?: boolean } = {}): Promise<void> {
    // 断开前先让设备停流：之后主机不再取数，若设备仍在高频上报会把 USB 缓冲顶满，
    // 反而可能拖死设备端任务；硬断开时这条命令也让设备先安静下来
    if (connected.value) {
      try {
        await backend.sendCommand('stream_stop')
        await new Promise(resolve => setTimeout(resolve, 80)) // 给最后一帧落地的时间
      } catch { /* 断开在即，失败无所谓 */ }
    }

    if (!options.releasePort && isWebSerial(backend)) {
      await backend.softDisconnect()
      portHeld.value = backend.hasOpenPort()
    } else {
      await backend.disconnect()
      portHeld.value = false
    }
    connected.value = false
  }

  /** 彻底释放端口（会关掉串口，设备侧会感知到断开） */
  async function releasePort (): Promise<void> {
    await disconnect({ releasePort: true })
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
    lastPortPath,
    portHeld,
    isElectron,
    isBluetooth,
    bluetoothSupported,
    statusIcon,
    statusColor,
    statusText,
    connect,
    connectBLE,
    disconnect,
    releasePort,
    listPorts,
    refreshPorts,
  }
})
