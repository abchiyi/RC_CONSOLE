<template>
  <v-dialog v-model="open" max-width="720" persistent>
    <v-card rounded="lg" elevation="0">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-wizard-hat</v-icon>
          </v-avatar>
        </template>
        <v-card-title>校准向导</v-card-title>
        <v-card-subtitle>按 IMU → 扳机 → 摇杆 的顺序完成校准</v-card-subtitle>
        <template #append>
          <v-btn icon="mdi-close" variant="text" size="small" @click="closeGuide" />
        </template>
      </v-card-item>

      <v-card-text>
        <v-stepper v-model="step" complete-icon="mdi-check-circle" edit-icon="mdi-cog">
          <v-stepper-header>
            <v-stepper-item v-for="(t, i) in stepTitles" :key="i" :value="i" :title="t"
              :complete="i < step" :disabled="i > maxStep" />
          </v-stepper-header>

          <v-stepper-window>
            <!-- 步骤 0: IMU -->
            <v-stepper-window-item :value="0">
              <v-alert type="info" density="compact" variant="tonal" class="mb-2">
                将设备<span class="font-weight-bold">静置不动</span>，自动校准陀螺仪零偏（约 6 秒）。
              </v-alert>

              <div class="d-flex align-center justify-space-between my-3">
                <span class="text-caption text-medium-emphasis">校准进度</span>
                <v-chip v-if="runningType === 'imu'" color="warning" size="small" variant="tonal">
                  <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
                  {{ calProgress }}%
                </v-chip>
              </div>
              <v-progress-linear v-if="runningType === 'imu'" :model-value="calProgress" color="warning" height="6"
                rounded />
              <v-alert v-if="lastMessage && lastType === 'imu'" class="mt-3 py-1" density="compact"
                :color="runningType === 'imu' ? 'warning' : 'success'" variant="tonal">
                {{ lastMessage }}
              </v-alert>

              <div v-if="imuDone" class="stat-grid mt-3">
                <div class="stat-col">
                  <span class="text-caption text-medium-emphasis">偏置 X</span>
                  <div class="mono font-weight-bold text-warning">{{ fmtBias(imu.gyro_bias_x) }}</div>
                </div>
                <div class="stat-col">
                  <span class="text-caption text-medium-emphasis">偏置 Y</span>
                  <div class="mono font-weight-bold text-warning">{{ fmtBias(imu.gyro_bias_y) }}</div>
                </div>
                <div class="stat-col">
                  <span class="text-caption text-medium-emphasis">偏置 Z</span>
                  <div class="mono font-weight-bold text-warning">{{ fmtBias(imu.gyro_bias_z) }}</div>
                </div>
              </div>

              <div class="d-flex justify-end mt-3">
                <v-btn color="grey" variant="text" @click="closeGuide">关闭</v-btn>
              </div>
            </v-stepper-window-item>

            <!-- 步骤 1: 扳机 -->
            <v-stepper-window-item :value="1">
              <v-alert type="info" density="compact" variant="tonal" class="mb-2">
                正在校准扳机（Trigger）零位与行程，请<span class="font-weight-bold">不要触碰扳机</span>。
              </v-alert>

              <div class="d-flex align-center justify-space-between my-3">
                <span class="text-caption text-medium-emphasis">校准进度</span>
                <v-chip v-if="runningType === 'trigger'" color="warning" size="small" variant="tonal">
                  <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
                  {{ calProgress }}%
                </v-chip>
              </div>
              <v-progress-linear v-if="runningType === 'trigger'" :model-value="calProgress" color="warning" height="6"
                rounded />
              <v-alert v-if="lastMessage && lastType === 'trigger'" class="mt-3 py-1" density="compact"
                :color="runningType === 'trigger' ? 'warning' : 'success'" variant="tonal">
                {{ lastMessage }}
              </v-alert>

              <div v-if="triggerDone" class="stat-grid mt-3">
                <div class="stat-col">
                  <span class="text-caption text-medium-emphasis">最小</span>
                  <div class="mono font-weight-bold text-primary">{{ trigger.raw_min ?? '--' }}</div>
                </div>
                <div class="stat-col">
                  <span class="text-caption text-medium-emphasis">中心</span>
                  <div class="mono font-weight-bold text-primary">{{ trigger.raw_center ?? '--' }}</div>
                </div>
                <div class="stat-col">
                  <span class="text-caption text-medium-emphasis">最大</span>
                  <div class="mono font-weight-bold text-primary">{{ trigger.raw_max ?? '--' }}</div>
                </div>
              </div>

              <div class="d-flex justify-end mt-3">
                <v-btn color="grey" variant="text" @click="closeGuide">关闭</v-btn>
              </div>
            </v-stepper-window-item>

            <!-- 步骤 2: 摇杆 (内嵌子 stepper) -->
            <v-stepper-window-item :value="2">
              <v-stepper v-model="joyStep" complete-icon="mdi-check-circle" edit-icon="mdi-cog">
                <v-stepper-header>
                  <v-stepper-item v-for="(t, i) in joyStepTitles" :key="i" :value="i" :title="t"
                    :complete="i < joyStep" :disabled="i > joyStep" />
                </v-stepper-header>

                <v-stepper-window>
                  <!-- 子步骤 0: 居中采样 -->
                  <v-stepper-window-item :value="0">
                    <v-alert type="info" density="compact" variant="tonal" class="mb-2">
                      请将摇杆<span class="font-weight-bold">保持居中不动</span>，点击"开始采样"（约 1 秒）。
                    </v-alert>

                    <template v-for="ax in joyAxes" :key="ax.key">
                      <div class="d-flex align-center mb-1 mt-2">
                        <span class="text-caption font-weight-bold mr-2" :class="'text-' + ax.color">{{ ax.label }}</span>
                        <v-spacer />
                        <span class="text-caption text-medium-emphasis mr-2">raw</span>
                        <span class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw ?? '--' }}</span>
                      </div>
                      <div class="range-meter">
                        <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
                          <span class="mono">{{ ax.data.raw_min ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono" :class="'text-' + ax.color">{{ ax.data.raw_center ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono">{{ ax.data.raw_max ?? '--' }}</span>
                        </div>
                        <div class="range-track">
                          <div class="range-fill" :style="{ width: rawPercent(ax.data) + '%', background: ax.gradient }" />
                          <div v-if="hasRange(ax.data)" class="range-deadzone" :style="deadzoneStyle(ax.data)" />
                          <div v-if="hasRange(ax.data)" class="range-center" :style="{ left: centerPercent(ax.data) + '%' }" />
                          <div class="range-thumb" :style="{ left: rawPercent(ax.data) + '%' }">
                            <div class="range-thumb-dot" />
                          </div>
                        </div>
                      </div>
                    </template>

                    <v-progress-linear v-if="runningType === 'joy_xy'" :model-value="calProgress" color="warning"
                      class="mt-3" height="6" rounded />
                    <v-alert v-if="lastMessage && lastType === 'joy_xy'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'joy_xy' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="closeGuide">取消</v-btn>
                      <v-btn v-if="runningType !== 'joy_xy'" color="success" prepend-icon="mdi-play" variant="tonal"
                        @click="runJoyStep(1)">开始采样</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 1: 行程扫描 -->
                  <v-stepper-window-item :value="1">
                    <v-alert type="info" density="compact" variant="tonal" class="mb-2">
                      请将摇杆<span class="font-weight-bold">推到行程两端</span>并缓慢画圈，覆盖全部范围（约 4 秒）。
                    </v-alert>

                    <template v-for="ax in joyAxes" :key="ax.key">
                      <div class="d-flex align-center mb-1 mt-2">
                        <span class="text-caption font-weight-bold mr-2" :class="'text-' + ax.color">{{ ax.label }}</span>
                        <v-spacer />
                        <span class="text-caption text-medium-emphasis mr-2">raw</span>
                        <span class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw ?? '--' }}</span>
                      </div>
                      <div class="range-meter">
                        <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
                          <span class="mono">{{ ax.data.raw_min ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono" :class="'text-' + ax.color">{{ ax.data.raw_center ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono">{{ ax.data.raw_max ?? '--' }}</span>
                        </div>
                        <div class="range-track">
                          <div class="range-fill" :style="{ width: rawPercent(ax.data) + '%', background: ax.gradient }" />
                          <div v-if="hasRange(ax.data)" class="range-deadzone" :style="deadzoneStyle(ax.data)" />
                          <div v-if="hasRange(ax.data)" class="range-center" :style="{ left: centerPercent(ax.data) + '%' }" />
                          <div class="range-thumb" :style="{ left: rawPercent(ax.data) + '%' }">
                            <div class="range-thumb-dot" />
                          </div>
                        </div>
                      </div>
                    </template>

                    <v-progress-linear v-if="runningType === 'joy_xy'" :model-value="calProgress" color="warning"
                      class="mt-3" height="6" rounded />
                    <v-alert v-if="lastMessage && lastType === 'joy_xy'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'joy_xy' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="joyStep = 0">上一步</v-btn>
                      <v-btn v-if="runningType !== 'joy_xy'" color="success" prepend-icon="mdi-play" variant="tonal"
                        @click="runJoyStep(2)">开始采样</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 2: 完成 -->
                  <v-stepper-window-item :value="2">
                    <v-alert type="success" density="compact" variant="tonal" class="mb-2">
                      校准完成！X/Y 两轴结果已保存，死区可在展示卡片中调整。
                    </v-alert>

                    <template v-for="ax in joyAxes" :key="ax.key">
                      <div class="d-flex align-center mb-1 mt-2">
                        <span class="text-caption font-weight-bold mr-2" :class="'text-' + ax.color">{{ ax.label }}</span>
                        <v-spacer />
                        <span class="text-caption text-medium-emphasis mr-2">raw</span>
                        <span class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw ?? '--' }}</span>
                      </div>
                      <div class="stat-grid">
                        <div class="stat-col">
                          <span class="text-caption text-medium-emphasis">最小</span>
                          <div class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw_min ?? '--' }}</div>
                        </div>
                        <div class="stat-col">
                          <span class="text-caption text-medium-emphasis">中心</span>
                          <div class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw_center ?? '--' }}</div>
                        </div>
                        <div class="stat-col">
                          <span class="text-caption text-medium-emphasis">最大</span>
                          <div class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw_max ?? '--' }}</div>
                        </div>
                      </div>
                    </template>

                    <div class="d-flex justify-end mt-3">
                      <v-btn color="primary" prepend-icon="mdi-check-circle" variant="tonal" @click="closeGuide">完成</v-btn>
                    </div>
                  </v-stepper-window-item>
                </v-stepper-window>
              </v-stepper>
            </v-stepper-window-item>
          </v-stepper-window>
        </v-stepper>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCalibrationStore, type AdcCal } from '@/stores/calibration'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const calStore = useCalibrationStore()
