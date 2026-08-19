<template>
  <div class="config-page">
    <v-snackbar v-model="snackbarVisible" color="info" timeout="2000">
      {{ snackbarMsg }}
    </v-snackbar>

    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-cog</v-icon>
        通道配置
      </v-toolbar-title>

    </v-toolbar>

    <!-- 未连接 -->
    <v-alert v-if="!serial.connected" class="ma-3" color="primary" border="start" border-color="primary"
      icon="mdi-information" variant="tonal">
      请先连接设备以加载和编辑配置
    </v-alert>

    <v-row v-if="serial.connected" dense>
      <!-- 左侧: 主配置区域 -->
      <v-col cols="12">
        <!-- 通道卡片列表 -->
        <template v-if="configStore.config && editChannels.length > 0">
          <template v-for="{ ch, idx } in visibleChannels" :key="idx">
                <v-sheet rounded="lg" class="my-2 chan-card" :class="{ 'card-selected': expandedIdx === idx }"
                  style="position:relative; overflow:visible; background: #1e1e1e;">
                  <!-- 头部行 -->
                  <div class="chan-header-row" style="cursor:pointer" @click="toggleExpand(idx)">
                    <!-- 布局: 左右两栏 (左=通道信息分组, 右=输出范围); 分组: CH号 | 输入源; 点击头部行任意处展开/收起 -->
                    <div class="chan-header-wide">
                      <div class="chan-head-left">
                        <!-- 组1: 通道编号 -->
                        <div class="chan-id-row">
                          <span class="text-caption font-weight-bold chan-id">CH{{ idx }}</span>
                        </div>
                        <!-- 组2: 输入源选择 -->
                        <div class="chan-source-row">
                          <v-select v-model="ch.source" :items="sourceOptions" density="compact" hide-details
                            variant="solo" class="chan-source-select"
                            @update:model-value="(val: string) => onSourceChange(idx, val)" @click.stop />
                        </div>
                      </div>
                      <template v-if="ch.source !== 'NONE'">
                        <div class="chan-head-right" @click.stop>
                          <template v-if="isButtonSource(ch.source)">
                            <div class="range-wrap">
                              <div class="slider-box" :ref="(el) => setSliderBoxRef(idx, el)">
                                <!-- 实时通道值背景条: 左端 = 左拨杆中心, 填充到实时值 -->
                                <div v-for="l in chanLivePxList(idx)" :key="'chan-live'" class="chan-live-bg"
                                  :style="{ left: l.left + 'px', width: l.width + 'px' }" />
                                <v-range-slider :model-value="[ch.output_min ?? 1000, ch.output_max ?? 2000]"
                                  @update:model-value="onBtnOutputRangeChange(idx, $event)" :min="1000" :max="2000"
                                  :step="1" density="compact" hide-details thumb-label />
                              </div>
                              <div class="range-ticks">
                                <span v-for="t in tickValues" :key="t" class="range-tick"
                                  :class="{ 'tick-hl': tickHighlight.has(t) }"
                                  :style="{ left: ((t - 1000) / 10) + '%' }">{{ t }}</span>
                              </div>
                            </div>
                          </template>
                          <template v-else>
                            <div class="range-wrap">
                              <div class="slider-box" :ref="(el) => setSliderBoxRef(idx, el)">
                                <!-- 实时通道值背景条: 左端 = 左拨杆中心, 填充到实时值 -->
                                <div v-for="l in chanLivePxList(idx)" :key="'chan-live'" class="chan-live-bg"
                                  :style="{ left: l.left + 'px', width: l.width + 'px' }" />
                                <v-range-slider :model-value="[ch.output_min ?? 1000, ch.output_max ?? 2000]"
                                  @update:model-value="(v: number[]) => { ch.output_min = v[0]!; ch.output_max = v[1]! }"
                                  :min="1000" :max="2000" :step="1" density="compact" hide-details thumb-label />
                                <!-- 中心值竖线: 可拖动设置输出中心, 拖动时显示气泡 -->
                                <div class="center-mark" :style="{ left: centerMarkLeftPx(idx) + 'px' }"
                                  @pointerdown="startCenterDrag(idx, $event)"
                                  @pointermove="onCenterDragMove($event)"
                                  @pointerup="endCenterDrag" @pointercancel="endCenterDrag">
                                  <SliderLabel v-if="centerDragShow && centerDragIdx === idx"
                                    :value="ch.output_center ?? 1500" class="center-mark-label" />
                                </div>
                              </div>
                              <div class="range-ticks">
                                <span v-for="t in tickValues" :key="t" class="range-tick"
                                  :class="{ 'tick-hl': tickHighlight.has(t), 'tick-overlap': isTickOverlap(idx, t) }"
                                  :data-t="t"
                                  :style="{ left: ((t - 1000) / 10) + '%' }">{{ t }}</span>
                                <!-- 中心值刻度: 始终绘制, 与静态刻度字符重叠时隐藏静态刻度 -->
                                <span class="range-tick tick-center"
                                  :style="{ left: ((centerValue(ch) - 1000) / 10) + '%' }">{{ centerValue(ch) }}</span>
                              </div>
                            </div>
                          </template>
                        </div>
                      </template>
                    </div>

                  </div>
                  <!-- 展开详情 (动画) -->
                  <v-expand-transition>
                    <div v-if="expandedIdx === idx && (effectiveSource(ch) !== 'NONE' || ch.condition.enabled)">
                      <v-divider />
                      <div class="pa-3 chan-expand-body">

                        <!-- 按钮通道: 触发配置 (动态添加, 最多 3 挡位) -->
                        <v-sheet v-if="isButtonSource(ch.source)" rounded="lg" class="pa-3 mb-3">
                          <div class="text-caption text-medium-emphasis mb-2">
                            多挡触发：1 挡时选择触发方式，触发后在输出最小/最大值间切换；2 挡及以上每条指定触发方式与输出值，同一种触发方式绑定多个挡位时循环切换，最多 3 挡。
                          </div>
                          <template v-for="(entry, i) in btnEntries(ch)" :key="i">
                            <v-divider v-if="i > 0" class="my-2" />
                            <div class="param-group">
                              <span class="text-caption font-weight-bold">挡位 {{ i + 1 }}</span>
                              <span class="param-controls">
                                <v-select v-model="entry.trigger" :items="triggerOptionsNoNone(ch.source)"
                                  class="param-select" density="compact" hide-details variant="outlined" />
                                <template v-if="btnEntryCount(ch) >= 2">
                                  <v-icon class="mx-1" size="16">mdi-arrow-right</v-icon>
                                  <v-number-input v-model="entry.value" :reverse="false"
                                    :min="ch.output_min ?? 1000" :max="ch.output_max ?? 2000" :step="1" class="param-val"
                                    controlVariant="stacked" density="compact" hide-details :hideInput="false"
                                    :inset="false" variant="outlined" style="width:130px" />
                                </template>
                                <span v-else class="text-caption text-medium-emphasis ml-2">
                                  触发时在输出最小↔最大间切换
                                </span>
                                <v-btn v-if="btnEntryCount(ch) > 1" icon="mdi-close" size="x-small" variant="text"
                                  color="error" @click="removeBtnEntry(ch, i)" />
                              </span>
                            </div>
                          </template>
                          <div v-if="btnEntryCount(ch) < 3" class="mt-2">
                            <v-btn class="btn-secondary" size="small" rounded="lg" prepend-icon="mdi-plus"
                              @click="addBtnEntry(ch)">添加按钮</v-btn>
                          </div>
                        </v-sheet>
                        <!-- 连续量通道: 死区/反向/输出中心 -->
                        <v-sheet v-if="isContinuousSource(ch.source)" rounded="lg" class="pa-3 mb-3">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">死区抖动</span>
                            <span class="param-input-wrap">
                              <v-number-input v-model="ch.deadzone" :min="0" :max="255" :step="1" controlVariant="stacked"
                                density="compact" hide-details :hideInput="false" :inset="false" variant="outlined"
                                style="min-width:100px" />
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
                              <div class="d-flex align-center mb-1">
                                <span class="text-caption font-weight-bold mr-2" style="min-width:90px">输入角度限制</span>
                              </div>
                              <div class="range-wrap">
                                <v-range-slider :model-value="[ch.input_min ?? 0, ch.input_max ?? 0]"
                                  @update:model-value="(v: number[]) => { ch.input_min = v[0]!; ch.input_max = v[1]! }"
                                  :min="inputRangeBounds(ch.source).min" :max="inputRangeBounds(ch.source).max" :step="1"
                                  density="compact" hide-details thumb-label />
                                <div class="range-ticks">
                                  <span v-for="t in inputTicks(inputRangeBounds(ch.source).min, inputRangeBounds(ch.source).max)"
                                    :key="t" class="range-tick"
                                    :style="{ left: ((t - inputRangeBounds(ch.source).min) / (inputRangeBounds(ch.source).max - inputRangeBounds(ch.source).min) * 100) + '%' }">{{ t }}</span>
                                </div>
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
                                  controlVariant="stacked" density="compact" hide-details :hideInput="false"
                                  :inset="false" variant="outlined" style="min-width:100px" />
                              </span>
                            </div>
                          </template>
                          <!-- MIX 混合配置 -->
                          <template v-if="ch.source === 'MIX'">
                            <v-divider class="my-2" />
                            <div class="param-group">
                              <span class="text-caption font-weight-bold">启用混合</span>
                              <v-switch v-model="ch.mix_enabled" color="primary" density="compact" hide-details />
                            </div>
                            <div v-if="ch.mix_enabled" class="mt-2">
                              <div v-for="(mi, miIdx) in ch.mix_items" :key="miIdx"
                                class="mix-item-card mb-2 pa-2" style="border-radius:8px">
                                <!-- 行1: 输入源 + 权重 -->
                                <div class="d-flex align-center ga-2 mb-2 mix-row1">
                                  <v-select v-model="mi.src" :items="mixSourceOptions" density="compact"
                                    hide-details variant="outlined" style="max-width:140px" />
                                  <v-slider v-model="mi.w" :min="-100" :max="100" :step="1"
                                    density="compact" hide-details thumb-label style="flex-grow:1" />
                                  <span class="text-caption" style="min-width:60px">权重: {{ mi.w }}</span>
                                  <v-btn icon="mdi-close" size="x-small" variant="text" color="error"
                                    @click="ch.mix_items!.splice(miIdx, 1)" />
                                </div>
                                <!-- 行2: 反向 -->
                                <div class="d-flex align-center ga-3">
                                  <v-switch v-model="mi.reverse" color="warning" density="compact"
                                    hide-details label="反向" />
                                </div>
                              </div>
                              <v-btn v-if="(ch.mix_items?.length ?? 0) < 4" class="btn-secondary" size="x-small"
                                rounded="lg" prepend-icon="mdi-plus"
                                @click="ch.mix_items!.push({ src: 'IMU_ROLL', w: 50, reverse: false })">
                                添加混合项
                              </v-btn>
                            </div>
                          </template>
                          <v-divider class="my-2" />
                        </v-sheet>

                        <!-- 条件覆盖 (最高优先级, 仅模拟输入: 摇杆 & IMU & 扳机) -->
                        <v-sheet v-if="isConditionSource(ch.source)" rounded="lg" class="pa-3 mb-3"
                          :class="{ 'cond-active': ch.condition.enabled }">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold"
                              style="color:rgb(var(--v-theme-warning))">&#9888; 条件覆盖</span>
                            <v-switch v-model="ch.condition.enabled" color="warning" density="compact" hide-details />
                          </div>
                          <v-expand-transition>
                            <div v-if="ch.condition.enabled">
                              <v-divider class="my-2" />
                              <div class="cond-row mb-2">
                                <div class="cond-row-item">
                                  <span class="text-caption font-weight-bold">监视通道</span>
                                  <v-select v-model="ch.condition.source_channel" :items="sourceChannelOptions"
                                    density="compact" hide-details variant="outlined" />
                                </div>
                                <div class="cond-action-block">
                                  <div class="cond-action-half">
                                    <span class="text-caption font-weight-bold">动作</span>
                                    <v-select v-model="ch.condition.switch_source" :items="conditionActionOptions"
                                      density="compact" hide-details variant="outlined" />
                                  </div>
                                  <div class="cond-action-half">
                                    <template v-if="!ch.condition.switch_source">
                                      <span class="text-caption font-weight-bold">输出值 (μs)</span>
                                      <v-number-input v-model="ch.condition.value" :min="1000" :max="2000" :step="1"
                                        controlVariant="stacked" density="compact" hide-details :hideInput="false"
                                        :inset="false" variant="outlined" />
                                    </template>
                                    <template v-else>
                                      <span class="text-caption font-weight-bold">替代输入源</span>
                                      <v-select v-model="ch.condition.alt_source" :items="altSourceOptions" density="compact"
                                        hide-details variant="outlined" />
                                    </template>
                                  </div>
                                </div>
                              </div>
                              <div class="cond-range-wrap">
                                <span class="text-caption font-weight-bold">阈值范围 (μs)</span>
                                <v-range-slider
                                  :model-value="[ch.condition.low ?? 1000, ch.condition.high ?? 2000]"
                                  @update:model-value="(v: number[]) => { ch.condition.low = v[0]!; ch.condition.high = v[1]! }"
                                  :min="1000" :max="2000" :step="1" density="compact" hide-details thumb-label />
                                <div class="range-ticks">
                                  <span v-for="t in tickValues" :key="t" class="range-tick"
                                    :class="{ 'tick-hl': tickHighlight.has(t) }"
                                    :style="{ left: ((t - 1000) / 10) + '%' }">{{ t }}</span>
                                </div>
                              </div>
                            </div>
                          </v-expand-transition>
                        </v-sheet>

                        <!-- 安全锁: 固定 CH4 > 1500μs 控制 -->
                        <v-sheet rounded="lg" class="pa-3 mb-3" :class="{ 'cond-active': ch.lock_enabled }">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">&#128274;
                              安全锁 (CH4 &gt;
                              1500μs 时解锁)</span>
                            <v-switch v-model="ch.lock_enabled" color="primary" density="compact" hide-details />
                          </div>
                          <v-expand-transition>
                            <div v-if="ch.lock_enabled">
                              <v-divider class="my-2" />
                              <div class="param-group">
                                <span class="text-caption font-weight-bold">锁定输出值 (μs)</span>
                                <span class="param-input-wrap">
                                  <v-number-input v-model="ch.lock_value" :min="1000" :max="2000" :step="1"
                                    controlVariant="stacked" density="compact" hide-details :hideInput="false"
                                    :inset="false" variant="outlined" style="min-width:100px" />
                                </span>
                              </div>
                            </div>
                          </v-expand-transition>
                        </v-sheet>
                      </div>
                    </div>
                  </v-expand-transition>
                </v-sheet>
              </template>
        </template>

        <!-- 未加载提示 -->
        <v-card v-if="!configStore.config" variant="outlined">
          <v-card-text class="text-center py-8">
            <v-icon class="mb-2" color="grey" size="48">mdi-download</v-icon>
            <div class="text-body-1 text-medium-emphasis">
              连接设备后将自动加载配置
            </div>
          </v-card-text>
        </v-card>
      </v-col>

    </v-row>

    <!-- 底栏: 行为/宽度与顶栏一致 (自动避开抽屉, 抽屉开合时跟随) -->
    <v-app-bar v-if="serial.connected" location="bottom" color="surface" density="compact" elevation="1"
      class="px-3">
      <template v-if="(configStore.modelCount ?? 0) > 1">
        <v-select v-model="selectedSlot" class="model-select ml-3" :items="modelOptions" item-title="title"
          item-value="value" density="compact" variant="outlined" hide-details
          @update:model-value="onSlotSelect" />
      </template>
      <v-spacer />
      <v-btn v-if="configStore.config" class="btn-secondary me-2" prepend-icon="mdi-check-circle" size="small"
        rounded="lg" :disabled="selectedSlot === configStore.config.active_model" @click="activateModel">
        <span class="btn-text">设为默认</span>
      </v-btn>
      <v-btn class="btn-secondary me-2" prepend-icon="mdi-download" size="small" rounded="lg"
        :loading="configStore.loading" @click="loadFromDevice">
        <span class="btn-text">从设备加载</span>
      </v-btn>
      <v-btn v-if="configStore.config" class="btn-primary" prepend-icon="mdi-content-save" size="small"
        rounded="lg" :loading="savingModel" @click="saveModel">
        <span class="btn-text">保存到设备</span>
      </v-btn>
    </v-app-bar>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import SliderLabel from '@/components/SliderLabel.vue'
