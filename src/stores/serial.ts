/**
 * 串口连接状态 Store
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService, SerialService } from '@/services/SerialService'

export const useSerialStore = defineStore('serial', () => {
  const connected = ref(false)
  const connecting = ref(false)
  const supported = ref(SerialService.isSupported())
  const error = ref<string | null>(null)

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

  async function connect(): Promise<boolean> {
    if (!supported.value) {
      error.value = '当前浏览器不支持 Web Serial API，请使用 Chrome/Edge'
      return false
    }
    connecting.value = true
    error.value = null

    try {
      const port = await serialService.requestPort()
      if (!port) {
        connecting.value = false
        return false
      }
      const ok = await serialService.connect(port)
      if (ok) {
        connected.value = true
        error.value = null
      } else {
        error.value = '串口打开失败'
      }
    } catch (e: unknown) {
      error.value = `连接错误: ${String(e)}`
    } finally {
      connecting.value = false
    }
    return connected.value
  }

  async function disconnect(): Promise<void> {
    await serialService.disconnect()
    connected.value = false
  }

  // 注册断线回调
  serialService.onDisconnect(() => {
    connected.value = false
  })

  return {
    connected,
    connecting,
    supported,
    error,
    statusIcon,
    statusColor,
    statusText,
    connect,
    disconnect,
  }
})
