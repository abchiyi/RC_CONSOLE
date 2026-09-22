<template>
  <v-dialog v-model="open" max-width="880" persistent>
    <v-card class="cal-dialog-card" rounded="lg" elevation="0">
      <!-- ===== 头部: avatar + 标题 + 进度 chip + 关闭 ===== -->
      <v-card-item class="gw-head pb-3">
        <template #prepend>
          <v-avatar color="primary" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-auto-fix</v-icon>
          </v-avatar>
        </template>
        <v-card-title>校准向导</v-card-title>
        <v-card-subtitle>按 IMU → 扳机 → 摇杆 的顺序完成校准</v-card-subtitle>
        <template #append>
          <v-chip v-if="busy" color="warning" size="x-small" variant="tonal">
            <v-icon start size="12">mdi-circle</v-icon>进行中
          </v-chip>
          <v-chip v-else color="grey" size="x-small" variant="tonal">{{ doneCount }} / {{ totalCount }}</v-chip>
          <v-btn icon="mdi-close" variant="text" size="small" density="compact" @click="closeGuide" />
        </template>
      </v-card-item>

      <!-- ===== 主体: 左导览 + 右内容 ===== -->
      <v-card-text class="gw-body-wrap pt-1">
        <div class="gw-body">
          <nav class="gw-nav">
            <button v-for="item in navItems" :key="item.step" type="button" class="gw-nav-item"
              :class="{ 'is-active': step === item.step, 'is-done': item.done, 'is-locked': item.step > maxStep }"
              :disabled="item.step > maxStep" @click="gotoStep(item.step)">
              <span class="gw-nav-dot">
                <v-icon v-if="item.done" size="12">mdi-check</v-icon>
                <span v-else>{{ item.step }}</span>
              </span>
              <span class="gw-nav-text">
                <span class="gw-nav-title">{{ item.title }}</span>
                <span class="gw-nav-desc">{{ item.desc }}</span>
              </span>
            </button>
          </nav>

          <div class="gw-main">
            <!-- ==================== 步骤 0: 选择校准条目 ==================== -->
            <template v-if="step === 0">
              <div class="gw-section-head">
                <span class="gw-section-title">选择校准条目</span>
                <span class="gw-section-sub">勾选本次需要校准的条目，将按 IMU → 扳机 → 摇杆 的顺序执行已选项</span>
              </div>

              <div class="gw-pick-list">
                <button v-for="opt in pickOptions" :key="opt.key" type="button" class="gw-pick"
                  :class="{ 'is-on': opt.model.value }" @click="opt.model.value = !opt.model.value">
                  <v-avatar :color="opt.avatar" size="34" rounded="lg" class="gw-pick-avatar">
                    <v-icon color="white" size="18">{{ opt.icon }}</v-icon>
                  </v-avatar>
                  <span class="gw-pick-text">
                    <span class="gw-pick-title">{{ opt.title }}</span>
                    <span class="gw-pick-desc">{{ opt.desc }}</span>
                  </span>
                  <span class="gw-switch" :class="{ 'is-on': opt.model.value }">
                    <span class="gw-switch-knob" />
                  </span>
                </button>
              </div>
            </template>

            <!-- ==================== 步骤 1: IMU ==================== -->
            <template v-else-if="step === 1">
              <div class="gw-phases">
                <template v-for="(t, i) in imuStepTitles" :key="t">
                  <span v-if="i > 0" class="gw-phase-sep" />
                  <span class="gw-phase" :class="{ 'is-active': i === imuStep, 'is-done': i < imuStep }">
                    <span class="gw-phase-dot">
                      <v-icon v-if="i < imuStep" size="11">mdi-check</v-icon>
                      <span v-else>{{ i + 1 }}</span>
                    </span>
                    <span class="gw-phase-label">{{ t }}</span>
                  </span>
                </template>
              </div>

              <div class="cal-hint" :class="{ 'hint-ok': imuStep === 2 }">
                <v-icon size="16" class="hint-icon">{{ imuStep === 2 ? 'mdi-check-circle-outline' : 'mdi-information-outline' }}</v-icon>
                <span v-if="imuStep === 0">
                  将设备<b>置于桌面</b>（任意姿态）<b>保持静止</b>，点击「开始校准」自动采集陀螺仪零偏（约 6 秒）。
                </span>
                <span v-else-if="imuStep === 1">
                  以<b>舒服的握持姿态</b>握稳设备（保持不动），点击「开始归零」把当前姿态设为 0 点，重启后仍保持。
                </span>
                <span v-else>IMU 校准完成！误差与零点均已保存。</span>
              </div>

              <!-- 子步骤 0: 误差校准 -->
              <div v-if="imuStep === 0" class="stat-group">
                <div class="stat-group-title">校准进度</div>
                <div class="stat-kv-grid">
                  <div class="stat-kv">
                    <span class="stat-label">状态</span>
                    <span class="stat-value">
                      <v-chip v-if="runningType === 'imu'" color="warning" size="x-small" variant="tonal">
                        <v-progress-circular indeterminate size="12" width="2" class="mr-1" />{{ calProgress }}%
                      </v-chip>
                      <v-chip v-else color="grey" size="x-small" variant="tonal">待开始</v-chip>
                    </span>
                  </div>
                </div>
              </div>

              <!-- 子步骤 1 / 2: 姿态 + 零偏 -->
              <template v-else>
                <div class="stat-group">
                  <div class="stat-group-title">当前姿态</div>
                  <div class="stat-kv-grid">
                    <div class="stat-kv">
                      <span class="stat-label">Roll</span>
                      <span class="stat-value mono">{{ fmtDeg(imu.roll) }}</span>
                    </div>
                    <div class="stat-kv">
                      <span class="stat-label">Pitch</span>
                      <span class="stat-value mono">{{ fmtDeg(imu.pitch) }}</span>
                    </div>
                    <div class="stat-kv">
                      <span class="stat-label">Yaw</span>
                      <span class="stat-value mono">{{ fmtDeg(imu.yaw) }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="imuDone" class="stat-group">
                  <div class="stat-group-title">陀螺零偏</div>
                  <div class="stat-kv-grid">
                    <div class="stat-kv">
                      <span class="stat-label">偏置 X</span>
                      <span class="stat-value mono">{{ fmtBias(imu.gyro_bias_x) }}</span>
                    </div>
                    <div class="stat-kv">
                      <span class="stat-label">偏置 Y</span>
                      <span class="stat-value mono">{{ fmtBias(imu.gyro_bias_y) }}</span>
                    </div>
                    <div class="stat-kv">
                      <span class="stat-label">偏置 Z</span>
                      <span class="stat-value mono">{{ fmtBias(imu.gyro_bias_z) }}</span>
                    </div>
                  </div>
                </div>
              </template>

              <v-progress-linear v-if="runningType === 'imu'" :model-value="calProgress" color="warning"
                class="mt-3" height="6" rounded />
              <div v-if="lastMessage && lastType === 'imu'" class="cal-hint mt-3"
                :class="runningType === 'imu' ? 'hint-warn' : 'hint-ok'">
                <v-icon size="16" class="hint-icon">{{ runningType === 'imu' ? 'mdi-progress-clock' : 'mdi-check-circle-outline' }}</v-icon>
                <span>{{ lastMessage }}</span>
              </div>
            </template>

            <!-- ==================== 步骤 2/3: 扳机 / 摇杆 ==================== -->
            <template v-else>
              <div class="gw-phases">
                <template v-for="(t, i) in activeTitles" :key="t">
                  <span v-if="i > 0" class="gw-phase-sep" />
                  <span class="gw-phase" :class="{ 'is-active': i === activeSubStep, 'is-done': i < activeSubStep }">
                    <span class="gw-phase-dot">
                      <v-icon v-if="i < activeSubStep" size="11">mdi-check</v-icon>
                      <span v-else>{{ i + 1 }}</span>
                    </span>
                    <span class="gw-phase-label">{{ t }}</span>
                  </span>
                </template>
              </div>

              <div class="cal-hint" :class="{ 'hint-ok': activeSubStep === 2 }">
                <v-icon size="16" class="hint-icon">{{ activeSubStep === 2 ? 'mdi-check-circle-outline' : 'mdi-information-outline' }}</v-icon>
                <span>{{ axisHint }}</span>
              </div>

              <!-- 实时量程: 扳机 1 轴 / 摇杆 2 轴 -->
              <div class="gw-axis-list">
                <div v-for="row in activeRows" :key="row.key" class="gw-axis" :style="accentVars(row)">
                  <div class="gw-axis-head">
                    <span class="gw-axis-name">{{ row.label }}</span>
                    <span class="gw-axis-raw mono">{{ row.data.raw ?? '--' }}</span>
                  </div>

                  <div class="range-meter">
                    <div class="range-scale">
                      <span class="mono">{{ row.data.raw_min ?? '--' }}</span>
                      <span class="mono range-scale-center">{{ row.data.raw_center ?? '--' }}</span>
                      <span class="mono">{{ row.data.raw_max ?? '--' }}</span>
                    </div>
                    <div class="range-track-wrap">
                      <div class="range-track">
                        <div class="range-grid" />
                        <div class="range-fill" :style="{ width: rawPercent(row.data) + '%' }" />
                        <div v-if="hasRange(row.data)" class="range-deadzone" :style="deadzoneStyle(row.data)" />
                        <div v-if="hasRange(row.data)" class="range-center" :style="{ left: centerPercent(row.data) + '%' }" />
                      </div>
                      <!-- thumb 置于 overflow 容器之外, 避免被轨道裁切成扁圆 -->
                      <div class="range-thumb" :style="{ left: rawPercent(row.data) + '%' }">
                        <div class="range-thumb-dot" />
                      </div>
                    </div>
                  </div>

                  <div class="stat-group mt-2">
                    <div class="stat-group-title">标定结果</div>
                    <div class="stat-kv-grid">
                      <div class="stat-kv">
                        <span class="stat-label">最小</span>
                        <span class="stat-value mono">{{ row.data.raw_min ?? '--' }}</span>
                      </div>
                      <div class="stat-kv">
                        <span class="stat-label">中心</span>
                        <span class="stat-value mono">{{ row.data.raw_center ?? '--' }}</span>
                      </div>
                      <div class="stat-kv">
                        <span class="stat-label">最大</span>
                        <span class="stat-value mono">{{ row.data.raw_max ?? '--' }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <v-progress-linear v-if="activeBusy" :model-value="calProgress" color="primary" class="mt-3" height="6"
                rounded />
              <div v-if="activeMsg" class="cal-hint mt-3" :class="activeBusy ? 'hint-warn' : 'hint-ok'">
                <v-icon size="16" class="hint-icon">{{ activeBusy ? 'mdi-progress-clock' : 'mdi-check-circle-outline' }}</v-icon>
                <span>{{ activeMsg }}</span>
              </div>
            </template>
          </div>
        </div>
      </v-card-text>

      <!-- ===== 底部操作区 ===== -->
      <v-divider />
      <v-card-actions class="gw-actions" :style="activeAccentVars">
        <!-- 步骤 0 -->
        <template v-if="step === 0">
          <button type="button" class="gw-btn" @click="closeGuide">关闭</button>
          <span class="gw-gap" />
          <button type="button" class="gw-btn gw-btn-primary" :disabled="!anySelected" @click="startSelected">
            <v-icon size="16" class="mr-1">mdi-play</v-icon>开始校准
          </button>
        </template>

        <!-- 步骤 1: IMU -->
        <template v-else-if="step === 1">
          <template v-if="imuStep === 0">
            <button type="button" class="gw-btn" @click="closeGuide">关闭</button>
            <span class="gw-gap" />
            <button v-if="runningType !== 'imu'" type="button" class="gw-btn gw-btn-primary" @click="startCal('imu')">
              <v-icon size="16" class="mr-1">mdi-play</v-icon>开始校准
            </button>
            <button v-else type="button" class="gw-btn gw-btn-danger" @click="cancelCal">取消</button>
          </template>
          <template v-else-if="imuStep === 1">
            <button type="button" class="gw-btn" @click="imuStep = 0">上一步</button>
            <span class="gw-gap" />
            <button v-if="!zeroing" type="button" class="gw-btn gw-btn-primary" @click="runZeroIMU">
              <v-icon size="16" class="mr-1">mdi-crosshairs-gps</v-icon>开始归零
            </button>
            <button v-else type="button" class="gw-btn" disabled>
              <v-progress-circular indeterminate size="14" width="2" class="mr-1" />归零中…
            </button>
          </template>
          <template v-else>
            <button type="button" class="gw-btn" @click="imuStep = 1">上一步</button>
            <span class="gw-gap" />
            <button type="button" class="gw-btn gw-btn-primary" @click="gotoNext(1)">
              下一步<v-icon size="16" class="ml-1">mdi-arrow-right</v-icon>
            </button>
          </template>
        </template>

        <!-- 步骤 2 / 3: 扳机 / 摇杆 -->
        <template v-else>
          <template v-if="activeSubStep === 0">
            <button type="button" class="gw-btn" @click="closeGuide">取消</button>
            <span class="gw-gap" />
            <button v-if="!activeBusy" type="button" class="gw-btn gw-btn-primary" @click="runStep(1)">
              <v-icon size="16" class="mr-1">mdi-play</v-icon>开始采样
            </button>
            <button v-else type="button" class="gw-btn gw-btn-danger" @click="cancelCal">取消</button>
          </template>
          <template v-else-if="activeSubStep === 1">
            <button type="button" class="gw-btn" @click="activeSubStep = 0">上一步</button>
            <span class="gw-gap" />
            <button v-if="!activeBusy" type="button" class="gw-btn gw-btn-primary" @click="runStep(2)">
              <v-icon size="16" class="mr-1">mdi-play</v-icon>开始采样
            </button>
            <button v-else type="button" class="gw-btn gw-btn-danger" @click="cancelCal">取消</button>
          </template>
          <template v-else>
            <button type="button" class="gw-btn" @click="activeSubStep = 1">上一步</button>
            <span class="gw-gap" />
            <button v-if="step === 2" type="button" class="gw-btn gw-btn-primary" @click="gotoNext(2)">
              下一步<v-icon size="16" class="ml-1">mdi-arrow-right</v-icon>
            </button>
            <button v-else type="button" class="gw-btn gw-btn-ok" @click="closeGuide">
              <v-icon size="16" class="mr-1">mdi-check-circle</v-icon>完成
            </button>
          </template>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, type WritableComputedRef } from 'vue'
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

// 主 stepper: 0=选择条目 1=IMU 2=扳机 3=摇杆
const step = ref(0)
const maxStep = ref(0) // 已解锁的最大步骤 (不可跳过)
const stepTitles = ['条目', 'IMU', '扳机', '摇杆']

// 勾选的校准条目 (默认全选); 步骤号: IMU=1 扳机=2 摇杆=3
const selected = reactive({ imu: true, trigger: true, joy: true })
const anySelected = computed(() => selected.imu || selected.trigger || selected.joy)

// IMU 子 stepper: 0=误差校准 1=0位校准 2=完成
const imuStep = ref(0)
const imuStepTitles = ['误差校准', '0位校准', '完成']
const zeroing = ref(false) // 归零请求进行中 (防重入)

// 扳机子 stepper
const triggerStep = ref(0)
const triggerStepTitles = ['居中采样', '行程扫描', '完成']

// 摇杆子 stepper
const joyStep = ref(0)
const joyStepTitles = ['居中采样', '行程扫描', '完成']

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const imuDone = computed(() => imuStep.value >= 1)

// 双轴量程展示 (reactive 使嵌套的 joyX/joyY ref 自动解包)
const joyAxes = reactive([
  { key: 'joy_x', label: 'X 轴', data: joyX, accent: 'rgb(var(--v-theme-success))', accentSoft: '#26c6da' },
  { key: 'joy_y', label: 'Y 轴', data: joyY, accent: 'rgb(var(--v-theme-info))', accentSoft: '#29b6f6' },
])

// ---------- 展示层派生状态 (纯视图, 不参与业务逻辑) ----------

/** 单轴量程条的行数据: accent 为该轴主题色, 通过 CSS 变量下发 */
interface AxisRow {
  key: string
  label: string
  data: AdcCal
  accent: string
  accentSoft: string
}

const triggerRows: AxisRow[] = [
  { key: 'trigger', label: '扳机', data: trigger, accent: 'rgb(var(--v-theme-primary))', accentSoft: '#4fc3f7' },
]

/** 左侧导览项 (替换原 v-stepper-header) */
const navItems = computed(() => [
  { step: 0, title: stepTitles[0], desc: '选择本次校准项', done: false },
  { step: 1, title: stepTitles[1], desc: '陀螺仪零偏 + 0 点', done: step.value > 1 },
  { step: 2, title: stepTitles[2], desc: '零位与行程范围', done: step.value > 2 },
  { step: 3, title: stepTitles[3], desc: 'X / Y 居中与行程', done: false },
])

/** 条目选择页选项: model 为可写 computed, 双向绑定 selected */
interface PickOption {
  key: string
  title: string
  desc: string
  icon: string
  avatar: string
  model: WritableComputedRef<boolean>
}

const pickOptions: PickOption[] = [
  {
    key: 'imu', title: 'IMU', desc: '陀螺仪零偏 + 0 点归零', icon: 'mdi-axis-arrow', avatar: 'warning',
    model: computed({ get: () => selected.imu, set: v => { selected.imu = v } }),
  },
  {
    key: 'trigger', title: '扳机', desc: '扳机零位与行程范围', icon: 'mdi-gamepad-right', avatar: 'primary',
    model: computed({ get: () => selected.trigger, set: v => { selected.trigger = v } }),
  },
  {
    key: 'joy', title: '摇杆', desc: '摇杆 X/Y 居中与行程范围', icon: 'mdi-gamepad-variant', avatar: 'success',
    model: computed({ get: () => selected.joy, set: v => { selected.joy = v } }),
  },
]

const busy = computed(() => runningType.value !== null)
const totalCount = computed(() => (selected.imu ? 1 : 0) + (selected.trigger ? 1 : 0) + (selected.joy ? 1 : 0))
const doneCount = computed(
  () => (selected.imu && imuStep.value >= 2 ? 1 : 0)
    + (selected.trigger && triggerStep.value >= 2 ? 1 : 0)
    + (selected.joy && joyStep.value >= 2 ? 1 : 0),
)

/** 扳机 / 摇杆两页共用同一套视图, 以下数据按当前步骤切换数据源 */
const activeRows = computed<AxisRow[]>(() => {
  if (step.value === 2) return triggerRows
  if (step.value === 3) return joyAxes as unknown as AxisRow[]
  return []
})
const activeTitles = computed(() => (step.value === 2 ? triggerStepTitles : joyStepTitles))
const activeSubStep = computed({
  get: () => (step.value === 2 ? triggerStep.value : joyStep.value),
  set: (v: number) => { if (step.value === 2) triggerStep.value = v; else joyStep.value = v },
})
const activeBusy = computed(() => runningType.value === (step.value === 2 ? 'trigger' : 'joy_xy'))
const activeMsg = computed(
  () => lastMessage.value && lastType.value === (step.value === 2 ? 'trigger' : 'joy_xy') ? lastMessage.value : '',
)
/** 底部按钮主色: 扳机页取蓝, 摇杆页取 X 轴绿; 条目/IMU 页回落默认主色 */
const activeAccentVars = computed(() => {
  if (step.value === 2) {
    const row = triggerRows[0]
    return row ? accentVars(row) : ''
  }
  if (step.value === 3) {
    const row = joyAxes[0]
    return row ? accentVars(row) : ''
  }
  return ''
})

/** 扳机 / 摇杆当前子阶段的操作文案 */
const axisHint = computed(() => {
  const isJoy = step.value === 3
  if (activeSubStep.value === 0) {
    return isJoy
      ? '请将摇杆保持居中不动，点击「开始采样」自动完成（约 1 秒）。'
      : '请将扳机保持自然松开状态、不要触碰，点击「开始采样」自动完成（约 1 秒）。'
  }
  if (activeSubStep.value === 1) {
    return isJoy
      ? '请将摇杆推到行程两端并缓慢画圈，覆盖全部范围（约 4 秒）。'
      : '请将扳机按到行程末端，缓慢往复按压，覆盖全部行程（约 4 秒）。'
  }
  return isJoy
    ? '摇杆 X / Y 两轴标定完成，结果已保存，死区可在传感器卡片中调整。'
    : '扳机标定完成，结果已保存，死区可在传感器卡片中调整。'
})

/** 把当前轴的主题色写成 CSS 变量字符串, 供量程条 / 操作按钮着色 */
function accentVars(row: { accent: string; accentSoft: string }): string {
  return `--accent:${row.accent};--accent-soft:${row.accentSoft}`
}

/** 左侧导览点击: 沿用原 stepper 的 maxStep 门禁 */
function gotoStep(i: number): void {
  if (i > maxStep.value) return
  step.value = i
}

/** 扳机 / 摇杆统一的人口: 按当前步骤派发到对应的分步命令 */
async function runStep(s: 1 | 2): Promise<void> {
  if (step.value === 2) await runTriggerStep(s)
  else await runJoyStep(s)
}

// 打开向导: 仅定位到正在进行的校准, 不自动启动
watch(() => props.modelValue, (v) => {
  if (!v) return
  const rt = calStore.runningType
  if (rt === 'imu') { step.value = 1; maxStep.value = 1; imuStep.value = 0; joyStep.value = 0 }
  else if (rt === 'trigger') { step.value = 2; maxStep.value = 2; imuStep.value = 0; triggerStep.value = 0; joyStep.value = 0 }
  else if (rt === 'joy_xy') { step.value = 3; maxStep.value = 3; imuStep.value = 0; triggerStep.value = 0; joyStep.value = 0 }
  else { step.value = 0; maxStep.value = 0; imuStep.value = 0; triggerStep.value = 0; joyStep.value = 0 }
})

// 校准完成 (runningType 非空 → null) 后自动推进
watch(runningType, (nv, ov) => {
  if (!props.modelValue) return
  if (ov !== null && nv === null && lastMessage.value !== '已取消') {
    if (lastType.value === 'imu' && step.value === 1) {
      imuStep.value = 1 // 误差校准完成 → 0位校准
    } else if (lastType.value === 'trigger' && step.value === 2) {
      if (triggerStep.value === 0) triggerStep.value = 1
      else if (triggerStep.value === 1) {
        triggerStep.value = 2
        maxStep.value = 2
      }
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

async function runTriggerStep(s: 1 | 2): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCalStep('trigger', s)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

async function runJoyStep(s: 1 | 2): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCalStep('joy_xy', s)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

/** 0位校准: 等待 cal_zero_imu 响应 (store 内置 3s 超时), 成功进入完成页 */
async function runZeroIMU(): Promise<void> {
  if (zeroing.value || calStore.runningType) return
  zeroing.value = true
  try {
    const ok = await calStore.zeroIMU()
    if (ok) imuStep.value = 2
  } finally {
    zeroing.value = false
  }
}

// 返回 after 之后第一个被勾选的步骤 (IMU=1, 扳机=2, 摇杆=3), 无则 -1
function nextSelectedStep(after: number): number {
  for (const s of [1, 2, 3]) {
    if (s <= after) continue
    if ((s === 1 && selected.imu) || (s === 2 && selected.trigger) || (s === 3 && selected.joy)) return s
  }
  return -1
}

// 选择页: 跳转第一个被勾选条目
function startSelected(): void {
  const s = nextSelectedStep(0)
  if (s > 0) { step.value = s; maxStep.value = s }
}

// 当前条目完成后: 跳转下一个被勾选条目, 全部完成则关闭向导
function gotoNext(after: number): void {
  const s = nextSelectedStep(after)
  if (s === -1) { closeGuide(); return }
  step.value = s
  maxStep.value = s
  if (s === 2) triggerStep.value = 0
  else if (s === 3) joyStep.value = 0
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

function fmtDeg(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(1) + '°'
}
</script>

<style scoped>
/* ============ 弹窗外壳 (与 elrs 页面卡片一致) ============ */
.cal-dialog-card {
  background: #1e1e1e !important;
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}

.cal-avatar {
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.gw-head {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

/* ============ 主体布局: 左导览 + 右内容 ============ */
.gw-body {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.gw-nav {
  flex: 0 0 172px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gw-main {
  flex: 1 1 auto;
  min-width: 0;
}

/* ---- 左侧竖向步骤导航 ---- */
.gw-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.028);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.18s, border-color 0.18s, opacity 0.18s;
}

.gw-nav-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.055);
  border-color: rgba(255, 255, 255, 0.12);
}

.gw-nav-item.is-active {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.12);
}

.gw-nav-item.is-locked {
  opacity: 0.4;
  cursor: not-allowed;
}

.gw-nav-dot {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.68rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  transition: background-color 0.18s, color 0.18s;
}

.gw-nav-item.is-active .gw-nav-dot {
  background: rgb(var(--v-theme-primary));
  color: #fff;
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.18);
}

.gw-nav-item.is-done .gw-nav-dot {
  background: rgba(76, 175, 80, 0.22);
  color: #81c784;
}

.gw-nav-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.gw-nav-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  line-height: 1.35;
}

.gw-nav-desc {
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.42);
  line-height: 1.35;
}

/* ---- 内容区小节头 ---- */
.gw-section-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}

.gw-section-title {
  font-size: 0.86rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
}

.gw-section-sub {
  font-size: 0.72rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
}

/* ---- 内联阶段指示条 (替代嵌套 v-stepper-header) ---- */
.gw-phases {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.gw-phase-sep {
  width: 14px;
  height: 1px;
  background: rgba(255, 255, 255, 0.14);
}

.gw-phase {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 4px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.028);
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.45);
  transition: all 0.18s;
}

