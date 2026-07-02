<template>
  <div>
    <v-snackbar v-model="snackbarVisible" color="info" timeout="2000">
      {{ snackbarMsg }}
    </v-snackbar>

    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6">
        <v-icon class="mr-2">mdi-cog</v-icon>
        通道配置
      </v-toolbar-title>

      <v-spacer />

      <v-btn v-if="serial.connected" class="mr-2" color="primary" prepend-icon="mdi-download" size="small"
        variant="tonal" @click="loadFromDevice">
        从设备加载
      </v-btn>

      <v-btn v-if="serial.connected" class="mr-2" color="success" prepend-icon="mdi-upload" size="small" variant="tonal"
        @click="saveToDevice">
        保存到设备
      </v-btn>
    </v-toolbar>

    <!-- 未连接 -->
    <v-alert v-if="!serial.connected" class="ma-4" color="info" icon="mdi-information" variant="tonal">
      请先连接设备以加载和编辑配置
    </v-alert>

    <v-row v-if="serial.connected" dense>
      <!-- 左侧: 主配置区域 -->
      <v-col cols="12" lg="8" xl="9">
        <!-- 设备信息 -->
        <v-card v-if="configStore.deviceInfo" class="mb-2" rounded="lg" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon>mdi-chip</v-icon>
            </template>
            <v-card-title>设备信息</v-card-title>
            <v-card-subtitle>
              {{ configStore.deviceInfo.device }}
              · {{ configStore.deviceInfo.channel_count }} 通道
              · {{ configStore.deviceInfo.model_count }} 模型
            </v-card-subtitle>
          </v-card-item>
        </v-card>

        <!-- 模型配置选项卡 -->
        <v-card v-if="configStore.modelCount > 0" rounded="lg" variant="outlined">
          <v-card-text class="pa-2 pb-0">
            <v-tabs v-model="selectedSlot" center-active density="compact" @update:model-value="onSlotSelect">
              <v-tab v-for="i in configStore.modelCount" :key="i - 1" :value="i - 1" size="small">
                <v-icon size="16" class="mr-1">mdi-controller-classic</v-icon>
                <span class="text-caption">Model {{ i }}</span>
              </v-tab>
            </v-tabs>
          </v-card-text>
          <v-divider />
          <!-- 模型详情 (可编辑) -->
          <template v-if="configStore.config && editChannels.length > 0">
            <v-card-item>
              <template #prepend>
                <v-icon>mdi-view-list</v-icon>
              </template>
              <v-card-title> {{ configStore.config.models[selectedSlot]?.name || '未命名' }}

                <v-chip v-if="selectedSlot === configStore.config.active_model" size="x-small" color="success"
                  class="ml-1" variant="tonal">激活中</v-chip>
              </v-card-title>

              <template #append>
                <div class="d-flex ga-1 action-btns">
                  <v-btn color="success" prepend-icon="mdi-check-circle" size="small" variant="tonal"
                    :disabled="selectedSlot === configStore.config.active_model" @click="activateModel">
                    激活配置
                  </v-btn>
                  <v-btn color="info" prepend-icon="mdi-download" size="small" variant="tonal" @click="readModel"
                    :loading="configStore.loading">
                    读取
                  </v-btn>
                  <v-btn color="warning" prepend-icon="mdi-upload" size="small" variant="tonal" @click="writeModel">
                    写入
                  </v-btn>
                  <v-btn color="primary" prepend-icon="mdi-content-save" size="small" variant="tonal"
                    @click="saveModel">
                    保存
                  </v-btn>
                </div>
                <div class="fab-container">
                  <v-speed-dial transition="scale">
                    <template #activator="{ props: activatorProps }">
                      <v-btn v-bind="activatorProps" icon="mdi-dots-vertical" size="small" color="primary" />
                    </template>
                    <v-tooltip location="left" text="激活配置">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-check-circle" size="small" color="success"
                          :disabled="selectedSlot === configStore.config.active_model" @click="activateModel" />
                      </template>
                    </v-tooltip>
                    <v-tooltip location="left" text="读取">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-download" size="small" color="info"
                          :loading="configStore.loading" @click="readModel" />
                      </template>
                    </v-tooltip>
                    <v-tooltip location="left" text="写入">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-upload" size="small" color="warning" @click="writeModel" />
                      </template>
                    </v-tooltip>
                    <v-tooltip location="left" text="保存">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-content-save" size="small" color="primary" @click="saveModel" />
                      </template>
                    </v-tooltip>
                  </v-speed-dial>
                </div>
              </template>
            </v-card-item>
            <v-card-text>
              <template v-for="(ch, idx) in editChannels" :key="idx">
                <v-sheet rounded="lg" border class="my-2 chan-card" :class="{ 'card-selected': expandedIdx === idx }"
                  style="position:relative; overflow:hidden">
                  <!-- 实时通道值背景条 -->
                  <div v-if="chanLivePct(idx) >= 0" class="chan-live-bg" :style="{ width: chanLivePct(idx) + '%' }" />
                  <!-- 头部行 -->
                  <div class="chan-header-row pa-3" style="cursor:pointer" @click="toggleExpand(idx)">
                    <!-- 宽屏布局 -->
                    <div class="chan-header-wide d-flex align-center flex-wrap">
                      <span class="text-caption font-weight-bold mr-3" style="min-width:32px">CH{{ idx }}</span>
                      <v-select v-model="ch.source" :items="sourceOptions" density="compact" hide-details
                        variant="outlined" style="max-width:140px" class="mr-3"
                        @update:model-value="(val: string) => onSourceChange(idx, val)" @click.stop />
                      <template v-if="ch.source !== 'NONE'">
                        <div class="flex-grow-1 mx-2" @click.stop>
                          <template v-if="isButtonSource(ch.source)">
                            <v-range-slider :model-value="[ch.output_min ?? 1000, ch.output_max ?? 2000]"
                              @update:model-value="onBtnOutputRangeChange(idx, $event)"
                              :min="1000" :max="2000" :step="1" density="compact" hide-details thumb-label>
                              <template #prepend>
                                <v-text-field :model-value="ch.output_min ?? 1000"
                                  @update:model-value="(v: string) => onBtnOutputRangeChange(idx, [Number(v), ch.output_max ?? 2000])"
                                  density="compact"
                                  style="width:90px" type="number" variant="outlined" hide-details single-line />
                              </template>
                              <template #append>
                                <v-text-field :model-value="ch.output_max ?? 2000"
                                  @update:model-value="(v: string) => onBtnOutputRangeChange(idx, [ch.output_min ?? 1000, Number(v)])"
                                  density="compact"
                                  style="width:90px" type="number" variant="outlined" hide-details single-line />
                              </template>
                            </v-range-slider>
                          </template>
                          <template v-else>
                            <v-range-slider :model-value="[ch.output_min ?? 1000, ch.output_max ?? 2000]"
                              @update:model-value="(v: number[]) => { ch.output_min = v[0]!; ch.output_max = v[1]! }"
                              :min="1000" :max="2000" :step="1" density="compact" hide-details thumb-label>
                              <template #prepend>
                                <v-text-field :model-value="ch.output_min ?? 1000"
                                  @update:model-value="(v: string) => ch.output_min = Number(v)" density="compact"
                                  style="width:90px" type="number" variant="outlined" hide-details single-line />
                              </template>
                              <template #append>
                                <v-text-field :model-value="ch.output_max ?? 2000"
                                  @update:model-value="(v: string) => ch.output_max = Number(v)" density="compact"
                                  style="width:90px" type="number" variant="outlined" hide-details single-line />
                              </template>
                            </v-range-slider>
                          </template>
                        </div>
                        <v-btn :icon="expandedIdx === idx ? 'mdi-chevron-up' : 'mdi-chevron-down'" density="compact"
                          size="x-small" variant="text" @click.stop="toggleExpand(idx)" />
                      </template>
                    </div>
                    <!-- 窄屏布局 -->
                    <div class="chan-header-narrow d-flex flex-column">
                      <div class="d-flex justify-space-between align-center">
                        <span class="text-caption font-weight-bold">CH{{ idx }}</span>
                        <v-select v-model="ch.source" :items="sourceOptions" density="compact" hide-details
                          variant="outlined" style="max-width:130px"
                          @update:model-value="(val: string) => onSourceChange(idx, val)" @click.stop />
                      </div>
                      <template v-if="ch.source !== 'NONE'">
                        <div class="d-flex ga-2 mt-2 pb-1" @click.stop>
                          <template v-if="isButtonSource(ch.source)">
                            <v-text-field :model-value="ch.output_min ?? 1000"
                              @update:model-value="(v: string) => onBtnOutputRangeChange(idx, [Number(v), ch.output_max ?? 2000])"
                              density="compact"
                              type="number" variant="outlined" hide-details single-line label="最小" />
                            <v-text-field :model-value="ch.output_max ?? 2000"
                              @update:model-value="(v: string) => onBtnOutputRangeChange(idx, [ch.output_min ?? 1000, Number(v)])"
                              density="compact"
                              type="number" variant="outlined" hide-details single-line label="最大" />
                          </template>
                          <template v-else>
                            <v-text-field :model-value="ch.output_min ?? 1000"
                              @update:model-value="(v: string) => ch.output_min = Number(v)" density="compact"
                              type="number" variant="outlined" hide-details single-line label="最小" />
                            <v-text-field :model-value="ch.output_max ?? 2000"
                              @update:model-value="(v: string) => ch.output_max = Number(v)" density="compact"
                              type="number" variant="outlined" hide-details single-line label="最大" />
                          </template>
                        </div>
                      </template>
                    </div>
                  </div>
                  <!-- 展开详情 (动画) -->
                  <v-expand-transition>
                    <div v-if="expandedIdx === idx && ch.source !== 'NONE'">
                      <v-divider />
                      <div class="pa-3">
                        <!-- 按钮通道: 触发配置 -->
                        <v-sheet v-if="isButtonSource(ch.source)" rounded="lg" border class="pa-3">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">激活触发</span>
                            <span class="param-controls">
                              <v-select v-model="ch.activate.trigger" :items="triggerOptions" class="param-select"
                                density="compact" hide-details variant="outlined" />
                              <v-icon class="mx-1" size="16">mdi-arrow-right</v-icon>
                              <v-number-input v-model="ch.activate.value" :reverse="false" :min="ch.output_min ?? 1000" :max="ch.output_max ?? 2000"
                                :step="1" class="param-val" controlVariant="split" density="compact" hide-details
                                :hideInput="false" :inset="false" variant="outlined" style="width:180px" />
                            </span>
                          </div>
                          <v-divider class="my-2" />
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">关闭触发</span>
                            <span class="param-controls">
                              <v-select v-model="ch.deactivate.trigger" :items="triggerOptions" class="param-select"
                                density="compact" hide-details variant="outlined" />
                              <v-icon class="mx-1" size="16">mdi-arrow-right</v-icon>
                              <v-number-input v-model="ch.deactivate.value" :reverse="false" :min="ch.output_min ?? 1000" :max="ch.output_max ?? 2000"
                                :step="1" class="param-val" controlVariant="split" density="compact" hide-details
                                :hideInput="false" :inset="false" variant="outlined" style="width:180px" />
                            </span>
                          </div>
                          <v-divider class="my-2" />
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">循环挡位</span>
                            <span class="param-controls">
                              <v-select v-model="ch.toggle.trigger" :items="triggerOptions" class="param-select"
                                density="compact" hide-details variant="outlined" />
                              <v-icon class="mx-1" size="16">mdi-arrow-right</v-icon>
                              <v-number-input v-model="ch.toggle.value" :reverse="false" :min="ch.output_min ?? 1000" :max="ch.output_max ?? 2000"
                                :step="1" class="param-val" controlVariant="split" density="compact" hide-details
                                :hideInput="false" :inset="false" variant="outlined" style="width:180px" />
                            </span>
                          </div>
                        </v-sheet>
                        <!-- 连续量通道: 死区/反向/输出中心 -->
                        <v-sheet v-if="isContinuousSource(ch.source)" rounded="lg" border class="pa-3">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">死区抖动</span>
                            <span class="param-input-wrap">
                              <v-number-input v-model="ch.deadzone" :min="0" :max="255" :step="1" controlVariant="split"
                                density="compact" hide-details :hideInput="false" :inset="false" variant="outlined"
                                style="min-width:140px" />
                            </span>
                          </div>
                          <v-divider class="my-2" />
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">反向</span>
                            <v-switch v-model="ch.reverse" color="warning" density="compact" hide-details />
                          </div>
                          <template v-if="isImuSource(ch.source)">
                            <v-divider class="my-2" />
                            <!-- 宽屏: 范围滑块 -->
                            <div class="detail-slider-wide">
                              <v-range-slider :model-value="[ch.input_min ?? 0, ch.input_max ?? 0]"
                                @update:model-value="(v: number[]) => { ch.input_min = v[0]!; ch.input_max = v[1]! }"
                                :min="inputRangeBounds(ch.source).min" :max="inputRangeBounds(ch.source).max" :step="1"
                                density="compact" hide-details thumb-label>
                                <template #prepend>
                                  <span class="text-caption font-weight-bold mr-2" style="min-width:60px">输入范围</span>
                                  <v-text-field :model-value="ch.input_min ?? 0"
                                    @update:model-value="(v: string) => ch.input_min = Number(v)" density="compact"
                                    style="width:90px" type="number" variant="outlined" hide-details single-line />
                                </template>
                                <template #append>
                                  <v-text-field :model-value="ch.input_max ?? 0"
                                    @update:model-value="(v: string) => ch.input_max = Number(v)" density="compact"
                                    style="width:90px" type="number" variant="outlined" hide-details single-line />
                                </template>
                              </v-range-slider>
                            </div>
                            <!-- 窄屏: 数字输入框 -->
                            <div class="detail-slider-narrow">
                              <div class="param-group">
                                <span class="text-caption font-weight-bold">输入范围</span>
                                <span class="d-flex ga-2">
                                  <v-text-field :model-value="ch.input_min ?? 0"
                                    @update:model-value="(v: string) => ch.input_min = Number(v)" density="compact"
                                    type="number" variant="outlined" hide-details single-line label="最小" />
                                  <v-text-field :model-value="ch.input_max ?? 0"
                                    @update:model-value="(v: string) => ch.input_max = Number(v)" density="compact"
                                    type="number" variant="outlined" hide-details single-line label="最大" />
                                </span>
                              </div>
                            </div>
                        </template>
                        <!-- EC11 旋钮步长 -->
                        <template v-if="isKnobEc11Source(ch.source)">
                          <v-divider class="my-2" />
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">EC11 步长 (µs/格)</span>
                            <span class="param-input-wrap">
                              <v-number-input v-model="ch.ec11_step" :min="1" :max="500" :step="1"
                                controlVariant="split" density="compact" hide-details
                                :hideInput="false" :inset="false" variant="outlined"
                                style="min-width:140px" />
                            </span>
                          </div>
                        </template>
                        <v-divider class="my-2" />
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">输出中心偏移</span>
                            <span class="param-controls">
                              <v-number-input v-model="ch.output_center" :min="1000" :max="2000" :step="1"
                                controlVariant="split" density="compact" hide-details :hideInput="false" :inset="false"
                                variant="outlined" style="width:200px" />
                            </span>
                          </div>
                        </v-sheet>
                      </div>
                    </div>
                  </v-expand-transition>
                </v-sheet>
              </template>
            </v-card-text>
          </template>
        </v-card>

        <!-- 未加载提示 -->
        <v-card v-if="!configStore.config" rounded="lg" variant="outlined">
          <v-card-text class="text-center py-8">
            <v-icon class="mb-2" color="grey" size="48">mdi-download</v-icon>
            <div class="text-body-1 text-medium-emphasis">
              点击「从设备加载」获取配置
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- 右侧: 通道监视器 -->
      <v-col cols="12" lg="4" xl="3">
        <v-card class="channel-monitor" rounded="lg" variant="outlined">
          <v-card-item class="pb-1">
            <template #prepend>
              <v-icon>mdi-monitor-dashboard</v-icon>
            </template>
            <v-card-title class="text-body-1">通道监视器</v-card-title>
            <template #append>
              <v-icon :color="chStore.polling ? 'success' : 'grey'" size="10">
                mdi-circle
              </v-icon>
              <v-btn :color="chStore.polling ? 'error' : 'success'" :icon="chStore.polling ? 'mdi-stop' : 'mdi-play'"
                density="compact" size="x-small" variant="text" @click="togglePoll" />
            </template>
          </v-card-item>

          <v-card-text class="py-0">
            <div class="chan-row" v-for="ch in chStore.activeChannels.filter(c => c.used)" :key="ch.index">
              <span class="chan-idx text-caption font-weight-bold mr-1">
                CH{{ ch.index }}
              </span>
              <span class="chan-src text-caption mr-2" :class="{ 'text-grey': !ch.used }">
                {{ sourceLabel(ch.source) }}
              </span>
              <v-progress-linear :model-value="chanProgress(ch.valueUs)" :color="ch.used ? 'primary' : 'grey-lighten1'"
                height="6" rounded class="flex-grow-1 mx-2" />
              <span class="chan-val text-caption" :class="{ 'text-grey': !ch.used }">
                {{ ch.valueUs }} μs
              </span>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useConfigStore, type ModelChannel } from '@/stores/config'
