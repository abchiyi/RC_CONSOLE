/**
 * 校准 Store
 * 管理 ADC/IMU 校准数据、校准流程状态、LPF 设置
 * 替代 CalWizard.vue 中的 addLineListener / sendCommand 直连逻辑
 */
import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { serialService } from '@/services/SerialService'

export interface AdcCal {
  raw?: number
  raw_min?: number
  raw_center?: number
  raw_max?: number
  deadzone: number
}

export interface ImuCal {
  roll?: number
  pitch?: number
  yaw?: number
  gyro_bias_x?: number
  gyro_bias_y?: number
  gyro_bias_z?: number
}

export type CalType = 'trigger' | 'joy_x' | 'joy_y' | 'imu'

export const useCalibrationStore = defineStore('calibration', () => {
  const trigger = reactive<AdcCal>({ deadzone: 30 })
  const joyX = reactive<AdcCal>({ deadzone: 30 })
  const joyY = reactive<AdcCal>({ deadzone: 30 })
  const imu = reactive<ImuCal>({})

  const lpfAlpha = ref(500)
  const runningType = ref<CalType | null>(null)
  const calProgress = ref(0)
  const lastMessage = ref('')
  const lastType = ref<CalType | null>(null)

  // ---- 命令发送 ----

  async function startCal(type: CalType): Promise<void> {
    runningType.value = type
    calProgress.value = 0
    lastMessage.value = '校准进行中…'
    lastType.value = type
    await serialService.sendCommand('cal_start', { type })
  }

  function cancelCal(): void {
    lastMessage.value = '已取消'
    stopTimers()
  }

  async function pollStatus(): Promise<void> {
    await serialService.sendCommand('cal_status')
  }

  async function fetchCalData(): Promise<void> {
    await serialService.sendCommand('cal_get')
  }

  async function setDeadzone(type: string, deadzone: number): Promise<void> {
    await serialService.sendCommand('cal_set_deadzone', { type, deadzone })
  }

  async function setLpf(alpha: number): Promise<void> {
    await serialService.sendCommand('cal_set_lpf_alpha', { alpha })
  }

  async function zeroIMU(): Promise<void> {
    await serialService.sendCommand('cal_zero_imu')
    lastMessage.value = 'IMU 已归零'
    lastType.value = 'imu'
    setTimeout(() => { lastMessage.value = '' }, 2000)
  }

  // ---- 定时器管理 ----

  let statusPollTimer: ReturnType<typeof setInterval> | null = null
  let calTimeout: ReturnType<typeof setTimeout> | null = null
  let calDataTimer: ReturnType<typeof setInterval> | null = null

  function startStatusPolling(): void {
    statusPollTimer = setInterval(() => { pollStatus() }, 500)
  }

  function startCalTimeout(): void {
    calTimeout = setTimeout(() => {
      if (runningType.value) {
        lastMessage.value = '校准超时，请重试'
        stopTimers()
      }
    }, 30000)  // IMU 校准需要采集 1200 个稳定样本 (约 6s)，但设备抖动会使 stableCount 降级，需要更多时间
  }

  /** 实时 raw+IMU 数据：由 STREAM content_type=1 推送（原 cal_get_raw 30ms 轮询已并入流式） */
  function startCalDataPolling(intervalMs = 10): void {
    if (!serialService.isConnected) return
    serialService.sendCommand('stream_start', { content_type: 1, interval_ms: intervalMs, flags: 0 })
  }

  function stopTimers(): void {
    runningType.value = null
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null }
    if (calTimeout) { clearTimeout(calTimeout); calTimeout = null }
  }

  function stopCalDataPolling(): void {
    calDataTimer = null
    serialService.sendCommand('stream_stop')
  }

  // ---- 响应处理 ----

  /** 标记死区是否已从设备加载，避免 30ms 轮询覆盖用户拖拽的滑块值 */
  let _deadzonesLoaded = false

  function handleResponse(json: Record<string, unknown>): void {
    // 注：实时 raw+IMU 已并入流式推送（STREAM content_type=1 → applyCalRaw）

    // cal_status 响应
    if (json.cmd === 'cal_status' || json.state !== undefined) {
      const st = (json.state ?? json.type ?? '') as string | number
      calProgress.value = (json.progress as number) ?? 0
      if (st === 'done' || st === 2) {
        lastMessage.value = (json.message as string) || '校准完成'
        lastType.value = runningType.value
        stopTimers()
        _deadzonesLoaded = false  // 校准完成后重新拉取死区
      } else if (st === 'error' || st === 3) {
        lastMessage.value = (json.message as string) || '校准失败'
        lastType.value = runningType.value
        stopTimers()
      } else if (st === 'running' || st === 1) {
        lastMessage.value = (json.message as string) || '校准进行中…'
        lastType.value = runningType.value
      }
      return
    }

    // cal_get / cal_set_deadzone 响应 (含 ADC/IMU 数据)
    if (json.cmd === 'cal_get' || json.adc || json.imu || json.lpf_alpha !== undefined) {
      applyCalData(json as Record<string, any>)
    }
  }

  function applyCalData(data: Record<string, any>): void {
    const adc = data.adc
    if (adc) {
      const raw = adc.raw || {}
      if (adc.trigger) {
        trigger.raw = raw.trigger
        trigger.raw_min = adc.trigger.min
        trigger.raw_center = adc.trigger.center
        trigger.raw_max = adc.trigger.max
        if (!_deadzonesLoaded && adc.trigger.deadzone !== undefined)
          trigger.deadzone = adc.trigger.deadzone
      }
      if (adc.joy_x) {
        joyX.raw = raw.joy_x
        joyX.raw_min = adc.joy_x.min
        joyX.raw_center = adc.joy_x.center
        joyX.raw_max = adc.joy_x.max
        if (!_deadzonesLoaded && adc.joy_x.deadzone !== undefined)
          joyX.deadzone = adc.joy_x.deadzone
      }
      if (adc.joy_y) {
        joyY.raw = raw.joy_y
        joyY.raw_min = adc.joy_y.min
        joyY.raw_center = adc.joy_y.center
        joyY.raw_max = adc.joy_y.max
        if (!_deadzonesLoaded && adc.joy_y.deadzone !== undefined)
          joyY.deadzone = adc.joy_y.deadzone
      }
      _deadzonesLoaded = true
    }
    if (data.imu) {
      imu.roll = data.imu.roll
      imu.pitch = data.imu.pitch
      imu.yaw = data.imu.yaw
      imu.gyro_bias_x = data.imu.cal?.gyro_bias_x
      imu.gyro_bias_y = data.imu.cal?.gyro_bias_y
      imu.gyro_bias_z = data.imu.cal?.gyro_bias_z
    }
    if (data.lpf_alpha !== undefined) {
      lpfAlpha.value = data.lpf_alpha
    }
  }

  /** 轻量实时数据解析：仅 raw + IMU 角度 */
  function applyCalRaw(data: Record<string, any>): void {
    const raw = data.raw
    if (raw) {
      if (raw.trigger !== undefined) trigger.raw = raw.trigger
      if (raw.joy_x !== undefined) joyX.raw = raw.joy_x
      if (raw.joy_y !== undefined) joyY.raw = raw.joy_y
    }
    if (data.imu) {
      if (data.imu.roll !== undefined) imu.roll = data.imu.roll
      if (data.imu.pitch !== undefined) imu.pitch = data.imu.pitch
      if (data.imu.yaw !== undefined) imu.yaw = data.imu.yaw
    }
  }

  return {
    trigger,
    joyX,
    joyY,
    imu,
    lpfAlpha,
    runningType,
    calProgress,
    lastMessage,
    lastType,
    startCal,
    cancelCal,
    pollStatus,
    fetchCalData,
    applyCalRaw,
    setDeadzone,
    setLpf,
    zeroIMU,
    startStatusPolling,
    startCalTimeout,
    startCalDataPolling,
    stopTimers,
    stopCalDataPolling,
    handleResponse,
  }
})