const trigger = calStore.trigger
const joyX = calStore.joyX
const joyY = calStore.joyY
const imu = calStore.imu
const { runningType, calProgress, lastMessage, lastType } = storeToRefs(calStore)

// 主 stepper: 0=IMU 1=扳机 2=摇杆
const step = ref(0)
const maxStep = ref(0) // 已解锁的最大步骤 (不可跳过)
const stepTitles = ['IMU', '扳机', '摇杆']

// 摇杆子 stepper
const joyStep = ref(0)
const joyStepTitles = ['居中采样', '行程扫描', '完成']

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const imuDone = computed(() => maxStep.value >= 1)
const triggerDone = computed(() => maxStep.value >= 2)

// 双轴量程展示 (reactive 使嵌套的 joyX/joyY ref 自动解包)
const joyAxes = reactive([
  { key: 'joy_x', label: 'X 轴', data: joyX, color: 'success', gradient: 'linear-gradient(90deg, rgb(var(--v-theme-success)), #26c6da)' },
  { key: 'joy_y', label: 'Y 轴', data: joyY, color: 'info', gradient: 'linear-gradient(90deg, rgb(var(--v-theme-info)), #29b6f6)' },
])

// 打开向导: 定位到正在进行的校准, 否则从 IMU 自动开始
watch(() => props.modelValue, (v) => {
  if (!v) return
  const rt = calStore.runningType
  if (rt === 'imu') { step.value = 0; maxStep.value = 0; joyStep.value = 0 }
  else if (rt === 'trigger') { step.value = 1; maxStep.value = 1; joyStep.value = 0 }
  else if (rt === 'joy_xy') { step.value = 2; maxStep.value = 2; joyStep.value = 0 }
  else {
    step.value = 0; maxStep.value = 0; joyStep.value = 0
    startCal('imu')
  }
})

