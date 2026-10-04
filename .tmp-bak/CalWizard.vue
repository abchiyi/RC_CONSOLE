<template>
  <div class="cal-root">
    <!-- ==================== IMU 姿态 (3D 模型) ==================== -->
    <ImuCard :imu="imu" :running="runningType === 'imu'" :progress="calProgress"
      :message="lastType === 'imu' ? lastMessage : null" />
    <!-- ==================== 扳机校准 ==================== -->
    <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-gamepad-right</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          扳机
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
        <!-- 实时量程条: raw → 位置 + 中心线 + 死区高亮 -->
        <div class="range-meter">
          <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
            <span class="mono">{{ trigger.raw_min ?? '--' }}</span>
            <v-spacer />
            <span class="mono text-primary">{{ trigger.raw_center ?? '--' }}</span>
            <v-spacer />
            <span class="mono">{{ trigger.raw_max ?? '--' }}</span>
          </div>
          <div class="range-track">
            <div class="range-fill" :style="{ width: rawPercent(trigger) + '%', background: 'linear-gradient(90deg, rgb(var(--v-theme-primary)), #4fc3f7)' }" />
            <div v-if="hasRange(trigger)" class="range-deadzone"
              :style="deadzoneStyle(trigger)" />
            <div v-if="hasRange(trigger)" class="range-center" :style="{ left: centerPercent(trigger) + '%' }" />
            <div class="range-thumb" :style="{ left: rawPercent(trigger) + '%' }">
              <div class="range-thumb-dot" />
            </div>
          </div>
          <div class="d-flex mt-2 align-baseline">
            <span class="text-caption text-medium-emphasis mr-2">raw</span>
            <span class="mono text-h6 font-weight-bold">{{ trigger.raw ?? '--' }}</span>
          </div>
        </div>

        <div class="d-flex align-center mb-1">
          <span class="text-caption text-medium-emphasis mr-2">死区</span>
          <v-chip size="x-small" variant="tonal" class="mono">{{ trigger.deadzone }}</v-chip>
        </div>
        <v-slider v-model.number="trigger.deadzone" class="dz-slider dz-primary" :min="0" :max="500" :step="1" density="compact" hide-details
          color="primary" thumb-label :disabled="runningType !== null" @end="debounceDeadzone('trigger')" />

        <div class="cal-hint">
          <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
          <span>观察往复推动的定位精度与中心抖动，死区需罩住中心附近抖动范围；<b>轻触时产生的微小偏移也需考虑在内</b></span>
        </div>

        <v-progress-linear v-if="runningType === 'trigger'" :model-value="calProgress" color="warning" class="mt-3"
          height="6" rounded />
        <v-alert v-if="lastMessage && lastType === 'trigger'" class="mt-3 py-1" density="compact"
          :color="runningType === 'trigger' ? 'warning' : 'success'" variant="tonal">
          {{ lastMessage }}
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- ==================== 摇杆校准 (性能展示) ==================== -->
    <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
      <v-card-item>
        <template #prepend>
          <v-avatar color="success" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-gamepad-variant</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          摇杆
        </v-card-title>
        <v-card-subtitle>摇杆实时位置与行程范围 (校准请使用工具栏"校准"向导)</v-card-subtitle>
        <template #append>
          <v-chip v-if="runningType === 'joy_xy'" color="warning" size="small" variant="tonal">
            <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
            {{ calProgress }}%
          </v-chip>
        </template>
      </v-card-item>

      <v-card-text>
        <div class="joy-2d-wrap">
          <!-- 2D 十字: X/Y 实时位置 -->
          <svg :viewBox="`0 0 ${JOY2D_SIZE} ${JOY2D_SIZE}`" class="joy-2d">
            <rect x="1" y="1" :width="JOY2D_SIZE - 2" :height="JOY2D_SIZE - 2" rx="12" class="joy-2d-bg" />
            <!-- 十字轴线 -->
            <line :x1="JOY2D_SIZE / 2" y1="8" :x2="JOY2D_SIZE / 2" :y2="JOY2D_SIZE - 8" class="joy-2d-line" />
            <line x1="8" :y1="JOY2D_SIZE / 2" :x2="JOY2D_SIZE - 8" :y2="JOY2D_SIZE / 2" class="joy-2d-line" />
            <!-- 边界框 -->
            <rect :x="8" y="8" :width="JOY2D_SIZE - 16" :height="JOY2D_SIZE - 16" rx="8" class="joy-2d-bound" />
            <!-- 实时位置点 (白色小点) -->
            <circle :cx="joyDot.x" :cy="joyDot.y" r="3" class="joy-2d-dot" />
            <!-- 中心死区圆环 (半径 = 死区占行程真实比例, 0 死区不显示) -->
            <circle v-if="joyRingR > 0" :cx="JOY2D_SIZE / 2" :cy="JOY2D_SIZE / 2" :r="joyRingR" class="joy-2d-ring" />
          </svg>
          <div class="joy-2d-readout">
            <div class="joy-axis-row">
              <span class="text-caption text-medium-emphasis">X</span>
              <span class="mono font-weight-bold text-success">{{ joyX.raw ?? '--' }}</span>
            </div>
            <div class="joy-axis-row">
              <span class="text-caption text-medium-emphasis">Y</span>
              <span class="mono font-weight-bold text-info">{{ joyY.raw ?? '--' }}</span>
            </div>
          </div>
        </div>

        <!-- X/Y 实时量程条 (同扳机: 死区高亮 + 中心线 + thumb) -->
        <div class="range-meter mt-3">
          <div class="mb-2">
            <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
              <span class="mono">{{ joyX.raw_min ?? '--' }}</span>
              <v-spacer />
              <span class="mono text-success">{{ joyX.raw_center ?? '--' }}</span>
              <v-spacer />
              <span class="mono">{{ joyX.raw_max ?? '--' }}</span>
            </div>
            <div class="range-track">
              <div class="range-fill" :style="{ width: rawPercent(joyX) + '%', background: 'linear-gradient(90deg, rgb(var(--v-theme-success)), #69f0ae)' }" />
              <div v-if="hasRange(joyX)" class="range-deadzone" :style="deadzoneStyle(joyX)" />
              <div v-if="hasRange(joyX)" class="range-center" :style="{ left: centerPercent(joyX) + '%' }" />
              <div class="range-thumb" :style="{ left: rawPercent(joyX) + '%' }">
                <div class="range-thumb-dot" />
              </div>
            </div>
            <div class="d-flex mt-1 align-baseline">
              <span class="text-caption text-medium-emphasis mr-2">X</span>
              <span class="mono font-weight-bold text-success">{{ joyX.raw ?? '--' }}</span>
            </div>
          </div>
          <div>
            <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
              <span class="mono">{{ joyY.raw_min ?? '--' }}</span>
              <v-spacer />
              <span class="mono text-info">{{ joyY.raw_center ?? '--' }}</span>
              <v-spacer />
              <span class="mono">{{ joyY.raw_max ?? '--' }}</span>
            </div>
            <div class="range-track">
              <div class="range-fill" :style="{ width: rawPercent(joyY) + '%', background: 'linear-gradient(90deg, rgb(var(--v-theme-info)), #448aff)' }" />
              <div v-if="hasRange(joyY)" class="range-deadzone" :style="deadzoneStyle(joyY)" />
              <div v-if="hasRange(joyY)" class="range-center" :style="{ left: centerPercent(joyY) + '%' }" />
              <div class="range-thumb" :style="{ left: rawPercent(joyY) + '%' }">
                <div class="range-thumb-dot" />
              </div>
            </div>
            <div class="d-flex mt-1 align-baseline">
              <span class="text-caption text-medium-emphasis mr-2">Y</span>
              <span class="mono font-weight-bold text-info">{{ joyY.raw ?? '--' }}</span>
            </div>
          </div>
        </div>
        <div class="cal-hint">
          <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
          <span>观察往复推动的定位精度与中心抖动，死区需罩住中心附近抖动范围；<b>轻触时产生的微小偏移也需考虑在内</b></span>
        </div>

        <!-- 死区设置 (X/Y 合并) -->
        <div class="d-flex align-center mb-1">
          <span class="text-caption text-medium-emphasis mr-2">死区 (X/Y)</span>
          <v-chip size="x-small" variant="tonal" class="mono">{{ joyX.deadzone }}</v-chip>
        </div>
        <v-slider v-model.number="joyX.deadzone" class="dz-slider dz-success" :min="0" :max="500" :step="1" density="compact" hide-details
          color="success" thumb-label :disabled="runningType !== null" @end="debounceDeadzone('joy_xy')" />
      </v-card-text>
    </v-card>

    <!-- ==================== 全局设置 ==================== -->
    <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
      <v-card-item>
        <template #prepend>
          <v-avatar color="grey-darken-1" size="36" class="cal-avatar">
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
            <v-slider v-model.number="lpfAlpha" class="dz-slider dz-grey" :min="10" :max="990" :step="10" density="compact" hide-details
              color="grey-lighten-1" thumb-label @end="sendLpf" />
          </v-col>
          <v-col cols="3" class="text-right">
            <v-chip size="small" variant="tonal" class="mono">{{ lpfAlpha }}</v-chip>
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
import ImuCard from '@/components/calibration/ImuCard.vue'
import { useChannelStore } from '@/stores/channels'
import { useCalibrationStore, type AdcCal } from '@/stores/calibration'