import { useChannelStore } from '@/stores/channels'
import { rawToUs, usToRaw } from '@/utils/crsf'

const serial = useSerialStore()
const configStore = useConfigStore()
const chStore = useChannelStore()
const selectedSlot = ref(0)

// 当前模型的可编辑通道副本 (存储 μs 值供 UI 编辑)
const editChannels = reactive<ModelChannel[]>([])

// 当前展开的通道行 (null = 无展开)
const expandedIdx = ref<number | null>(null)
const snackbarMsg = ref('')
const snackbarVisible = ref(false)

function toggleExpand(idx: number): void {
  expandedIdx.value = expandedIdx.value === idx ? null : idx
}

// 输入源枚举 → 中文标签
const SOURCE_LABELS: Record<string, string> = {
  NONE: '无',
  BUTTON_LOCK: 'LOCK 按钮',
  BUTTON_MH: 'MH 按钮',
  BUTTON_EC11_BTN: 'EC11 按钮',
  ANALOG_TRIGGER: '扳机',
  ANALOG_JOYSTICK_X: '摇杆 X',
  ANALOG_JOYSTICK_Y: '摇杆 Y',
  IMU_ROLL: 'IMU Roll',
  IMU_PITCH: 'IMU Pitch',
  KNOB_EC11: 'EC11 旋钮',
}