import { useSerialStore } from '@/stores/serial'
import { useConfigStore, type ModelChannel } from '@/stores/config'
import { useChannelStore } from '@/stores/channels'
import { rawToUs, usToRaw } from '@/utils/crsf'
import { CHANNEL_LINK_ONLY } from '@/utils/debugFlags'

const serial = useSerialStore()
const configStore = useConfigStore()
const chStore = useChannelStore()
const selectedSlot = ref(0)

// 当前模型的可编辑通道副本 (存储 μs 值供 UI 编辑)
const editChannels = reactive<ModelChannel[]>([])

// 当前展开的通道行 (null = 无展开)
const expandedIdx = ref<number | null>(null)

// 通道列表: 保留原始索引, 展开/实时值/源切换等逻辑不受影响
const visibleChannels = computed<{ ch: ModelChannel; idx: number }[]>(() =>
  editChannels.map((ch, idx) => ({ ch, idx })),
)
// 模型下拉选项 (选项式切换)
const modelOptions = computed(() =>
  (configStore.config?.models ?? []).map((m, i) => ({
    title: `Model ${i + 1}${m?.name ? ` · ${m.name}` : ''}`,
    value: i,
  })),
)
const snackbarMsg = ref('')
const snackbarVisible = ref(false)
const savingModel = ref(false)