const chStore = useChannelStore()
const calStore = useCalibrationStore()

// reactive 对象直接引用即保持响应式
const trigger = calStore.trigger
const joyX = calStore.joyX
const joyY = calStore.joyY
const imu = calStore.imu

// ref 必须通过 storeToRefs() 保持响应式绑定，否则 auto-unwrap 后变成纯值快照
const { runningType, calProgress, lastMessage, lastType, lpfAlpha } = storeToRefs(calStore)

// --- 死区 ---
const deadzoneTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function debounceDeadzone(type: string): void {
  if (deadzoneTimers[type]) clearTimeout(deadzoneTimers[type])
  deadzoneTimers[type] = setTimeout(async () => {
    if (type === 'joy_xy') {
      // X/Y 合并死区: 同值写入两轴并分别下发
      const dz = joyX.deadzone
      joyY.deadzone = dz
      await calStore.setDeadzone('joy_x', dz)
      await calStore.setDeadzone('joy_y', dz)
      return
    }
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

/** 死区高亮段样式: 以中心线为对称轴, 半宽 = deadzone/范围 */
function deadzoneStyle(data: AdcCal): Record<string, string> {
  const { deadzone, raw_min, raw_max } = data
  if (raw_min === undefined || raw_max === undefined) return {}
  const range = raw_max - raw_min
  if (range <= 0) return {}
  const half = Math.min(50, (deadzone / range) * 100)
  const c = centerPercent(data)
  const left = Math.max(0, c - half)
  return { left: left + '%', width: (Math.min(100, c + half) - left) + '%' }
}

// --- 摇杆 2D 十字 ---
const JOY2D_SIZE = 200
/** 位置点最大偏移半径 (SVG 坐标), 对应归一化 ±1 */
const JOY_RADIUS = 72

/** raw → [-1,1]: 以校准中心为 0, min/max 为 ±1, 按中心两侧分段线性 */
function normalizeStickAxis(raw: number | undefined, cal: AdcCal): number {
  const { raw_center, raw_min, raw_max } = cal
  if (raw === undefined || raw_center === undefined || raw_min === undefined || raw_max === undefined) return 0
  if (raw_center === raw_min || raw_center === raw_max) return 0
  return raw < raw_center
    ? (raw - raw_center) / (raw_center - raw_min)
    : (raw - raw_center) / (raw_max - raw_center)
}

/** 按各轴校准量程归一化 → SVG 坐标 */
const joyDot = computed(() => {
  const nx = Math.max(-1, Math.min(1, normalizeStickAxis(joyX.raw, joyX)))
  const ny = Math.max(-1, Math.min(1, normalizeStickAxis(joyY.raw, joyY)))
  const c = JOY2D_SIZE / 2
  return {
    x: c + nx * JOY_RADIUS,
    y: c - ny * JOY_RADIUS, // Y 轴向下为 +, 反转
  }
})

/** 中心死区圆环半径: 死区占 X 轴半行程的真实比例 × JOY_RADIUS, 线性真实映射 (SVG 坐标) */
const joyRingR = computed(() => {
  const dz = joyX.deadzone ?? 0
  const { raw_min, raw_center, raw_max } = joyX
  if (dz <= 0) return 0
  if (raw_min === undefined || raw_center === undefined || raw_max === undefined) return 0
  const half = Math.max(raw_center - raw_min, raw_max - raw_center)
  if (half <= 0) return 0
  const ratio = Math.min(1, Math.max(0, dz / half))
  return ratio * JOY_RADIUS
})

// --- 生命周期 ---
/** 全局底栏「从设备加载」: 让设备丢弃内存改动 (0x0107 → 从 NVS 重建) 后重新拉取校准数据,
 *  与通道配置页同一套语义; 完成后回报 App 关闭全局按钮 loading */
async function onGlobalReload() {
  try {
    await calStore.reloadFromNvs()
  } finally {
    window.dispatchEvent(new CustomEvent('app:reload-done'))
  }
}

onMounted(() => {
  window.addEventListener('app:reload-from-device', onGlobalReload)
  // 不再先停通道流：固件 stream_start 自带 stop，stream.ts 仲裁器已按优先级去抖下发，
  // 先发 stream_stop 反而可能迟到并关掉本页刚启动的校准流
  // 获取初始校准数据
  setTimeout(() => calStore.fetchCalData(), 300)
  // 持续推送实时 raw/IMU 值 (STREAM content_type=1)
  calStore.startCalDataPolling(100)  // 30→100ms，降低串口命令频率，避免 ESP32 栈溢出
})

onUnmounted(async () => {
  window.removeEventListener('app:reload-from-device', onGlobalReload)
  calStore.stopTimers()
  calStore.stopCalDataPolling()
  // 离开校准页，恢复通道流
  await chStore.startPolling()
})
</script>

<style scoped>
/* 与通道设置页风格一致: 纯色卡片 + 通栏 */
.cal-root {
  width: 100%;
}

.cal-card {
  background: #1e1e1e !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  transition: border-color 0.3s, background-color 0.3s;
}

.cal-card:hover {
  border-color: rgba(255, 255, 255, 0.16) !important;
}

/* 等宽数字字体 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* 提示块下方的内容保持间距: 本组件提示块只带 margin-top,
   否则紧随其后的行 (如摇杆卡「死区 (X/Y)」标签行) 会紧贴提示块。
   注: Vue 的 mt-* 工具类带 !important, 原本已显式留白的位置不受影响。 */
.cal-hint + * {
  margin-top: 12px;
}

/* 独立提示块: 高亮边框 + 有色背景 */
.cal-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 179, 0, 0.5);
  background: rgba(255, 179, 0, 0.1);
  color: rgba(255, 235, 190, 0.9);
  font-size: 0.75rem;
  line-height: 1.45;
}

/* 滑块气泡: 加粗等宽数字 + 白色细边框, 配色按各自轨道色 */
.dz-slider :deep(.v-slider-thumb__label) {
  font-weight: 700;
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

/* 扳机死区: primary 气泡 */
.dz-primary :deep(.v-slider-thumb__label) {
  background: rgb(var(--v-theme-primary)) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
}
.dz-primary :deep(.v-slider-thumb__label::before) {
  border-top-color: rgb(var(--v-theme-primary)) !important;
}

/* 摇杆死区: success 气泡 */
.dz-success :deep(.v-slider-thumb__label) {
  background: rgb(var(--v-theme-success)) !important;
  color: rgb(var(--v-theme-on-success)) !important;
}
.dz-success :deep(.v-slider-thumb__label::before) {
  border-top-color: rgb(var(--v-theme-success)) !important;
}

/* LPF: grey-lighten-1 气泡 (主题无此变量, 直接用色值 #BDBDBD) */
.dz-grey :deep(.v-slider-thumb__label) {
  background: #bdbdbd !important;
  color: #1a1a1a !important;
}
.dz-grey :deep(.v-slider-thumb__label::before) {
  border-top-color: #bdbdbd !important;
}

/* 量程条 */
.range-track {
  position: relative;
  height: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: visible;
}

.range-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: 8px;
  transition: width 0.1s linear;
}

.range-deadzone {
  position: absolute;
  top: -3px;
  bottom: -3px;
  background: rgba(255, 152, 0, 0.18);
  border: 1px dashed rgba(255, 152, 0, 0.5);
  border-radius: 4px;
  transition: left 0.2s, width 0.2s;
}

.range-center {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: rgba(255, 255, 255, 0.55);
  transform: translateX(-50%);
  transition: left 0.2s;
}

.range-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: left 0.1s linear;
}

.range-thumb-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  border: 2px solid #fff;
}

/* 摇杆 2D */
.joy-2d-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.joy-2d {
  width: 240px;
  height: 240px;
}

.joy-2d-bg {
  fill: rgba(0, 0, 0, 0.35);
  stroke: rgba(255, 255, 255, 0.1);
}

.joy-2d-line {
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 1;
}

.joy-2d-ring {
  fill: none;
  stroke: rgb(var(--v-theme-warning));
  stroke-width: 1.5;
  opacity: 0.9;
}

.joy-2d-bound {
  fill: none;
  stroke: rgba(255, 255, 255, 0.14);
  stroke-dasharray: 4 4;
}

.joy-2d-dot {
  fill: #fff;
  transition: cx 0.1s linear, cy 0.1s linear;
}

.joy-2d-readout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 90px;
}

.joy-axis-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

/* 响应式: 窄屏下 2D 与读数值堆叠 */
@media (max-width: 420px) {
  .joy-2d-wrap {
    flex-direction: column;
  }
}
</style>