// 按钮触发方式 → 中文标签
const TRIGGER_LABELS: Record<string, string> = {
  SINGLE_CLICK: '单击',
  DOUBLE_CLICK: '双击',
  LONG_PRESS: '长按',
  LONG_PRESS_UP: '长按释放',
  PRESS: '按下',
  RELEASE: '释放',
}

function sourceLabel(id: string): string {
  return SOURCE_LABELS[id] ?? id
}

// 按钮类输入源
const BUTTON_SOURCES = new Set(['BUTTON_LOCK', 'BUTTON_MH', 'BUTTON_EC11_BTN'])
// 连续量输入源
const CONTINUOUS_SOURCES = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'KNOB_EC11',
])

function isButtonSource(s: string): boolean { return BUTTON_SOURCES.has(s) }
function isContinuousSource(s: string): boolean { return CONTINUOUS_SOURCES.has(s) }

// IMU 类输入源 (中心值固定为 0，无需配置)
const IMU_SOURCES = new Set(['IMU_ROLL', 'IMU_PITCH'])
function isImuSource(s: string): boolean { return IMU_SOURCES.has(s) }

// EC11 旋钮输入源 (仅能绑定一个通道)
const KNOB_EC11_SOURCES = new Set(['KNOB_EC11'])
function isKnobEc11Source(s: string): boolean { return KNOB_EC11_SOURCES.has(s) }