function toggleExpand(idx: number): void {
  expandedIdx.value = expandedIdx.value === idx ? null : idx
}

// 输入源枚举 → 中文标签
const SOURCE_LABELS: Record<string, string> = {
  NONE: '无',
  BUTTON_LOCK: 'LOCK 按钮',
  BUTTON_MH: 'MH 按钮',
  BUTTON_EC11_BTN: 'EC11 按钮',
  BUTTON_SHOT: 'SHOT 按钮',
  ANALOG_TRIGGER: '扳机',
  ANALOG_JOYSTICK_X: '摇杆 X',
  ANALOG_JOYSTICK_Y: '摇杆 Y',
  IMU_ROLL: 'IMU Roll',
  IMU_PITCH: 'IMU Pitch',
  KNOB_EC11: 'EC11 旋钮',
  MIX: '混合输入',
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

// 按钮类输入源
const BUTTON_SOURCES = new Set(['BUTTON_LOCK', 'BUTTON_MH', 'BUTTON_EC11_BTN', 'BUTTON_SHOT'])
// 连续量输入源
const CONTINUOUS_SOURCES = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'KNOB_EC11', 'MIX',
])

function isButtonSource(s: string): boolean { return BUTTON_SOURCES.has(s) }
function isContinuousSource(s: string): boolean { return CONTINUOUS_SOURCES.has(s) }

