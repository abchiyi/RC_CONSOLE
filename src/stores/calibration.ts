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
    }, 15000)
  }

  function startCalDataPolling(intervalMs = 30): void {
    calDataTimer = setInterval(() => { fetchCalData() }, intervalMs)
  }

  function stopTimers(): void {
    runningType.value = null
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null }
    if (calTimeout) { clearTimeout(calTimeout); calTimeout = null }
  }

  function stopCalDataPolling(): void {
    if (calDataTimer) { clearInterval(calDataTimer); calDataTimer = null }
  }

  // ---- 响应处理 ----

  function handleResponse(json: Record<string, unknown>): void {
    // cal_status 响应
    if (json.cmd === 'cal_status' || json.state !== undefined) {
      const st = (json.state ?? json.type ?? '') as string
      calProgress.value = (json.progress as number) ?? 0
      if (st === 'done' || st === 2) {
        lastMessage.value = (json.message as string) || '校准完成'
        lastType.value = runningType.value
        stopTimers()
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

    // cal_get 响应
    if (json.adc || json.imu || json.lpf_alpha !== undefined) {
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
        if (adc.trigger.deadzone !== undefined) trigger.deadzone = adc.trigger.deadzone
      }
      if (adc.joy_x) {
        joyX.raw = raw.joy_x
        joyX.raw_min = adc.joy_x.min
        joyX.raw_center = adc.joy_x.center
        joyX.raw_max = adc.joy_x.max
        if (adc.joy_x.deadzone !== undefined) joyX.deadzone = adc.joy_x.deadzone
      }
      if (adc.joy_y) {
        joyY.raw = raw.joy_y
        joyY.raw_min = adc.joy_y.min
        joyY.raw_center = adc.joy_y.center
        joyY.raw_max = adc.joy_y.max
        if (adc.joy_y.deadzone !== undefined) joyY.deadzone = adc.joy_y.deadzone
      }
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