// 来源变更时：EC11 互斥，自动从旧通道移除
function onSourceChange(idx: number, newSource: string): void {
  if (newSource !== 'KNOB_EC11') return
  for (let i = 0; i < editChannels.length; i++) {
    if (i !== idx && editChannels[i]!.source === 'KNOB_EC11') {
      editChannels[i]!.source = 'NONE'
      snackbarMsg.value = `EC11 已从 CH${i} 移动到 CH${idx}`
      snackbarVisible.value = true
    }
  }
}

/** 按钮通道输出范围变更 → clamp 越界的挡位值 */
function onBtnOutputRangeChange(idx: number, vals: number[]): void {
  const ch = editChannels[idx]!
  const lo = vals[0] ?? 1000
  const hi = vals[1] ?? 2000
  ch.output_min = lo
  ch.output_max = hi
  const av = ch.activate.value ?? 1500
  const dv = ch.deactivate.value ?? 1500
  const tv = ch.toggle.value ?? 1500
  ch.activate.value = av < lo ? lo : av > hi ? hi : av
  ch.deactivate.value = dv < lo ? lo : dv > hi ? hi : dv
  ch.toggle.value = tv < lo ? lo : tv > hi ? hi : tv
}

/** 根据输入源类型返回滑块合理范围 */
function inputRangeBounds(source: string): { min: number; max: number } {
  if (source.startsWith('IMU_')) return { min: -90, max: 90 }
  if (source.startsWith('ANALOG_')) return { min: 0, max: 4095 }
  if (source === 'KNOB_EC11') return { min: -2000, max: 2000 }
  return { min: -5000, max: 5000 }
}