// IMU 类输入源 (中心值固定为 0，无需配置)
const IMU_SOURCES = new Set(['IMU_ROLL', 'IMU_PITCH'])
function isImuSource(s: string): boolean { return IMU_SOURCES.has(s) }

// EC11 旋钮输入源 (仅能绑定一个通道)
const KNOB_EC11_SOURCES = new Set(['KNOB_EC11'])
function isKnobEc11Source(s: string): boolean { return KNOB_EC11_SOURCES.has(s) }

// 支持条件覆盖的输入源: 模拟输入(摇杆 & IMU & 扳机)
const CONDITION_SOURCES = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH',
])
function isConditionSource(s: string): boolean { return CONDITION_SOURCES.has(s) }

/** 计算通道的有效输入源 (考虑条件覆盖切换) */
function effectiveSource(ch: ModelChannel): string {
  if (ch.condition?.enabled && ch.condition.switch_source) {
    return ch.condition.alt_source
  }
  return ch.source
}

// 来源变更时：EC11 互斥，自动从旧通道移除
function onSourceChange(idx: number, newSource: string): void {
  if (newSource === 'KNOB_EC11') {
    for (let i = 0; i < editChannels.length; i++) {
      if (i !== idx && editChannels[i]!.source === 'KNOB_EC11') {
        editChannels[i]!.source = 'NONE'
        snackbarMsg.value = `EC11 已从 CH${i} 移动到 CH${idx}`
        snackbarVisible.value = true
      }
    }
  }
  // 切到按钮输入源且尚无触发挡位时, 自动添加默认挡位 (单挡位任意触发)
  if (isButtonSource(newSource)) {
    const ch = editChannels[idx]!
    if (btnEntryCount(ch) === 0) addBtnEntry(ch)
  }
}

// ── 按钮触发: 动态挡位条目 (activate/deactivate/toggle 对应挡位 1/2/3) ──
const BTN_SLOT_KEYS = ['activate', 'deactivate', 'toggle'] as const

/** 当前已激活的触发挡位条目 (trigger != NONE) */
function btnEntries(ch: ModelChannel) {
  return BTN_SLOT_KEYS.map(k => ch[k]).filter(e => e && e.trigger !== 'NONE')
}

function btnEntryCount(ch: ModelChannel): number {
  return btnEntries(ch).length
}

/** 添加一个触发挡位 (最多 3 个) */
function addBtnEntry(ch: ModelChannel): void {
  const n = btnEntryCount(ch)
  if (n >= 3) return
  const entry = ch[BTN_SLOT_KEYS[n]!]
  entry.trigger = 'SINGLE_CLICK'
  entry.value = ch.output_center ?? 1500
}

/** 删除第 idx 个触发挡位, 后续挡位紧凑前移 */
function removeBtnEntry(ch: ModelChannel, idx: number): void {
  const entries = BTN_SLOT_KEYS.map(k => ch[k])
  entries.splice(idx, 1)
  entries.push({ trigger: 'NONE', value: 1500 })
  ch.activate = entries[0]!
  ch.deactivate = entries[1]!
  ch.toggle = entries[2]!
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

// 输出范围刻度: 1000~2000 静态刻度 (8 等分)
// 刻度值: 主要值 1000/1500/2000 附近加密 (±100), 中段稀疏
const tickValues = [1000, 1250, 1500, 1750, 2000]

// 中心值钳制到刻度范围 (1000~2000)
function centerValue(ch: ModelChannel): number {
  return Math.min(Math.max(ch.output_center ?? 1500, 1000), 2000)
}

// 高亮刻度值 (主要值)
const tickHighlight = new Set([1000, 2000])

/** 输入范围刻度: 动态 min/max 8 等分 */
function inputTicks(min: number, max: number): number[] {
  const arr: number[] = []
  for (let i = 0; i <= 8; i++) arr.push(Math.round(min + ((max - min) * i) / 8))
  return arr
}

// MIX 可选的连续量输入源 (排除按钮、EC11 旋钮、MIX 自身)
const mixSourceOptions = computed(() =>
  configStore.deviceInfo?.input_sources
    ?.filter(s => s.id !== 'NONE' && !BUTTON_SOURCES.has(s.id)
      && s.id !== 'KNOB_EC11' && s.id !== 'MIX')
    .map(s => ({ title: SOURCE_LABELS[s.id] ?? s.id, value: s.id })) ?? [],
)

// 输入源下拉选项
const sourceOptions = computed(() =>
  configStore.deviceInfo?.input_sources?.map(s => ({
    title: SOURCE_LABELS[s.id] ?? s.id,
    value: s.id,
  })) ?? [],
)

// 条件覆盖: 替代输入源选项 (仅模拟类: 摇杆 & 扳机 & IMU & EC11 旋钮)
const ALT_SOURCE_ALLOWED = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'KNOB_EC11',
])
const altSourceOptions = computed(() =>
  sourceOptions.value.filter(o => ALT_SOURCE_ALLOWED.has(o.value)),
)

// 条件: 监视通道下拉 (CH0~CH15)
const sourceChannelOptions = computed(() =>
  Array.from({ length: 16 }, (_, i) => ({ title: `CH${i}`, value: i })),
)

// 条件: 动作下拉（固定输出值 / 切换输入源）
const conditionActionOptions = [
  { title: '固定输出值', value: false },
  { title: '切换输入源', value: true },
]

// 按钮触发方式下拉选项 (从固件 button_triggers 动态获取，回退到硬编码)
// SHOT 按钮单击用于系统级 IMU 归零，不可选
function triggerOptions(source?: string) {
  const noneOption = { title: '无', value: 'NONE' }
  const list = configStore.deviceInfo?.button_triggers
  let items: { title: string; value: string }[]
  if (list && list.length > 0) {
    items = list.map(t => ({ title: TRIGGER_LABELS[t] ?? t, value: t }))
  } else {
    items = Object.entries(TRIGGER_LABELS).map(([v, t]) => ({ title: t, value: v }))
  }
  if (source === 'BUTTON_SHOT') {
    items = items.filter(item => item.value !== 'SINGLE_CLICK')
  }
  return [noneOption, ...items]
}