.gw-phase.is-done {
  color: rgba(255, 255, 255, 0.72);
}

.gw-phase.is-active {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.12);
  color: #fff;
}

.gw-phase-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.66rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.gw-phase.is-active .gw-phase-dot {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}

.gw-phase.is-done .gw-phase-dot {
  background: rgba(76, 175, 80, 0.24);
  color: #81c784;
}

/* ============ 条目选择: 卡片式开关行 (补上原先缺失的样式) ============ */
.gw-pick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gw-pick {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.028);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.18s, border-color 0.18s;
}

.gw-pick:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.14);
}

.gw-pick.is-on {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.1);
}

.gw-pick-avatar {
  border-radius: 10px;
}

.gw-pick-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.gw-pick-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.gw-pick-desc {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.45);
}

/* 紧凑开关 */
.gw-switch {
  flex: 0 0 auto;
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: background-color 0.2s, border-color 0.2s;
}

.gw-switch.is-on {
  background: rgb(var(--v-theme-primary));
  border-color: transparent;
}

.gw-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.gw-switch.is-on .gw-switch-knob {
  transform: translateX(14px);
}

/* ============ 数据面板 (与 elrs 页面一致) ============ */
.stat-group {
  flex: 1 1 200px;
  min-width: 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 8px 10px;
}