// 输入源下拉选项
const sourceOptions = computed(() =>
  configStore.deviceInfo?.input_sources?.map(s => ({
    title: SOURCE_LABELS[s.id] ?? s.id,
    value: s.id,
  })) ?? [],
)

// 按钮触发方式下拉选项 (从固件 button_triggers 动态获取，回退到硬编码)
const triggerOptions = computed(() => {
  const noneOption = { title: '无', value: 'NONE' }
  const list = configStore.deviceInfo?.button_triggers
  if (list && list.length > 0) {
    return [noneOption, ...list.map(t => ({ title: TRIGGER_LABELS[t] ?? t, value: t }))]
  }
  return [noneOption, ...Object.entries(TRIGGER_LABELS).map(([v, t]) => ({ title: t, value: v }))]
})

// μs → 0-100 进度 (居中映射)
function chanProgress(us: number): number {
  return ((us - 1000) / 10)  // 1000→0%, 1500→50%, 2000→100%
}

/** 查找通道 idx 的实时输出百分比, -1 表示无数据 */
function chanLivePct(idx: number): number {
  const ch = chStore.activeChannels.find(c => c.index === idx)
  if (!ch || !ch.used) return -1
  return Math.max(0, Math.min(100, chanProgress(ch.valueUs)))
}

// 轮询控制
function togglePoll(): void {
  chStore.polling ? chStore.stopPolling() : chStore.startPolling()
}