// 动态挡位条目的触发方式选项 (不含 NONE; 条目存在即必须有触发方式)
function triggerOptionsNoNone(source?: string) {
  return triggerOptions(source).filter(o => o.value !== 'NONE')
}

/** 通道实时值在输出范围滑块上的定位: 起点对齐 output_min, 填充到实时值位置 */
function chanLive(idx: number): { startPct: number; fillPct: number } | null {
  const ch = chStore.activeChannels.find(c => c.index === idx)
  if (!ch || !ch.used) return null
  const cfg = editChannels[idx]
  const lo = cfg?.output_min ?? 1000
  const hi = cfg?.output_max ?? 2000
  const us = ch.valueUs
  // output_min / output_max / 实时值在 1000~2000 全局刻度上的百分比位置
  const startPct = (lo - 1000) / 10
  const endPct = (hi - 1000) / 10
  const curPct = (us - 1000) / 10
  // 实时值填充到 output_min~output_max 区间内, 超出则钳制到区间边界
  const clamped = Math.max(startPct, Math.min(endPct, curPct))
  return {
    startPct,
    fillPct: Math.max(0, clamped - startPct),
  }
}

/** 通道实时值背景条: 左端 = 左拨杆中心, 右端对齐滑块轨道右端 */
function chanLivePx(idx: number): { left: number; width: number } | null {
  const live = chanLive(idx)
  if (!live) return null
  void resizeTick.value // 窗口尺寸变化时强制重算
  const box = sliderBoxRefs.get(idx)
  if (!box) return null
  const boxRect = box.getBoundingClientRect()
  const thumbs = box.querySelectorAll<HTMLElement>('.v-slider-thumb')
  if (thumbs.length < 2) return null
  const track = box.querySelector<HTMLElement>('.v-slider-track')
  if (!track) return null
  const r0 = thumbs[0]!.getBoundingClientRect()
  const trackRight = track.getBoundingClientRect().right
  const c0 = r0.left + r0.width / 2 // 左拨杆中心 = output_min 位置
  return {
    left: c0 - boxRect.left,
    width: Math.max(0, (trackRight - c0) * (live.fillPct / 100)),
  }
}

// 返回数组供 v-for 使用: 测量失败时返回空数组 → 不渲染
function chanLivePxList(idx: number): { left: number; width: number }[] {
  const px = chanLivePx(idx)
  return px ? [px] : []
}

// 滑块容器引用 + 窗口尺寸变化 → 用于测量通道条
const resizeTick = ref(0)
const sliderBoxRefs = new Map<number, HTMLElement>()
function setSliderBoxRef(idx: number, el: unknown): void {
  if (el) sliderBoxRefs.set(idx, el as HTMLElement)
  else sliderBoxRefs.delete(idx)
}
function onWindowResize(): void {
  resizeTick.value++
  nextTick(measureTickOverlap)
}

// 动态刻度与静态刻度字符重叠检测: 实测矩形相交, 重叠时隐藏静态刻度
const overlapTick = ref(0)
const tickOverlapCache = new Map<number, Set<number>>()
function isTickOverlap(idx: number, t: number): boolean {
  void overlapTick.value
  return tickOverlapCache.get(idx)?.has(t) ?? false
}
function measureTickOverlap(): void {
  const next = new Map<number, Set<number>>()
  sliderBoxRefs.forEach((box, idx) => {
    const ticksEl = box.parentElement?.querySelector<HTMLElement>('.range-ticks')
    const dyn = ticksEl?.querySelector<HTMLElement>('.range-tick.tick-center')
    if (!ticksEl || !dyn) return
    const dr = dyn.getBoundingClientRect()
    if (!dr.width) return // 尚未渲染完成
    const set = new Set<number>()
    ticksEl.querySelectorAll<HTMLElement>('.range-tick[data-t]').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (dr.left < r.right && dr.right > r.left) set.add(Number(el.dataset.t))
    })
    next.set(idx, set)
  })
  tickOverlapCache.clear()
  next.forEach((v, k) => tickOverlapCache.set(k, v))
  overlapTick.value++
}

// 中心值竖线: 位置换算与拖拽手势
function centerMarkLeftPx(idx: number): number {
  void resizeTick.value
  const box = sliderBoxRefs.get(idx)
  const track = box?.querySelector<HTMLElement>('.v-slider-track')
  const ch = editChannels[idx]
  if (!box || !track || !ch) return 0
  const boxRect = box.getBoundingClientRect()
  const r = track.getBoundingClientRect()
  const v = Math.min(Math.max(ch.output_center ?? 1500, 1000), 2000)
  return r.left - boxRect.left + ((v - 1000) / 1000) * r.width
}
function centerValueFromClientX(idx: number, clientX: number): number {
  const track = sliderBoxRefs.get(idx)?.querySelector<HTMLElement>('.v-slider-track')
  if (!track) return 1500
  const r = track.getBoundingClientRect()
  const v = Math.round(1000 + ((clientX - r.left) / r.width) * 1000)
  return Math.min(Math.max(v, 1000), 2000)
}
const centerDragShow = ref(false)
let centerDragIdx: number | null = null
function startCenterDrag(idx: number, e: PointerEvent): void {
  centerDragIdx = idx
  centerDragShow.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const ch = editChannels[idx]
  if (ch) ch.output_center = centerValueFromClientX(idx, e.clientX)
}
function onCenterDragMove(e: PointerEvent): void {
  if (centerDragIdx == null) return
  const ch = editChannels[centerDragIdx]
  if (ch) ch.output_center = centerValueFromClientX(centerDragIdx, e.clientX)
}
function endCenterDrag(): void {
  centerDragIdx = null
  centerDragShow.value = false
}

// 防止同步时触发自动写入的标志
let syncing = false