.stat-group-title {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 5px;
}

.stat-kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 5px 14px;
}

.stat-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.stat-label {
  flex: 0 0 auto;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.45);
}

.stat-value {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 等宽数字字体 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* ============ 提示条 ============ */
.cal-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.75rem;
  line-height: 1.5;
}

.cal-hint b {
  color: rgba(255, 255, 255, 0.95);
}

.hint-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.6);
}

.hint-warn {
  border-color: rgba(255, 179, 0, 0.45);
  background: rgba(255, 179, 0, 0.1);
  color: rgba(255, 235, 190, 0.9);
}

.hint-warn .hint-icon {
  color: rgba(255, 179, 0, 0.9);
}

.hint-ok {
  border-color: rgba(76, 175, 80, 0.45);
  background: rgba(76, 175, 80, 0.1);
  color: rgba(200, 245, 205, 0.92);
}

.hint-ok .hint-icon {
  color: #81c784;
}

/* ============ 量程条 (颜色由 --accent 下发) ============ */
.gw-axis-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.gw-axis {
  --accent: rgb(var(--v-theme-primary));
  --accent-soft: #4fc3f7;
}

.gw-axis-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 5px;
}

.gw-axis-name {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--accent);
}

.gw-axis-raw {
  margin-left: auto;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--accent);
}

