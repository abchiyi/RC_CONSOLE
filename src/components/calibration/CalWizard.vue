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
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useChannelStore } from '@/stores/channels'
import { useCalibrationStore, type CalType, type AdcCal } from '@/stores/calibration'

const chStore = useChannelStore()
const calStore = useCalibrationStore()

// reactive 对象直接引用即保持响应式
const trigger = calStore.trigger
const joyX = calStore.joyX
const joyY = calStore.joyY
const imu = calStore.imu

// ref 必须通过 storeToRefs() 保持响应式绑定，否则 auto-unwrap 后变成纯值快照
const { runningType, calProgress, lastMessage, lastType, lpfAlpha } = storeToRefs(calStore)

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

// --- 校准控制（封装 Store 方法） ---
async function startCal(type: CalType): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCal(type)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

async function cancelCal(): Promise<void> {
  calStore.cancelCal()
}

// --- 死区 ---
const deadzoneTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function debounceDeadzone(type: string): void {
  if (deadzoneTimers[type]) clearTimeout(deadzoneTimers[type])
  deadzoneTimers[type] = setTimeout(async () => {
    const dz = type === 'trigger' ? trigger.deadzone
      : type === 'joy_x' ? joyX.deadzone : joyY.deadzone
    await calStore.setDeadzone(type, dz)
  }, 300)
}

// --- LPF ---
let lpfTimer: ReturnType<typeof setTimeout> | null = null
function sendLpf(): void {
  if (lpfTimer) clearTimeout(lpfTimer)
  lpfTimer = setTimeout(async () => {
    await calStore.setLpf(lpfAlpha.value)
  }, 300)
}

// --- IMU 归零 ---
async function zeroIMU(): Promise<void> {
  await calStore.zeroIMU()
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
onMounted(async () => {
  // 先停通道流，让校准流独占流会话（固件单流会话，后发覆盖先发，避免 ct=0/ct=1 互相覆盖）
  await chStore.stopPolling()
  // 获取初始校准数据
  setTimeout(() => calStore.fetchCalData(), 300)
  // 持续推送实时 raw/IMU 值 (STREAM content_type=1)
  calStore.startCalDataPolling(100)  // 30→100ms，降低串口命令频率，避免 ESP32 栈溢出
})

onUnmounted(async () => {
  calStore.stopTimers()
  calStore.stopCalDataPolling()
  // 离开校准页，恢复通道流
  await chStore.startPolling()
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