// 将 store 中的通道数据(CRSF raw)同步到可编辑副本(μs)
function syncEditFromStore(): void {
  syncing = true
  editChannels.length = 0
  expandedIdx.value = null
  const src = configStore.config?.models?.[selectedSlot.value]?.channels
  if (src) {
    for (const ch of src) {
      // 固件使用平铺缩写字段 (cond_enabled/cond_src/...)，前端使用嵌套 condition 对象
      const flat = ch as Record<string, any>
      const hasFlat = flat.cond_enabled !== undefined
      editChannels.push({
        source: ch.source,
        activate: { trigger: ch.activate?.trigger ?? 'NONE', value: rawToUs(ch.activate?.value ?? 186) },
        deactivate: { trigger: ch.deactivate?.trigger ?? 'NONE', value: rawToUs(ch.deactivate?.value ?? 186) },
        toggle: { trigger: ch.toggle?.trigger ?? 'NONE', value: rawToUs(ch.toggle?.value ?? 186) },
        input_min: ch.input_min,
        input_center: ch.input_center,
        input_max: ch.input_max,
        output_min: rawToUs(ch.output_min),
        output_max: rawToUs(ch.output_max),
        output_center: rawToUs(ch.output_center),
        deadzone: ch.deadzone,
        ec11_step: ch.ec11_step,
        reverse: !!ch.reverse,
        condition: hasFlat ? {
          enabled: !!flat.cond_enabled,
          source_channel: flat.cond_src ?? 0,
          low: rawToUs(flat.cond_low ?? 1000),
          high: rawToUs(flat.cond_high ?? 2000),
          switch_source: !!flat.cond_switch,
          value: rawToUs(flat.cond_val ?? 991),
          alt_source: flat.cond_alt ?? 'NONE',
        } : {
          enabled: false, source_channel: 0, low: 1000, high: 2000,
          switch_source: false, value: 1500, alt_source: 'NONE',
        },
        lock_enabled: !!flat.lock_enabled,
        lock_value: rawToUs(flat.lock_value ?? 991),
        mix_enabled: !!flat.mix_enabled,
        mix_items: Array.isArray(flat.mix_items) ? flat.mix_items.map((mi: any) => ({
          src: mi.src ?? 'NONE',
          w: mi.w ?? 0,
          reverse: !!mi.reverse,
        })) : [],
      })
    }
  }
  // 延迟复位标志，确保 Vue 响应式更新完毕
  nextTick(() => { syncing = false })
}

async function loadFromDevice(): Promise<void> {
  // 拉取大 JSON (get_model) 前暂停 20ms 通道轮询, 避免抢占 BLE 响应带宽
  chStore.stopPolling()
  try {
    await configStore.fetchDeviceInfo()
    await configStore.fetchActiveModel()
    // 只拉当前激活 model, 不再串行拉取全部 8 个
    await configStore.fetchActiveModelData()
    if (configStore.config) {
      selectedSlot.value = configStore.config.active_model
    }
    syncEditFromStore()
    // 加载完成后校验: 配置或激活模型缺失 → 提示用户, 不再静默空白
    if (!configStore.config || !configStore.activeModel) {
      snackbarMsg.value = '配置加载不完整，请点击「从设备加载」重试'
      snackbarVisible.value = true
    }
  } catch (e) {
    snackbarMsg.value = `配置加载失败: ${(e as Error).message || '未知错误'}`
    snackbarVisible.value = true
  } finally {
    // 自动开启通道轮询
    if (!chStore.polling) chStore.startPolling()
  }
}

async function saveCurrentModel(): Promise<boolean> {
  const name = configStore.config?.models?.[selectedSlot.value]?.name || ''
  // 将 μs 转回 CRSF raw 再发送到固件
  // 条件字段需扁平化并映射到固件缩写的 JSON key
  const rawChannels = editChannels.map(ch => {
    const { condition, activate, deactivate, toggle, ...rest } = ch
    // 嵌套 condition 也要转 raw (encodeChannelTlv 直接用嵌套对象编码 0x0e)
    const condRaw = {
      ...condition,
      low: usToRaw(condition.low),
      high: usToRaw(condition.high),
      value: usToRaw(condition.value),
    }
    return {
      ...rest,
      condition: condRaw,
      output_min: usToRaw(ch.output_min),
      output_max: usToRaw(ch.output_max),
      output_center: usToRaw(ch.output_center),
      activate: { trigger: activate.trigger, value: usToRaw(activate.value) },
      deactivate: { trigger: deactivate.trigger, value: usToRaw(deactivate.value) },
      toggle: { trigger: toggle.trigger, value: usToRaw(toggle.value) },
      cond_enabled: condition.enabled,
      cond_src: condition.source_channel,
      cond_low: condRaw.low,
      cond_high: condRaw.high,
      cond_switch: condition.switch_source,
      cond_val: condRaw.value,
      cond_alt: condition.alt_source,
      lock_enabled: ch.lock_enabled,
      lock_value: usToRaw(ch.lock_value),
      mix_enabled: ch.mix_enabled,
      mix_items: ch.mix_items?.map(mi => ({ src: mi.src, w: mi.w, reverse: mi.reverse })) ?? [],
    }
  })
  return await configStore.setModel(selectedSlot.value, {
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
  savingModel.value = true
  try {
    const setOk = await saveCurrentModel()
    // 等待 150ms 确保 ESP32 完成前面 JSON 数据的存储和处理
    await new Promise(r => setTimeout(r, 150))
    const saveOk = await configStore.saveConfig()
    snackbarMsg.value = (setOk !== false && saveOk) ? '配置已固化保存到设备' : '保存失败，请重试'
    snackbarVisible.value = true
  } catch {
    snackbarMsg.value = '保存过程中发生错误'
    snackbarVisible.value = true
  } finally {
    savingModel.value = false
  }
}

// 切换选项卡时只切换运行槽位，不修改持久激活槽位
async function onSlotSelect(slot: number): Promise<void> {
  if (CHANNEL_LINK_ONLY) return  // 调试: 暂停切换槽位同步
  syncing = true
  editChannels.length = 0
  expandedIdx.value = null

  try {
    await configStore.fetchModel(slot)
    await configStore.setRuntimeModel(slot)
    syncEditFromStore()
  } catch {
    syncing = false
  }
}

// 激活当前模型为设备主配置
async function activateModel(): Promise<void> {
  const ok = await configStore.setActiveModel(selectedSlot.value)
  snackbarMsg.value = ok ? '模型已激活' : '激活失败'
  snackbarVisible.value = true
}

/** 进入页面/连接建立后：恢复配置显示或从设备加载（含通道流启停） */
async function enterPage(): Promise<void> {
  if (!serial.connected) return
  if (configStore.config) {
    // store 中已有配置（组件重建导致 editChannels 丢失）→ 直接恢复显示
    selectedSlot.value = configStore.config.active_model
    syncEditFromStore()
  } else {
    await loadFromDevice()
  }
}

// 进入页面自动轮询 + 自动加载配置，离开页面停止
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  if (serial.connected && !chStore.polling) chStore.startPolling()
  if (CHANNEL_LINK_ONLY) return  // 调试: 仅保留通道监视, 暂停自动加载
  enterPage()
  // 初次渲染完成后测量刻度重叠 (字体就绪后再测一次)
  nextTick(measureTickOverlap)
  document.fonts?.ready.then(() => measureTickOverlap())
})

