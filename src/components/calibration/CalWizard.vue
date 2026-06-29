<template>
  <div class="pa-4">
    <!-- ==================== 扳机校准 ==================== -->
    <v-card rounded="lg" variant="outlined" class="mb-4">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" size="36">
            <v-icon color="white" size="20">mdi-gamepad-right</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          扳机校准
          <v-chip v-if="sourceChannel('ANALOG_TRIGGER') >= 0" size="x-small" variant="tonal" class="ml-1"
            color="primary">CH{{ sourceChannel('ANALOG_TRIGGER') }}</v-chip>
        </v-card-title>
        <v-card-subtitle>校准扳机 (Trigger) 的零位与行程范围</v-card-subtitle>
        <template #append>
          <v-chip v-if="runningType === 'trigger'" color="warning" size="small" variant="tonal">
            <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
            {{ calProgress }}%
          </v-chip>
        </template>
      </v-card-item>
      <v-card-text>
        <!-- 进度条: raw 范围映射 -->
        <div class="mb-2">
          <div class="d-flex text-caption text-medium-emphasis mb-1">
            <span>{{ trigger.raw_min ?? '--' }}</span>
            <v-spacer />
            <span class="text-primary">{{ trigger.raw_center ?? '--' }}</span>
            <v-spacer />
            <span>{{ trigger.raw_max ?? '--' }}</span>
          </div>
          <div class="cal-bar-wrap">
            <v-progress-linear :model-value="rawPercent(trigger)" color="primary" height="10" rounded />
            <div v-if="hasRange(trigger)" class="cal-center-line" :style="{ left: centerPercent(trigger) + '%' }" />
          </div>
          <div class="d-flex mt-1">
            <span class="text-caption">raw: <b>{{ trigger.raw ?? '--' }}</b></span>
          </div>
        </div>
        <v-divider class="my-2" />
        <v-row dense>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">最小</span>
            <div class="font-weight-bold">{{ trigger.raw_min ?? '--' }}</div>
          </v-col>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">中心</span>
            <div class="font-weight-bold">{{ trigger.raw_center ?? '--' }}</div>
          </v-col>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">最大</span>
            <div class="font-weight-bold">{{ trigger.raw_max ?? '--' }}</div>
          </v-col>
        </v-row>
        <v-divider class="my-2" />
        <div class="text-caption text-medium-emphasis mb-1">死区</div>
        <v-slider v-model.number="trigger.deadzone" :min="0" :max="500" :step="1" density="compact" hide-details
          thumb-label :disabled="runningType !== null" @end="debounceDeadzone('trigger')" />
        <v-progress-linear v-if="runningType === 'trigger'" :model-value="calProgress" color="warning" class="mt-2"
          height="4" rounded />
        <v-alert v-if="lastMessage && lastType === 'trigger'" class="mt-2 py-1" density="compact"
          :color="runningType === 'trigger' ? 'warning' : 'success'" variant="tonal">
          {{ lastMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn v-if="runningType !== 'trigger'" color="primary" prepend-icon="mdi-play" variant="tonal"
          @click="startCal('trigger')">开始校准</v-btn>
        <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
      </v-card-actions>
    </v-card>

    <!-- ==================== 摇杆 X 校准 ==================== -->
    <v-card rounded="lg" variant="outlined" class="mb-4">
      <v-card-item>
        <template #prepend>
          <v-avatar color="success" size="36">
            <v-icon color="white" size="20">mdi-axis-x-arrow</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          摇杆 X 校准
          <v-chip v-if="sourceChannel('ANALOG_JOYSTICK_X') >= 0" size="x-small" variant="tonal" class="ml-1"
            color="success">CH{{ sourceChannel('ANALOG_JOYSTICK_X') }}</v-chip>
        </v-card-title>
        <v-card-subtitle>校准摇杆 X 轴的零位与行程范围</v-card-subtitle>
        <template #append>
          <v-chip v-if="runningType === 'joy_x'" color="warning" size="small" variant="tonal">
            <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
            {{ calProgress }}%
          </v-chip>
        </template>
      </v-card-item>
      <v-card-text>
        <div class="mb-2">
          <div class="d-flex text-caption text-medium-emphasis mb-1">
            <span>{{ joyX.raw_min ?? '--' }}</span>
            <v-spacer />
            <span class="text-success">{{ joyX.raw_center ?? '--' }}</span>
            <v-spacer />
            <span>{{ joyX.raw_max ?? '--' }}</span>
          </div>
          <div class="cal-bar-wrap">
            <v-progress-linear :model-value="rawPercent(joyX)" color="success" height="10" rounded />
            <div v-if="hasRange(joyX)" class="cal-center-line" :style="{ left: centerPercent(joyX) + '%' }" />
          </div>
          <div class="d-flex mt-1">
            <span class="text-caption">raw: <b>{{ joyX.raw ?? '--' }}</b></span>
          </div>
        </div>
        <v-divider class="my-2" />
        <v-row dense>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">最小</span>
            <div class="font-weight-bold">{{ joyX.raw_min ?? '--' }}</div>
          </v-col>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">中心</span>
            <div class="font-weight-bold">{{ joyX.raw_center ?? '--' }}</div>
          </v-col>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">最大</span>
            <div class="font-weight-bold">{{ joyX.raw_max ?? '--' }}</div>
          </v-col>
        </v-row>
        <v-divider class="my-2" />
        <div class="text-caption text-medium-emphasis mb-1">死区</div>
        <v-slider v-model.number="joyX.deadzone" :min="0" :max="500" :step="1" density="compact" hide-details
          thumb-label :disabled="runningType !== null" @end="debounceDeadzone('joy_x')" />
        <v-progress-linear v-if="runningType === 'joy_x'" :model-value="calProgress" color="warning" class="mt-2"
          height="4" rounded />
        <v-alert v-if="lastMessage && lastType === 'joy_x'" class="mt-2 py-1" density="compact"
          :color="runningType === 'joy_x' ? 'warning' : 'success'" variant="tonal">
          {{ lastMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn v-if="runningType !== 'joy_x'" color="success" prepend-icon="mdi-play" variant="tonal"
          @click="startCal('joy_x')">开始校准</v-btn>
        <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
      </v-card-actions>
    </v-card>

    <!-- ==================== 摇杆 Y 校准 ==================== -->
    <v-card rounded="lg" variant="outlined" class="mb-4">
      <v-card-item>
        <template #prepend>
          <v-avatar color="info" size="36">
            <v-icon color="white" size="20">mdi-axis-y-arrow</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          摇杆 Y 校准
          <v-chip v-if="sourceChannel('ANALOG_JOYSTICK_Y') >= 0" size="x-small" variant="tonal" class="ml-1"
            color="info">CH{{ sourceChannel('ANALOG_JOYSTICK_Y') }}</v-chip>
        </v-card-title>
        <v-card-subtitle>校准摇杆 Y 轴的零位与行程范围</v-card-subtitle>
        <template #append>
          <v-chip v-if="runningType === 'joy_y'" color="warning" size="small" variant="tonal">
            <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
            {{ calProgress }}%
          </v-chip>
        </template>
      </v-card-item>
      <v-card-text>
        <div class="mb-2">
          <div class="d-flex text-caption text-medium-emphasis mb-1">
            <span>{{ joyY.raw_min ?? '--' }}</span>
            <v-spacer />
            <span class="text-info">{{ joyY.raw_center ?? '--' }}</span>
            <v-spacer />
            <span>{{ joyY.raw_max ?? '--' }}</span>
          </div>
          <div class="cal-bar-wrap">
            <v-progress-linear :model-value="rawPercent(joyY)" color="info" height="10" rounded />
            <div v-if="hasRange(joyY)" class="cal-center-line" :style="{ left: centerPercent(joyY) + '%' }" />
          </div>
          <div class="d-flex mt-1">
            <span class="text-caption">raw: <b>{{ joyY.raw ?? '--' }}</b></span>
          </div>
        </div>
        <v-divider class="my-2" />
        <v-row dense>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">最小</span>
            <div class="font-weight-bold">{{ joyY.raw_min ?? '--' }}</div>
          </v-col>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">中心</span>
            <div class="font-weight-bold">{{ joyY.raw_center ?? '--' }}</div>
          </v-col>
          <v-col cols="4">
            <span class="text-caption text-medium-emphasis">最大</span>
            <div class="font-weight-bold">{{ joyY.raw_max ?? '--' }}</div>
          </v-col>
        </v-row>
        <v-divider class="my-2" />
        <div class="text-caption text-medium-emphasis mb-1">死区</div>
        <v-slider v-model.number="joyY.deadzone" :min="0" :max="500" :step="1" density="compact" hide-details
          thumb-label :disabled="runningType !== null" @end="debounceDeadzone('joy_y')" />
        <v-progress-linear v-if="runningType === 'joy_y'" :model-value="calProgress" color="warning" class="mt-2"
          height="4" rounded />
        <v-alert v-if="lastMessage && lastType === 'joy_y'" class="mt-2 py-1" density="compact"
          :color="runningType === 'joy_y' ? 'warning' : 'success'" variant="tonal">
          {{ lastMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn v-if="runningType !== 'joy_y'" color="info" prepend-icon="mdi-play" variant="tonal"
          @click="startCal('joy_y')">开始校准</v-btn>
        <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
      </v-card-actions>
    </v-card>

    <!-- ==================== IMU 校准 ==================== -->
    <v-card rounded="lg" variant="outlined" class="mb-4">
      <v-card-item>
        <template #prepend>
          <v-avatar color="warning" size="36">
            <v-icon color="white" size="20">mdi-axis-arrow</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          IMU 校准
          <v-chip v-if="imuChs.length > 0" size="x-small" variant="tonal" class="ml-1"
            color="warning">CH{{ imuChs.join('/') }}</v-chip>
        </v-card-title>
        <v-card-subtitle>将设备静置后校准陀螺仪零偏</v-card-subtitle>
        <template #append>
          <v-chip v-if="runningType === 'imu'" color="warning" size="small" variant="tonal">
            <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
            {{ calProgress }}%
          </v-chip>
        </template>
      </v-card-item>
      <v-card-text>
        <v-row dense>
          <v-col cols="3">
            <div class="text-caption text-medium-emphasis mb-1">Roll</div>
            <div class="text-h6 font-weight-bold">{{ fmtDeg(imu.roll) }}</div>
          </v-col>
          <v-col cols="3">
            <div class="text-caption text-medium-emphasis mb-1">Pitch</div>
            <div class="text-h6 font-weight-bold">{{ fmtDeg(imu.pitch) }}</div>
          </v-col>
          <v-col cols="3">
            <div class="text-caption text-medium-emphasis mb-1">Yaw</div>
            <div class="text-h6 font-weight-bold">{{ fmtDeg(imu.yaw) }}</div>
          </v-col>
        </v-row>
        <v-divider class="my-2" />
        <div class="text-caption text-medium-emphasis mb-1">陀螺零偏</div>
        <v-row dense>
          <v-col cols="4">
            <span class="text-caption">X: {{ fmtBias(imu.gyro_bias_x) }}</span>
          </v-col>
          <v-col cols="4">
            <span class="text-caption">Y: {{ fmtBias(imu.gyro_bias_y) }}</span>
          </v-col>
          <v-col cols="4">
            <span class="text-caption">Z: {{ fmtBias(imu.gyro_bias_z) }}</span>
          </v-col>
        </v-row>
        <v-progress-linear v-if="runningType === 'imu'" :model-value="calProgress" color="warning" class="mt-2"
          height="4" rounded />
        <v-alert v-if="lastMessage && lastType === 'imu'" class="mt-2 py-1" density="compact"
          :color="runningType === 'imu' ? 'warning' : 'success'" variant="tonal">
          {{ lastMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn color="secondary" prepend-icon="mdi-crosshairs-gps" variant="tonal" @click="zeroIMU">归零</v-btn>
        <v-spacer />
        <v-btn v-if="runningType !== 'imu'" color="warning" prepend-icon="mdi-play" variant="tonal"
          @click="startCal('imu')">开始校准</v-btn>
        <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
      </v-card-actions>
    </v-card>

    <!-- ==================== 全局设置 ==================== -->
    <v-card rounded="lg" variant="outlined">
      <v-card-item>
        <template #prepend>
          <v-avatar color="grey-darken-1" size="36">
            <v-icon color="white" size="20">mdi-tune-variant</v-icon>
          </v-avatar>
        </template>
        <v-card-title>全局设置</v-card-title>
        <v-card-subtitle>低通滤波系数 (LPF α)</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-row dense align="center">
          <v-col cols="3">
            <span class="text-caption text-medium-emphasis">LPF α</span>
          </v-col>
          <v-col cols="6">
            <v-slider v-model.number="lpfAlpha" :min="10" :max="990" :step="10" density="compact" hide-details
              thumb-label @end="sendLpf" />
          </v-col>
          <v-col cols="3">
            <span class="text-caption">{{ lpfAlpha }}</span>
          </v-col>
        </v-row>
        <div class="text-caption text-medium-emphasis mt-1">
          值越小滤波越强 (响应慢、更平滑)，值越大响应越灵敏
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { serialService } from '@/services/SerialService'
import { useChannelStore } from '@/stores/channels'

const chStore = useChannelStore()

type CalType = 'trigger' | 'joy_x' | 'joy_y' | 'imu'

// --- 校准数据 ---
interface AdcCal {
  raw?: number
  raw_min?: number
  raw_center?: number
  raw_max?: number
  deadzone: number
}
const trigger = reactive<AdcCal>({ deadzone: 30 })
const joyX = reactive<AdcCal>({ deadzone: 30 })
const joyY = reactive<AdcCal>({ deadzone: 30 })

interface ImuCal {
  roll?: number
  pitch?: number
  yaw?: number
  gyro_bias_x?: number
  gyro_bias_y?: number
  gyro_bias_z?: number
}
const imu = reactive<ImuCal>({})

// --- 通道映射: 从 chStore 反查 source → CH# ---
function sourceChannel(source: string): number {
  return chStore.sources.findIndex(s => s === source)
}

/** IMU 相关通道索引列表 */
const imuChs = computed<number[]>(() => {
  const idxs: number[] = []
  chStore.sources.forEach((s, i) => {
    if (s === 'IMU_ROLL' || s === 'IMU_PITCH') idxs.push(i)
  })
  return idxs
})

// --- 校准状态 ---
const runningType = ref<CalType | null>(null)
const calProgress = ref(0)
const lastMessage = ref('')
const lastType = ref<CalType | null>(null)
let statusPollTimer: ReturnType<typeof setInterval> | null = null
let calTimeout: ReturnType<typeof setTimeout> | null = null
let calDataTimer: ReturnType<typeof setInterval> | null = null

// --- LPF ---
const lpfAlpha = ref(500)
let lpfInitialized = false

// --- 串口响应处理 ---
function handleLine(line: string): void {
  try {
    const msg = JSON.parse(line)
    // cal_status 响应
    if (msg.cmd === 'cal_status' || msg.state !== undefined) {
      const st = msg.state ?? msg.type ?? ''
      calProgress.value = msg.progress ?? 0
      if (st === 'done' || st === 2) {
        lastMessage.value = msg.message || '校准完成'
        lastType.value = runningType.value
        stopCal()
      } else if (st === 'error' || st === 3) {
        lastMessage.value = msg.message || '校准失败'
        lastType.value = runningType.value
        stopCal()
      } else if (st === 'running' || st === 1) {
        lastMessage.value = msg.message || '校准进行中…'
        lastType.value = runningType.value
      }
    }
    // cal_get 响应: {"adc":{"trigger":{min,center,max,deadzone,...},"raw":{...}},"imu":{...},"lpf_alpha":...}
    if (msg.adc || msg.imu || msg.lpf_alpha !== undefined) {
      applyCalData(msg)
    }
  } catch { /* ignore non-JSON */ }
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
  if (data.lpf_alpha !== undefined && !lpfInitialized) {
    lpfAlpha.value = data.lpf_alpha
    lpfInitialized = true
  }
}

// --- 校准控制 ---
async function startCal(type: CalType): Promise<void> {
  if (runningType.value) return
  runningType.value = type
  calProgress.value = 0
  lastMessage.value = '校准进行中…'
  lastType.value = type
  await serialService.sendCommand('cal_start', { type })

  // 轮询状态
  statusPollTimer = setInterval(async () => {
    await serialService.sendCommand('cal_status')
  }, 500)

  // 超时保护 15s
  calTimeout = setTimeout(() => {
    if (runningType.value) {
      lastMessage.value = '校准超时，请重试'
      stopCal()
    }
  }, 15000)
}

function stopCal(): void {
  runningType.value = null
  if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null }
  if (calTimeout) { clearTimeout(calTimeout); calTimeout = null }
}

async function cancelCal(): Promise<void> {
  lastMessage.value = '已取消'
  stopCal()
}

async function fetchCalData(): Promise<void> {
  await serialService.sendCommand('cal_get')
}

// --- 死区 ---
const deadzoneTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function debounceDeadzone(type: string): void {
  if (deadzoneTimers[type]) clearTimeout(deadzoneTimers[type])
  deadzoneTimers[type] = setTimeout(async () => {
    const dz = type === 'trigger' ? trigger.deadzone
      : type === 'joy_x' ? joyX.deadzone : joyY.deadzone
    await serialService.sendCommand('cal_set_deadzone', { type, deadzone: dz })
  }, 300)
}

// --- LPF ---
let lpfTimer: ReturnType<typeof setTimeout> | null = null
function sendLpf(): void {
  if (lpfTimer) clearTimeout(lpfTimer)
  lpfTimer = setTimeout(async () => {
    await serialService.sendCommand('cal_set_lpf_alpha', { alpha: lpfAlpha.value })
  }, 300)
}

// --- IMU 归零 ---
async function zeroIMU(): Promise<void> {
  await serialService.sendCommand('cal_zero_imu')
  lastMessage.value = 'IMU 已归零'
  lastType.value = 'imu'
  setTimeout(() => { lastMessage.value = '' }, 2000)
}

// --- 进度条计算 ---
function hasRange(data: AdcCal): boolean {
  return data.raw_min !== undefined && data.raw_max !== undefined && data.raw_center !== undefined && data.raw_min !== data.raw_max
}

function rawPercent(data: AdcCal): number {
  const { raw, raw_min, raw_max } = data
  if (raw === undefined || raw_min === undefined || raw_max === undefined) return 0
  const range = raw_max - raw_min
  if (range <= 0) return 0
  return Math.max(0, Math.min(100, ((raw - raw_min) / range) * 100))
}

function centerPercent(data: AdcCal): number {
  const { raw_center, raw_min, raw_max } = data
  if (raw_center === undefined || raw_min === undefined || raw_max === undefined) return 50
  const range = raw_max - raw_min
  if (range <= 0) return 50
  return ((raw_center - raw_min) / range) * 100
}

// --- 格式化 ---
function fmtDeg(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(1) + '°'
}
function fmtBias(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(4)
}

// --- 生命周期 ---
onMounted(() => {
  serialService.addLineListener(handleLine)
  // 自动开启通道轮询
  if (!chStore.polling) chStore.startPolling()
  // 获取初始校准数据
  setTimeout(() => fetchCalData(), 300)
  // 持续轮询 cal_get 以获取实时 raw 值 (30ms ≈ 33Hz)
  calDataTimer = setInterval(() => fetchCalData(), 30)
})

onUnmounted(() => {
  serialService.removeLineListener(handleLine)
  if (calDataTimer) { clearInterval(calDataTimer); calDataTimer = null }
  stopCal()
})
</script>

<style scoped>
.cal-bar-wrap {
  position: relative;
}

.cal-center-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--v-warning-base, #FF9800);
  transform: translateX(-50%);
  z-index: 1;
}
</style>