// 将 store 中的通道数据(CRSF raw)同步到可编辑副本(μs)
function syncEditFromStore(): void {
  editChannels.length = 0
  expandedIdx.value = null
  const src = configStore.config?.models?.[selectedSlot.value]?.channels
  if (src) {
    for (const ch of src) {
      editChannels.push({
        ...ch,
        output_min: rawToUs(ch.output_min),
        output_max: rawToUs(ch.output_max),
        output_center: rawToUs(ch.output_center),
        activate: { ...ch.activate, value: rawToUs(ch.activate.value) },
        deactivate: { ...ch.deactivate, value: rawToUs(ch.deactivate.value) },
        toggle: { ...ch.toggle, value: rawToUs(ch.toggle.value) },
      })
    }
  }
}

// 切换分页时同步
watch(selectedSlot, () => {
  syncEditFromStore()
})

async function loadFromDevice(): Promise<void> {
  await configStore.fetchDeviceInfo()
  await configStore.fetchAllModels()
  if (configStore.config) {
    selectedSlot.value = configStore.config.active_model
  }
  syncEditFromStore()
  // 自动开启通道轮询
  if (!chStore.polling) chStore.startPolling()
}

async function saveCurrentModel(): Promise<void> {
  const name = configStore.config?.models?.[selectedSlot.value]?.name || ''
  // 将 μs 转回 CRSF raw 再发送到固件
  const rawChannels = editChannels.map(ch => ({
    ...ch,
    output_min: usToRaw(ch.output_min),
    output_max: usToRaw(ch.output_max),
    output_center: usToRaw(ch.output_center),
    activate: { ...ch.activate, value: usToRaw(ch.activate.value) },
    deactivate: { ...ch.deactivate, value: usToRaw(ch.deactivate.value) },
    toggle: { ...ch.toggle, value: usToRaw(ch.toggle.value) },
  }))
  await configStore.setModel(selectedSlot.value, {
    name,
    channels: rawChannels,
  })
}