// 页面打开后再连接设备时，自动加载配置
watch(() => serial.connected, (connected) => {
  if (CHANNEL_LINK_ONLY) return  // 调试: 暂停连接时自动加载
  if (!connected) return
  enterPage()
})

// 通道配置任一字段变更 → 防抖后自动写入设备内存 (不持久化)
let writeTimer: ReturnType<typeof setTimeout> | null = null
watch(editChannels, () => {
  if (CHANNEL_LINK_ONLY) return  // 调试: 暂停编辑自动写
  if (syncing) return   // 跳过程序化同步
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeModel()
    writeTimer = null
  }, 300)
}, { deep: true })

// 输出中心变化 → 重测刻度重叠
watch(() => editChannels.map((c) => c.output_center).join(','), () => {
  nextTick(measureTickOverlap)
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  chStore.stopPolling()
})
</script>

<style scoped>
.param-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 条件覆盖: 监视通道/动作 横排 */
.cond-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.cond-row-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

/* 条件覆盖: 动作块 = 动作 + 输出值/输入源 左右结构, 占 2/3 */
.cond-action-block {
  display: flex;
  gap: 8px;
  flex: 2;
  min-width: 0;
}

.cond-action-half {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.cond-row-item .v-select,
.cond-row-item .v-number-input,
.cond-action-half .v-select,
.cond-action-half .v-number-input {
  width: 100%;
}

/* 条件覆盖: 阈值范围滑块行 */
.cond-range-wrap {
  margin-top: 8px;
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

.chan-header-wide {
  display: flex;
  align-items: center;
  justify-content: space-between; /* 左栏靠左、右栏靠右, 中间留白 */
  gap: 24px;
}

/* 左栏: 通道编号 + 名称 + 输入源 */
.chan-head-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  width: 190px;
  background: #262626;
  padding: 8px;
  border-radius: 8px;
  align-self: stretch;
}

.chan-id-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.chan-id {
  min-width: 32px;
  text-align: center;
}

/* 组2: 输入源选择 */
.chan-source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.chan-source-select {
  flex: 1;
  min-width: 0;
}

/* 右栏: 输出范围滑块 */
.chan-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  position: relative;
  padding: 0 24px 0 16px; /* 左 16px, 右 24px (右侧 ×1.5), 给左右手柄留安全距离 */
}

/* 消除 Vuetify 滑块默认左右缩进, 轨道在 16px 内边距内占满整行 */
:deep(.chan-head-right .v-slider) {
  margin-inline: 0 !important;
}

/* 窄卡片: 左右布局退回单行换行 + 信息组横排 (基于卡片实际宽度) */
@container (max-width: 900px) {
  .chan-header-wide {
    flex-wrap: wrap;
  }

  /* 窄屏: CH号靠左, 右侧组靠右, 中间留白 */
  .chan-head-left {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
  }

  /* 输入源选择组缩窄, 避免半行过宽 */
  .chan-source-row {
    flex: 0 1 35%;
    max-width: 35%;
    min-width: 0;
  }

  .chan-head-right {
    width: 100%;
    /* 左 16px, 右 24px (右侧 ×1.5), 下 12px 给刻度线留出下方空间 */
    padding: 0 24px 12px 16px;
  }
}

@media (max-width: 450px) {
  .action-btns {
    display: none !important;
  }

  .fab-container {
    display: block !important;
  }
}

/* ── 移动端优化 ── */
@media (max-width: 600px) {
  /* ① 工具栏只留图标, 防挤压溢出 */
  .btn-text {
    display: none;
  }

  /* ② 参数行窄屏换行, 避免控件溢出卡片 */
  .param-group {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  /* ②-1 条件覆盖横排: 窄屏每行最多两个, 极端宽度自动堆叠 */
  .cond-row {
    flex-wrap: wrap;
  }

  .cond-row-item {
    flex: 1 1 calc(50% - 4px);
    min-width: 120px;
  }

  /* 窄屏动作块换到下一行整行显示, 内部左右半区仍各半 */
  .cond-action-block {
    flex: 1 1 100%;
  }

  /* ③ MIX 行1: 滑块独占一行, 保证可拖动 */
  .mix-row1 {
    flex-wrap: wrap;
  }

  .mix-row1 .v-slider {
    flex-basis: 100%;
    order: 3;
  }

  /* ⑤ 触控目标增大至 44px, 减少误触 */
  .param-controls .v-btn,
  .chan-header-row .v-btn {
    min-width: 44px;
    min-height: 44px;
  }

  /* ⑥ 底部安全区留白 (iOS 刘海屏) */
  :deep(.v-main) {
    padding-bottom: env(safe-area-inset-bottom);
  }
}

.chan-live-bg {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 24px;
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.15);
  transition: left 0.15s ease, width 0.15s ease;
  pointer-events: none;
  z-index: 0;
}

/* 移除 v-progress-linear 内置过渡, 消除前端渲染滞后 */
:deep(.v-progress-linear__bar__determinate) {
  transition: none;
}

.chan-header-row,
.v-expand-transition {
  position: relative;
  z-index: 1;
}

/* 通道卡片作为容器查询基准, 宽/窄屏按实际卡片宽度切换 */
.chan-card {
  container-type: inline-size;
  transition: border-color 0.3s, background-color 0.3s;
}

/* 展开内容区: 比卡片底色 #1e1e1e 略深 */
.chan-expand-body {
  background: #1a1a1a;
  border-radius: 0 0 8px 8px;
}

.card-selected {
  border-color: rgb(var(--v-theme-primary)) !important;
}

.cond-active {
  border-color: rgb(var(--v-theme-warning)) !important;
}

/* ── Betaflight 风格 ── */

/* ② 页面标题左侧橙色高亮 */
.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}