// 进入扳机步骤时自动开始校准 (回看后再次进入, 若未在校准中则重新开始)
watch(step, (nv, ov) => {
  if (!props.modelValue) return
  if (nv === 1 && ov === 0 && calStore.runningType === null) startCal('trigger')
})

// 校准完成 (runningType 非空 → null) 后自动推进
watch(runningType, (nv, ov) => {
  if (!props.modelValue) return
  if (ov !== null && nv === null && lastMessage.value !== '已取消') {
    if (lastType.value === 'imu' && step.value === 0) {
      maxStep.value = 1
      step.value = 1
    } else if (lastType.value === 'trigger' && step.value === 1) {
      maxStep.value = 2
      step.value = 2
    } else if (lastType.value === 'joy_xy') {
      if (joyStep.value === 0) joyStep.value = 1
      else if (joyStep.value === 1) joyStep.value = 2
    }
  }
})

async function startCal(type: 'imu' | 'trigger'): Promise<void> {
  await calStore.startCal(type)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

async function runJoyStep(s: 1 | 2): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCalStep('joy_xy', s)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

async function cancelCal(): Promise<void> {
  await calStore.cancelCal()
}

function closeGuide(): void {
  if (calStore.runningType) calStore.cancelCal()
  open.value = false
}

// --- 量程计算 (与 CalWizard.vue 一致) ---
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

function fmtBias(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(4)
}
</script>

<style scoped>
.cal-avatar {
  border-radius: 10px;
}

/* 等宽数字字体 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
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

/* 状态数值列 */
.stat-col {
  border-radius: 10px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
}

.stat-grid {
  display: flex;
  gap: 12px;
}

.stat-grid > .stat-col {
  flex: 1 1 0;
  min-width: 0;
}
</style>