// 读取：从设备拉取模型覆盖当前编辑
async function readModel(): Promise<void> {
  await configStore.fetchModel(selectedSlot.value)
  syncEditFromStore()
}

// 写入：仅写入设备内存 (RAM)，不持久化
async function writeModel(): Promise<void> {
  await saveCurrentModel()
}

// 保存：写入内存 + 持久化到 NVS
async function saveModel(): Promise<void> {
  await saveCurrentModel()
  await configStore.saveConfig()
}

// 工具栏按钮别名
const saveToDevice = saveModel

// 仅切换选项卡加载数据，不自动激活
function onSlotSelect(slot: number): void {
  configStore.fetchModel(slot).then(() => syncEditFromStore())
}

// 激活当前模型为设备主配置
async function activateModel(): Promise<void> {
  await configStore.setActiveModel(selectedSlot.value)
}

// 进入页面自动轮询，离开页面停止
onMounted(() => {
  if (serial.connected && !chStore.polling) chStore.startPolling()
})

onUnmounted(() => {
  chStore.stopPolling()
})
</script>

<style scoped>
.channel-monitor {
  position: sticky;
  top: 8px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

.chan-row {
  display: flex;
  align-items: center;
  padding: 2px 0;
  min-height: 28px;
}

.chan-idx {
  width: 32px;
  flex-shrink: 0;
}

.chan-src {
  width: 68px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chan-val {
  width: 40px;
  flex-shrink: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}


.param-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.param-controls {
  display: flex;
  align-items: center;
}

.param-input-wrap {
  flex-shrink: 0;
}

.param-select {
  max-width: 130px;
}

.param-val {
  max-width: 160px;
}

.param-num-sm {
  max-width: 200px;
}

.action-btns {
  display: flex;
  gap: 4px;
}

.fab-container {
  display: none;
}

.detail-slider-wide {
  display: block;
}

.detail-slider-narrow {
  display: none !important;
}

.chan-header-wide {
  display: flex;
}

.chan-header-narrow {
  display: none !important;
}

@media (max-width: 450px) {
  .action-btns {
    display: none !important;
  }

  .fab-container {
    display: block !important;
  }
}

@media (max-width: 1024px) {
  .chan-header-wide {
    display: none !important;
  }

  .chan-header-narrow {
    display: flex !important;
  }

  .detail-slider-wide {
    display: none !important;
  }

  .detail-slider-narrow {
    display: block !important;
  }
}

.chan-live-bg {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(var(--v-theme-primary), 0.3);
  transition: width 0.2s ease;
  pointer-events: none;
  z-index: 0;
  border-radius: inherit;
}

.chan-header-row,
.v-expand-transition {
  position: relative;
  z-index: 1;
}

.chan-card {
  transition: border-color 0.3s, background-color 0.3s;
}

.card-selected {
  background-color: rgba(var(--v-theme-primary), 0.06) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
}
</style>