/* ⑤ 范围滑块扁平化 + 主色填充 (Betaflight 双滑块风格) */
.range-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.slider-box {
  position: relative;
}

:deep(.v-slider-track__background) {
  background: #3a3a3a !important;
  opacity: 1 !important;
}

:deep(.v-slider-track__fill) {
  background: rgb(var(--v-theme-primary)) !important;
}

:deep(.v-slider-thumb__surface) {
  width: 24px;
  height: 24px;
  background: rgb(var(--v-theme-primary)) !important;
  border: none !important;
  box-shadow: none !important;
}

:deep(.v-slider-thumb__surface::after) {
  content: none;
}

/* 中心值竖线: 独立可拖动元素, 不遮挡范围滑块 */
.center-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 16px;
  margin-left: -8px;
  cursor: ew-resize;
  z-index: 2;
}
.center-mark::before {
  content: '';
  position: absolute;
  left: 6.5px;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
}
/* 中心值气泡: 复用 SliderLabel 组件 (与拨杆气泡结构/样式一致) */
.center-mark-label {
  z-index: 3;
}

/* 滑块气泡: 主色背景 + 深色文字, 提升可见度 */
:deep(.v-slider-thumb__label) {
  background: rgb(var(--v-theme-primary)) !important;
  color: #1a1a1a !important;
  font-weight: 700 !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
}

:deep(.v-slider-thumb__label::before) {
  color: rgb(var(--v-theme-primary)) !important;
}

/* 强化滑块点击涟漪波纹动画 (主色) */
:deep(.v-slider-thumb__ripple) {
  color: rgb(var(--v-theme-primary)) !important;
  opacity: 0.35 !important;
}

/* switch 配色 */
/* 开启 (on): 滑槽主色 + 拨杆白色 */
:deep(.v-switch .v-selection-control--dirty .v-switch__track) {
  background: rgb(var(--v-theme-primary)) !important;
  opacity: 1 !important;
}

/* 未开启 (off): 滑槽 #404040 + 拨杆 #FFFFFF */
:deep(.v-switch .v-switch__track) {
  background: #404040 !important;
  opacity: 1 !important;
}

:deep(.v-switch .v-switch__thumb) {
  background: #ffffff !important;
  border: none !important;
  box-shadow: none !important;
}

/* 开启时拨杆与滑槽同色 (主色) */
:deep(.v-switch .v-selection-control--dirty .v-switch__thumb) {
  background: rgb(var(--v-theme-primary)) !important;
}

/* 禁用态: 拨杆 #727272 + 滑槽 #262626 */
:deep(.v-switch .v-selection-control--disabled .v-switch__track) {
  background: #262626 !important;
  opacity: 1 !important;
}

:deep(.v-switch .v-selection-control--disabled .v-switch__thumb) {
  background: #727272 !important;
}

/* 强化 switch 点击涟漪波纹动画 (主色) */
:deep(.v-switch .v-selection-control__ripple) {
  color: rgb(var(--v-theme-primary)) !important;
  opacity: 0.35 !important;
}

/* 静态刻度: 按数值百分比定位 + 竖线标记 */
.range-ticks {
  position: relative;
  height: 22px;
  line-height: 1;
  margin-top: 2px;
  /* 与 .chan-head-right 的 padding 对齐 (左 16px / 右 24px), 使刻度区间与轨道区间一致 */
  margin-left: 16px;
  margin-right: 24px;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.4);
}

.range-tick {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  font-size: 12px;
  line-height: 1;
  user-select: none;
  white-space: nowrap;
  transition: opacity 0.25s ease-in-out, visibility 0.25s ease-in-out;
}

/* 竖线标记 */
.range-tick::before {
  content: '';
  position: absolute;
  left: 50%;
  top: -8px;
  width: 1px;
  height: 7px;
  background: rgba(255, 255, 255, 0.3);
  transform: translateX(-50%);
}

/* 高亮刻度 (1000/1500/2000) */
.range-tick.tick-hl {
  color: #ffffff;
  font-weight: 700;
}

.range-tick.tick-hl::before {
  background: #ffffff;
  height: 9px;
}

/* 中心值刻度: 主题色高亮 */
.range-tick.tick-center {
  color: rgb(var(--v-theme-primary)) !important;
}
.range-tick.tick-center::before {
  background: rgb(var(--v-theme-primary)) !important;
  height: 9px;
}

/* 与动态刻度字符重叠时隐藏静态刻度 (visibility 保留占位, 避免测量抖动) */
.range-tick.tick-overlap {
  visibility: hidden;
  opacity: 0;
}

/* ── 悬浮底栏 (模型切换 + 加载/保存) ── */

/* 页面底部留白, 防止内容被悬浮底栏遮挡; 水平内边距隔离屏幕边缘 */
.config-page {
  padding: 0 16px 96px;
}

/* 顶部工具栏保持原边缘对齐, 内容区仍缩进 16px */
.config-page > .v-toolbar {
  margin: 0 -16px;
}

.model-select {
  max-width: 320px;
  min-width: 0;
  flex: 1;
}

.model-head {
  min-height: 56px;
}

/* ── 统一按钮风格 ── */

/* 扁平化设计: 禁用按钮阴影 */
:deep(.v-btn) {
  box-shadow: none !important;
}

/* 主要按钮: 实色填充 (激活/开始) */
.btn-primary {
  background-color: rgb(var(--v-theme-primary)) !important;
  color: #1a1a1a !important;
}

/* 次要按钮: 深色底 + 白字 (保存/添加) */
.btn-secondary {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: #fff !important;
}

/* 强调次要按钮: 深色底 + 橙色文字 (从设备加载) */
.btn-accent {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: rgb(var(--v-theme-primary)) !important;
}

/* 危险按钮: 红色实色 (停止传输) */
.btn-danger {
  background-color: rgb(var(--v-theme-error)) !important;
  color: #fff !important;
}

/* 禁用按钮: 深色底 + 浅灰文字 (覆盖 Vuetify 默认 disabled 半透明) */
:deep(.v-btn--disabled),
:deep(.v-btn--disabled .v-btn__overlay) {
  opacity: 1 !important;
}
:deep(.v-btn.btn-primary:disabled),
:deep(.v-btn.btn-secondary:disabled),
:deep(.v-btn.btn-accent:disabled),
:deep(.v-btn.btn-danger:disabled) {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: rgba(255, 255, 255, 0.35) !important;
}
</style>