.range-scale {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.42);
  margin-bottom: 3px;
}

.range-scale-center {
  color: var(--accent);
}

.range-track-wrap {
  position: relative;
}

.range-track {
  position: relative;
  height: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

/* 25% 步进刻度 */
.range-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(90deg,
      rgba(255, 255, 255, 0.1) 1px, transparent 1px);
  background-size: 25% 100%;
  pointer-events: none;
}

.range-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--accent), var(--accent-soft));
  transition: width 0.1s linear;
}

.range-deadzone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(255, 152, 0, 0.22);
  border-left: 1px dashed rgba(255, 152, 0, 0.55);
  border-right: 1px dashed rgba(255, 152, 0, 0.55);
  transition: left 0.2s, width 0.2s;
}

.range-center {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.6);
  transform: translateX(-50%);
  transition: left 0.2s;
}

.range-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: left 0.1s linear;
}

.range-thumb-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid var(--accent);
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
}

/* ============ 底部操作区 ============ */
.gw-actions {
  padding: 12px 16px;
}

.gw-gap {
  flex: 1 1 auto;
}

.gw-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1.7;
  cursor: pointer;
  transition: all 0.16s;
}

.gw-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.34);
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
}

.gw-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 主操作: 默认主色, 扳机/摇杆页会被 --accent 覆盖为该轴主题色 */
.gw-btn-primary {
  border-color: transparent;
  background: var(--accent, rgb(var(--v-theme-primary)));
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.gw-btn-primary:hover:not(:disabled) {
  background: var(--accent, rgb(var(--v-theme-primary)));
  color: #fff;
  filter: brightness(1.12);
}

.gw-btn-danger {
  border-color: rgba(244, 67, 54, 0.45);
  background: rgba(244, 67, 54, 0.16);
  color: #ef5350;
}

.gw-btn-danger:hover:not(:disabled) {
  border-color: transparent;
  background: #f44336;
  color: #fff;
}

.gw-btn-ok {
  border-color: rgba(76, 175, 80, 0.45);
  background: rgba(76, 175, 80, 0.18);
  color: #81c784;
}

.gw-btn-ok:hover:not(:disabled) {
  border-color: transparent;
  background: #4caf50;
  color: #fff;
}

/* ============ 窄屏: 导览降为顶部横条 ============ */
@media (max-width: 760px) {
  .gw-body {
    flex-direction: column;
  }

  .gw-nav {
    flex: 1 1 auto;
    width: 100%;
    flex-direction: row;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .gw-nav-item {
    width: auto;
    flex: 0 0 auto;
    padding: 6px 12px 6px 8px;
  }

  .gw-nav-desc {
    display: none;
  }
}
</style>
