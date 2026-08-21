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
  acc?: { x?: number; y?: number; z?: number }
  rate?: { x?: number; y?: number; z?: number }
  gyro_bias_x?: number
  gyro_bias_y?: number
  gyro_bias_z?: number
}

export type CalType = 'trigger' | 'joy_x' | 'joy_y' | 'joy_xy' | 'imu'

/** cubic-bezier 输出响应曲线: 端点固定 (0,0)/(100,100), 控制点 (x1,y1)/(x2,y2) 可调 (x:0~100, y:-100~100); 双向源奇函数对称 */
export interface OutputCurve {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type CurveType = 'trigger' | 'joy_x' | 'joy_y' | 'imu_roll' | 'imu_pitch'

export const useCalibrationStore = defineStore('calibration', () => {
  const trigger = reactive<AdcCal>({ deadzone: 30 })
  const joyX = reactive<AdcCal>({ deadzone: 30 })
  const joyY = reactive<AdcCal>({ deadzone: 30 })
  const imu = reactive<ImuCal>({})

  const triggerCurve = reactive<OutputCurve>({ x1: 50, y1: 50, x2: 50, y2: 50 })
  const joyXCurve = reactive<OutputCurve>({ x1: 50, y1: 50, x2: 50, y2: 50 })
  const joyYCurve = reactive<OutputCurve>({ x1: 50, y1: 50, x2: 50, y2: 50 })
  const imuRollCurve = reactive<OutputCurve>({ x1: 50, y1: 50, x2: 50, y2: 50 })
  const imuPitchCurve = reactive<OutputCurve>({ x1: 50, y1: 50, x2: 50, y2: 50 })

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

  /** 分步校准: step=1 居中采样, step=2 行程扫描+落盘 (摇杆校准向导) */
  async function startCalStep(type: CalType, step: 1 | 2): Promise<void> {
    runningType.value = type
    calProgress.value = 0
    lastMessage.value = step === 1 ? '请保持居中，等待采样…' : '请推动到行程两端…'
    lastType.value = type
    await serialService.sendCommand('cal_step', { type, step })
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

  /** 写入输出响应曲线 (cubic-bezier 4 参数), 固件立即持久化到 NVS; 启用与否由模型级开关控制 */
  async function setCurve(type: CurveType, c: OutputCurve): Promise<void> {
    await serialService.sendCommand('cal_set_curve', {
      type, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2,
    })
  }

  // 0位校准响应确认（cal_zero_imu → {cmd, ok}）
  let zeroIMUResolvers: Array<(ok: boolean) => void> = []
  let zeroIMUTimer: ReturnType<typeof setTimeout> | null = null

  function resolveZeroIMU(ok: boolean): void {
    if (zeroIMUTimer) { clearTimeout(zeroIMUTimer); zeroIMUTimer = null }
    const resolvers = zeroIMUResolvers
    zeroIMUResolvers = []
    resolvers.forEach(r => r(ok))
  }

  async function zeroIMU(): Promise<boolean> {
    const ok = await new Promise<boolean>(resolve => {
      zeroIMUResolvers.push(resolve)
      zeroIMUTimer = setTimeout(() => {
        const idx = zeroIMUResolvers.indexOf(resolve)
        if (idx >= 0) zeroIMUResolvers.splice(idx, 1)
        resolve(false) // 超时视为失败
      }, 3000)
      serialService.sendCommand('cal_zero_imu')
    })
    if (ok) {
      lastMessage.value = 'IMU 已归零'
      lastType.value = 'imu'
      setTimeout(() => { lastMessage.value = '' }, 2000)
    }
    return ok
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
        fetchCalData()            // 拉取最终 min/center/max + deadzone
      } else if (st === 'error' || st === 3) {
        lastMessage.value = (json.message as string) || '校准失败'
        lastType.value = runningType.value
        stopTimers()
      } else if (st === 'running' || st === 1) {
        lastMessage.value = (json.message as string) || '校准进行中…'
        lastType.value = runningType.value
        // 校准中固件正在修改 min/center/max 与 gyroBias, 500ms 轮询会把
        // "校准中间参数"覆盖进 UI 导致量程/百分比/图形/输出全部跳动;
        // 实时 raw+IMU 已由 STREAM content_type=1 (100ms) 独立推送
      }
      return
    }

    // cal_zero_imu 响应 (0位校准: 成功 {cmd, ok:true} / 失败 {cmd, ok:false, error, status})
    if (json.cmd === 'cal_zero_imu') {
      const ok = json.ok === true
      resolveZeroIMU(ok)
      if (!ok) {
        // status=4 (S_BUSY) = 设备未静止; 其余透传固件 error
        lastMessage.value = json.status === 4 ? '归零失败：设备未静止，请保持水平稳定后重试' : ('归零失败：' + (json.error ?? '未知错误'))
        lastType.value = 'imu'
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
      // 输出响应曲线 (cubic-bezier)
      if (adc.trigger_curve) {
        triggerCurve.x1 = adc.trigger_curve.x1 ?? 50
        triggerCurve.y1 = adc.trigger_curve.y1 ?? 50
        triggerCurve.x2 = adc.trigger_curve.x2 ?? 50
        triggerCurve.y2 = adc.trigger_curve.y2 ?? 50
      }
      if (adc.joy_x_curve) {
        joyXCurve.x1 = adc.joy_x_curve.x1 ?? 50
        joyXCurve.y1 = adc.joy_x_curve.y1 ?? 50
        joyXCurve.x2 = adc.joy_x_curve.x2 ?? 50
        joyXCurve.y2 = adc.joy_x_curve.y2 ?? 50
      }
      if (adc.joy_y_curve) {
        joyYCurve.x1 = adc.joy_y_curve.x1 ?? 50
        joyYCurve.y1 = adc.joy_y_curve.y1 ?? 50
        joyYCurve.x2 = adc.joy_y_curve.x2 ?? 50
        joyYCurve.y2 = adc.joy_y_curve.y2 ?? 50
      }
      if (adc.imu_roll_curve) {
        imuRollCurve.x1 = adc.imu_roll_curve.x1 ?? 50
        imuRollCurve.y1 = adc.imu_roll_curve.y1 ?? 50
        imuRollCurve.x2 = adc.imu_roll_curve.x2 ?? 50
        imuRollCurve.y2 = adc.imu_roll_curve.y2 ?? 50
      }
      if (adc.imu_pitch_curve) {
        imuPitchCurve.x1 = adc.imu_pitch_curve.x1 ?? 50
        imuPitchCurve.y1 = adc.imu_pitch_curve.y1 ?? 50
        imuPitchCurve.x2 = adc.imu_pitch_curve.x2 ?? 50
        imuPitchCurve.y2 = adc.imu_pitch_curve.y2 ?? 50
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
      if (data.imu.acc) imu.acc = { ...data.imu.acc }
      if (data.imu.rate) imu.rate = { ...data.imu.rate }
    }
  }

  return {
    trigger,
    joyX,
    joyY,
    imu,
    triggerCurve,
    joyXCurve,
    joyYCurve,
    imuRollCurve,
    imuPitchCurve,
    lpfAlpha,
    runningType,
    calProgress,
    lastMessage,
    lastType,
    startCal,
    startCalStep,
    cancelCal,
    pollStatus,
    fetchCalData,
    applyCalRaw,
    setDeadzone,
    setLpf,
    setCurve,
    zeroIMU,
    startStatusPolling,
    startCalTimeout,
    startCalDataPolling,
    stopTimers,
    stopCalDataPolling,
    handleResponse,
  }
})
