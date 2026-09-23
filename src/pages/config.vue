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
        <!-- 模型级: 输出响应曲线总开关 -->
        <v-sheet v-if="configStore.config" rounded="lg" class="pa-3 mb-3 model-curve-sheet">
          <div class="param-group">
            <span class="text-caption font-weight-bold">
              <v-icon size="16" class="me-1">mdi-tune-variant</v-icon>
              输出响应曲线 (模型级)</span>
            <v-switch v-model="modelCurveEnabled" />
          </div>
          <div class="text-caption text-medium-emphasis mt-1">
            开启后连续量通道输出按「传感器」页对应曲线整形；关闭则原样输出。默认开启。
          </div>
        </v-sheet>

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
                        <!-- 组1: 通道编号 + 当前实时值 -->
                        <div class="chan-id-row">
                          <span class="text-caption font-weight-bold chan-id">{{ channelPrimaryName(idx) }}</span>
                          <span class="text-caption chan-id-sub">{{ channelNumberLabel(idx) }}</span>
                          <span class="text-caption chan-live-value">{{ chanValueUs(idx) }} μs</span>
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
                                  :step="50" density="compact" hide-details thumb-label />
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
                                  :min="1000" :max="2000" :step="50" density="compact" hide-details thumb-label />
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

                        <!-- 按钮通道: 触发配置 (动态添加, 最多 GEAR_COUNT 挡位) -->
                        <v-sheet v-if="isButtonSource(ch.source)" rounded="lg" class="pa-3 mb-3">
                          <div class="text-caption text-medium-emphasis mb-2">
                            多挡触发：挡位 1 为默认值；只有 1 挡时选择触发方式，触发后在输出最小↔最大值间切换（默认输出为通道最小值）；2 挡及以上每条指定触发方式与输出值，同一种触发方式绑定多个挡位时循环切换，最多 {{ GEAR_COUNT }} 挡。
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
                                    :min="ch.output_min ?? 1000" :max="ch.output_max ?? 2000" :step="50" class="param-val"
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
                          <div v-if="btnEntryCount(ch) < GEAR_COUNT" class="mt-2">
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
                            <v-switch v-model="ch.reverse" />
                          </div>
                          <!-- 辅助输入 (EC11 旋钮): 仅模拟类输入 (扳机 / 摇杆 / IMU) -->
                          <template v-if="isAnalogLikeSource(ch.source)">
                            <v-divider class="my-2" />
                            <div class="param-group">
                              <span class="text-caption font-weight-bold">辅助输入</span>
                              <v-select v-model="ch.aux_source" :items="auxSourceOptions" density="compact"
                                hide-details variant="outlined" style="max-width:150px"
                                @update:model-value="(val: string) => onAuxChange(idx, val)" />
                            </div>
                            <div class="text-caption text-medium-emphasis mt-1">
                              EC11 按钮按下：锁定当前输出值并交由旋钮增减微调。扳机/摇杆回中后有输入动作自动退出；IMU
                              需再次点击 EC11 按钮退出（该按钮退出方式对摇杆/IMU 同样有效）。设为辅助后，EC11
                              按钮与旋钮均不可再作为其他通道的输入源。
                            </div>
                          </template>
                          <template v-if="isImuSource(ch.source)">
                            <v-divider class="my-2" />
                            <!-- 宽屏: 范围滑块 -->
                            <div class="detail-slider-wide">
                              <div class="d-flex align-center mb-1">
                                <span class="text-caption font-weight-bold mr-2" style="min-width:90px">输入角度限制</span>
                                <!-- 辅助文本: 实时显示已选角度范围 -->
                                <span class="text-caption text-medium-emphasis">{{ ch.input_min ?? 0 }}° ~ {{ ch.input_max ?? 0 }}°</span>
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
                          <!-- EC11 旋钮步长 (主源为旋钮, 或本通道持有 EC11 辅助输入时均需配置) -->
                          <template v-if="isKnobEc11Source(ch.source) || ch.aux_source === 'KNOB_EC11'">
                            <v-divider class="my-2" />
                            <div class="param-group">
                              <span class="text-caption font-weight-bold">EC11 步长 (µs/格)</span>
                              <span class="param-input-wrap">
                                <v-number-input v-model="ch.ec11_step" :min="1" :max="500" :step="50"
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
                              <v-switch v-model="ch.mix_enabled" />
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
                                  <v-switch v-model="mi.reverse" color="warning" label="反向" />
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
                            <v-switch v-model="ch.condition.enabled" />
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
                                      <v-number-input v-model="ch.condition.value" :min="1000" :max="2000" :step="50"
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

                        <!-- 安全锁: 固件固定监视 CH5 / AUX1 > 1500μs 控制; AUX1 自身作为解锁源, 不提供该开关 -->
                        <v-sheet v-if="idx !== LOCK_CHANNEL_INDEX" rounded="lg" class="pa-3 mb-3"
                          :class="{ 'cond-active': ch.lock_enabled }">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">&#128274;
                              安全锁 ({{ channelDisplayName(LOCK_CHANNEL_INDEX) }} &gt;
                              1500μs 时解锁)</span>
                            <v-switch v-model="ch.lock_enabled" />
                          </div>
                          <v-expand-transition>
                            <div v-if="ch.lock_enabled">
                              <v-divider class="my-2" />
                              <div class="param-group">
                                <span class="text-caption font-weight-bold">锁定输出值 (μs)</span>
                                <span class="param-input-wrap">
                                  <v-number-input v-model="ch.lock_value" :min="1000" :max="2000" :step="50"
                                    controlVariant="stacked" density="compact" hide-details :hideInput="false"
                                    :inset="false" variant="outlined" style="min-width:100px" />
                                </span>
                              </div>
                            </div>
                          </v-expand-transition>
                        </v-sheet>

                        <!-- 锁定后重置输入值 (独立于安全锁; 仅按钮 / EC11 通道, AUX1 自身不渲染) -->
                        <v-sheet v-if="idx !== LOCK_CHANNEL_INDEX && (isButtonSource(ch.source) || isKnobEc11Source(ch.source))"
                          rounded="lg" class="pa-3 mb-3">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">&#8617; 锁定后重置输入值</span>
                            <v-switch v-model="ch.lock_reset_input" density="compact" hide-details />
                          </div>
                          <div class="text-caption text-medium-emphasis mt-1">
                            AUX1 锁定时，将按钮挡位、旋钮设置到默认值。
                          </div>
                        </v-sheet>

                        <!-- 通道触发规则: 本通道输出值进入区间 → 执行一次动作 (蜂鸣器 / LED) -->
                        <v-sheet rounded="lg" class="pa-3 mb-3">
                          <div class="param-group">
                            <span class="text-caption font-weight-bold">&#9889; 触发规则</span>
                            <v-btn class="btn-secondary" size="x-small" rounded="lg" prepend-icon="mdi-plus"
                              :disabled="(ch.triggers?.length ?? 0) >= TRIGGER_COUNT" @click="addTrigger(ch)">
                              添加规则
                            </v-btn>
                          </div>
                          <div class="text-caption text-medium-emphasis mt-1 mb-2">
                            本通道输出值进入设定区间时触发一次动作（离开区间后可再次触发），最多
                            {{ TRIGGER_COUNT }} 条。
                          </div>
                          <template v-for="(tg, ti) in (ch.triggers ?? [])" :key="ti">
                            <v-divider v-if="ti > 0" class="my-2" />
                            <div class="mix-item-card pa-2" style="border-radius:8px">
                              <div class="d-flex align-center ga-2 mb-2">
                                <span class="text-caption font-weight-bold">规则 {{ ti + 1 }}</span>
                                <v-spacer />
                                <v-btn icon="mdi-close" size="x-small" variant="text" color="error"
                                  @click="removeTrigger(ch, ti)" />
                              </div>
                              <div class="d-flex align-center ga-2 mb-2 flex-wrap">
                                <span class="text-caption" style="min-width:52px">功能</span>
                                <v-select v-model="tg.action" :items="triggerActionOptions" density="compact"
                                  hide-details variant="outlined" style="max-width:140px" />
                                <template v-if="tg.action === 'BEEP'">
                                  <span class="text-caption" style="min-width:52px">蜂鸣音</span>
                                  <v-select v-model="tg.param" :items="beepSoundOptions" density="compact"
                                    hide-details variant="outlined" style="max-width:170px" />
                                </template>
                              </div>
                              <div class="cond-range-wrap">
                                <span class="text-caption font-weight-bold">触发范围 (μs): {{ tg.low }} ~
                                  {{ tg.high }}</span>
                                <v-range-slider :model-value="[tg.low, tg.high]"
                                  @update:model-value="(v: number[]) => setTriggerRange(tg, v[0]!, v[1]!)"
                                  :min="1000" :max="2000" :step="50" density="compact" hide-details thumb-label />
                                <div class="range-ticks">
                                  <span v-for="t in tickValues" :key="t" class="range-tick"
                                    :class="{ 'tick-hl': tickHighlight.has(t) }"
                                    :style="{ left: ((t - 1000) / 10) + '%' }">{{ t }}</span>
                                </div>
                              </div>
                            </div>
                          </template>
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

    <!-- 底栏操作按钮: Teleport 到全局底栏右侧槽 (App.vue), 显示由全局容器统一控制 -->
    <Teleport to="#global-footer-right">
      <template v-if="(configStore.modelCount ?? 0) > 1">
        <v-select v-model="selectedSlot" class="model-select me-2" :items="modelOptions" item-title="title"
          item-value="value" density="compact" variant="outlined" hide-details
          @update:model-value="onSlotSelect" />
      </template>
      <v-btn v-if="configStore.config" class="btn-secondary me-2" prepend-icon="mdi-check-circle" size="small"
        :disabled="selectedSlot === configStore.config.active_model" @click="activateModel">
        <span class="btn-text">设为默认</span>
      </v-btn>
      <v-btn v-if="configStore.config" class="btn-primary" prepend-icon="mdi-content-save" size="small"
        :loading="savingModel" @click="saveModel">
        <span class="btn-text">保存到设备</span>
      </v-btn>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import SliderLabel from '@/components/SliderLabel.vue'
import { useSerialStore } from '@/stores/serial'
import { useConfigStore, type ModelChannel, type ButtonEntry, type ChannelTrigger } from '@/stores/config'
import { useChannelStore } from '@/stores/channels'
import { rawToUs, usToRaw } from '@/utils/crsf'
import { GEAR_COUNT } from '@/utils/commands'
import { CHANNEL_LINK_ONLY } from '@/utils/debugFlags'
import {
  channelDisplayName, channelNumberLabel, channelPrimaryName, LOCK_CHANNEL_INDEX,
} from '@/utils/channelName'

const serial = useSerialStore()
const configStore = useConfigStore()
const chStore = useChannelStore()
const selectedSlot = ref(0)

// 当前模型的可编辑通道副本 (存储 μs 值供 UI 编辑)
const editChannels = reactive<ModelChannel[]>([])

// 当前展开的通道行 (null = 无展开)
const expandedIdx = ref<number | null>(null)

// 模型级输出响应曲线总开关 (双向绑定到当前模型的 curve_enabled, 默认开)
const modelCurveEnabled = computed<boolean>({
  get: () => configStore.config?.models?.[selectedSlot.value]?.curve_enabled ?? true,
  set: (v: boolean) => {
    const m = configStore.config?.models?.[selectedSlot.value]
    if (m) m.curve_enabled = v
  },
})

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
  IMU_YAW: 'IMU Yaw',
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
  'IMU_ROLL', 'IMU_PITCH', 'IMU_YAW', 'KNOB_EC11', 'MIX',
])

function isButtonSource(s: string): boolean { return BUTTON_SOURCES.has(s) }
function isContinuousSource(s: string): boolean { return CONTINUOUS_SOURCES.has(s) }

// IMU 类输入源 (中心值固定为 0，无需配置)
const IMU_SOURCES = new Set(['IMU_ROLL', 'IMU_PITCH', 'IMU_YAW'])
function isImuSource(s: string): boolean { return IMU_SOURCES.has(s) }

// EC11 旋钮输入源 (仅能绑定一个通道)
const KNOB_EC11_SOURCES = new Set(['KNOB_EC11'])
function isKnobEc11Source(s: string): boolean { return KNOB_EC11_SOURCES.has(s) }

// 支持条件覆盖的输入源: 模拟输入(摇杆 & IMU & 扳机)
const CONDITION_SOURCES = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'IMU_YAW',
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
  // EC11 旋钮 / 按钮作为主输入源时: 与其他通道的 EC11 辅助占用互斥
  if (newSource === 'KNOB_EC11' || newSource === 'BUTTON_EC11_BTN') {
    for (let i = 0; i < editChannels.length; i++) {
      if (i === idx) continue
      if (newSource === 'KNOB_EC11' && editChannels[i]!.source === 'KNOB_EC11') {
        editChannels[i]!.source = 'NONE'
        snackbarMsg.value = `EC11 已从 ${channelDisplayName(i)} 移动到 ${channelDisplayName(idx)}`
        snackbarVisible.value = true
      }
      // 互斥: EC11 作为本通道输入源时, 其他通道的辅助占用一并取消
      if (editChannels[i]!.aux_source === 'KNOB_EC11') {
        editChannels[i]!.aux_source = 'NONE'
        snackbarMsg.value = `EC11 已作为 ${channelDisplayName(idx)} 的输入源，${channelDisplayName(i)} 的辅助输入已取消`
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

// ── 辅助输入 (EC11 旋钮) ──
const auxSourceOptions = [
  { title: '无', value: 'NONE' },
  { title: 'EC11 旋钮', value: 'KNOB_EC11' },
]

// 可作为辅助输入宿主的模拟类输入源 (扳机 / 摇杆 / IMU)
const ANALOG_LIKE_SOURCES = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'IMU_YAW',
])
function isAnalogLikeSource(s: string): boolean { return ANALOG_LIKE_SOURCES.has(s) }

/** 辅助输入变更: EC11 只能被一个通道持有, 且作为辅助时不可被其他通道设为输入源 */
function onAuxChange(idx: number, newAux: string): void {
  if (newAux !== 'KNOB_EC11') return
  for (let i = 0; i < editChannels.length; i++) {
    if (i === idx) continue
    // 只能被一个通道持有
    if (editChannels[i]!.aux_source === 'KNOB_EC11') {
      editChannels[i]!.aux_source = 'NONE'
      snackbarMsg.value = `EC11 辅助已从 ${channelDisplayName(i)} 移动到 ${channelDisplayName(idx)}`
      snackbarVisible.value = true
    }
    // 互斥: EC11 旋钮 / 按钮都不能再作为其他通道的主输入源
    if (editChannels[i]!.source === 'KNOB_EC11' || editChannels[i]!.source === 'BUTTON_EC11_BTN') {
      editChannels[i]!.source = 'NONE'
      snackbarMsg.value = `EC11 已作为 ${channelDisplayName(idx)} 的辅助输入，${channelDisplayName(i)} 的输入源已取消`
      snackbarVisible.value = true
    }
  }
}

// ── 按钮触发: 动态挡位条目 (gears 数组, 最多 GEAR_COUNT 个) ──

/** 当前已激活的触发挡位条目 (trigger != NONE), 顺序紧凑在前 */
function btnEntries(ch: ModelChannel): ButtonEntry[] {
  return (ch.gears ?? []).filter(e => e && e.trigger !== 'NONE')
}

function btnEntryCount(ch: ModelChannel): number {
  return btnEntries(ch).length
}

/** 添加一个触发挡位 (最多 GEAR_COUNT 个) */
function addBtnEntry(ch: ModelChannel): void {
  if (!ch.gears) ch.gears = []
  const n = btnEntryCount(ch)
  if (n >= GEAR_COUNT) return
  // 填到第一个未启用的槽位 (保证与「已启用条目」顺序一致)
  const slot = ch.gears.findIndex(g => !g || g.trigger === 'NONE')
  ch.gears[slot < 0 ? ch.gears.length : slot] = {
    trigger: 'SINGLE_CLICK',
    value: ch.output_center ?? 1500,
  }
}

// ── 通道触发规则 (本通道输出值进入 [low, high] 时执行一次动作) ──
const TRIGGER_COUNT = 5

const triggerActionOptions = [
  { title: '无', value: 'NONE' },
  { title: '蜂鸣器', value: 'BEEP' },
]

// 蜂鸣音: 对应固件 buzzer_sound 的可选音
const beepSoundOptions = [
  { title: '提示音', value: 0 },
  { title: '警告音 (双连音)', value: 1 },
  { title: '错误音', value: 2 },
  { title: '按键音', value: 3 },
  { title: '通道音 0', value: 4 },
  { title: '通道音 1', value: 5 },
  { title: '通道音 2', value: 6 },
]

/** 添加一条触发规则 (最多 TRIGGER_COUNT 条) */
function addTrigger(ch: ModelChannel): void {
  if (!ch.triggers) ch.triggers = []
  if (ch.triggers.length >= TRIGGER_COUNT) return
  ch.triggers.push({ low: 1000, high: 1250, action: 'BEEP', param: 0, enabled: true })
}

/**
 * 设置触发范围: 步长 50 对齐 + 钳制到 [1000, 2000]。
 * 约束: 最大值与最小值必须间隔 >= 50 (优先上推 high, 越界则下压 low)。
 */
function setTriggerRange(tg: ChannelTrigger, low: number, high: number): void {
  let lo = Math.round(low / 50) * 50
  let hi = Math.round(high / 50) * 50
  lo = Math.min(Math.max(lo, 1000), 2000)
  hi = Math.min(Math.max(hi, 1000), 2000)
  if (hi - lo < 50) {
    if (hi + 50 <= 2000) hi = lo + 50
    else lo = hi - 50
  }
  tg.low = lo
  tg.high = hi
}

/** 删除第 idx 条触发规则 */
function removeTrigger(ch: ModelChannel, idx: number): void {
  ch.triggers?.splice(idx, 1)
}

/** 删除第 idx 个触发挡位, 后续挡位紧凑前移 */
function removeBtnEntry(ch: ModelChannel, idx: number): void {
  if (!ch.gears) ch.gears = []
  const entries = btnEntries(ch)
  entries.splice(idx, 1)
  for (let i = 0; i < GEAR_COUNT; i++) {
    ch.gears![i] = entries[i] ?? { trigger: 'NONE', value: ch.output_center ?? 1500 }
  }
}

/** 按钮通道输出范围变更 → clamp 越界的挡位值 */
function onBtnOutputRangeChange(idx: number, vals: number[]): void {
  const ch = editChannels[idx]!
  const lo = vals[0] ?? 1000
  const hi = vals[1] ?? 2000
  ch.output_min = lo
  ch.output_max = hi
  for (const g of ch.gears ?? []) {
    const v = g.value ?? 1500
    g.value = v < lo ? lo : v > hi ? hi : v
  }
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

// 下拉显示顺序 (与固件枚举 ID 无关, 仅影响展示):
// 按钮类 → 模拟类 (扳机/摇杆) → IMU 三轴相邻 → EC11 旋钮 → 混合输入
const SOURCE_DISPLAY_ORDER = [
  'NONE',
  'BUTTON_LOCK', 'BUTTON_MH', 'BUTTON_EC11_BTN', 'BUTTON_SHOT',
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'IMU_YAW',
  'KNOB_EC11', 'MIX',
]

/** 未列入顺序表的源排到最后 (稳定排序, 保持固件下发原序) */
function sourceDisplayIndex(id: string): number {
  const i = SOURCE_DISPLAY_ORDER.indexOf(id)
  return i < 0 ? SOURCE_DISPLAY_ORDER.length : i
}

// MIX 可选的连续量输入源 (排除按钮、EC11 旋钮、MIX 自身)
const mixSourceOptions = computed(() =>
  [...(configStore.deviceInfo?.input_sources ?? [])]
    .filter(s => s.id !== 'NONE' && !BUTTON_SOURCES.has(s.id)
      && s.id !== 'KNOB_EC11' && s.id !== 'MIX')
    .sort((a, b) => sourceDisplayIndex(a.id) - sourceDisplayIndex(b.id))
    .map(s => ({ title: SOURCE_LABELS[s.id] ?? s.id, value: s.id })),
)

// 输入源下拉选项 (按 SOURCE_DISPLAY_ORDER 排序: IMU Roll/Pitch/Yaw 相邻)
const sourceOptions = computed(() =>
  [...(configStore.deviceInfo?.input_sources ?? [])]
    .sort((a, b) => sourceDisplayIndex(a.id) - sourceDisplayIndex(b.id))
    .map(s => ({ title: SOURCE_LABELS[s.id] ?? s.id, value: s.id })),
)

// 条件覆盖: 替代输入源选项 (仅模拟类: 摇杆 & 扳机 & IMU & EC11 旋钮)
const ALT_SOURCE_ALLOWED = new Set([
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'IMU_YAW', 'KNOB_EC11',
])
const altSourceOptions = computed(() =>
  sourceOptions.value.filter(o => ALT_SOURCE_ALLOWED.has(o.value)),
)

/** 当前通道实时输出值 (μs), 无数据时显示 '--' */
function chanValueUs(idx: number): string {
  const c = chStore.activeChannels[idx]
  return c ? String(c.valueUs) : '--'
}

// 条件: 监视通道下拉 (显示 CH1~CH16 + 主名称, value 仍为 0 起始内部索引)
const sourceChannelOptions = computed(() =>
  Array.from({ length: 16 }, (_, i) => ({ title: channelDisplayName(i), value: i })),
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
  void geoVersion.value // 依赖几何缓存版本号: 布局重测后触发重算
  const m = boxMetrics.get(idx)
  if (!m) return null
  const c0 = m.thumbCenterRel // 左拨杆中心 = output_min 位置
  return {
    left: c0 - m.thumbR, // 左端向左扩展一个半径, 覆盖左拨杆圆弧
    width: Math.max(0, (m.trackRightRel - c0) * (live.fillPct / 100) + m.thumbR * 2),
  }
}

// 返回数组供 v-for 使用: 测量失败时返回空数组 → 不渲染
function chanLivePxList(idx: number): { left: number; width: number }[] {
  const px = chanLivePx(idx)
  return px ? [px] : []
}

// 滑块容器引用 + 窗口尺寸变化 → 用于测量通道条
const sliderBoxRefs = new Map<number, HTMLElement>()
function setSliderBoxRef(idx: number, el: unknown): void {
  if (el) sliderBoxRefs.set(idx, el as HTMLElement)
  else sliderBoxRefs.delete(idx)
}
// ── 滑块轨道几何缓存 ──
// 这些量只依赖 DOM 布局(拨杆位置/轨道位置), 与通道实时值无关。
// 原先在渲染期逐帧调用 getBoundingClientRect() 会强制同步布局 (20fps × 16 通道),
// 改为缓存 + 布局变化时集中重测一次。
interface BoxMetrics {
  thumbCenterRel: number  // 左拨杆中心 相对 slider-box 左边缘 (px)
  trackLeftRel: number    // 轨道左端   相对 slider-box 左边缘 (px)
  trackRightRel: number   // 轨道右端   相对 slider-box 左边缘 (px)
  trackWidthRel: number   // 轨道宽度 (px)
  thumbR: number          // 拨杆半径 (px)
}
const boxMetrics = new Map<number, BoxMetrics>()
const geoVersion = ref(0)

function measureSliderGeometry(): void {
  const next = new Map<number, BoxMetrics>()
  sliderBoxRefs.forEach((box, idx) => {
    const thumbs = box.querySelectorAll<HTMLElement>('.v-slider-thumb')
    const track = box.querySelector<HTMLElement>('.v-slider-track')
    if (thumbs.length < 2 || !track) return  // 尚未渲染完成
    const boxRect = box.getBoundingClientRect()
    const r0 = thumbs[0]!.getBoundingClientRect()
    const tr = track.getBoundingClientRect()
    if (!r0.width || !tr.width) return
    next.set(idx, {
      thumbCenterRel: r0.left + r0.width / 2 - boxRect.left,
      trackLeftRel: tr.left - boxRect.left,
      trackRightRel: tr.right - boxRect.left,
      trackWidthRel: tr.width,
      thumbR: r0.width / 2,
    })
  })
  boxMetrics.clear()
  next.forEach((v, k) => boxMetrics.set(k, v))
  geoVersion.value++
}

function onWindowResize(): void {
  nextTick(() => {
    measureTickOverlap()
    measureSliderGeometry()
  })
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
  void geoVersion.value // 依赖几何缓存版本号
  const m = boxMetrics.get(idx)
  const ch = editChannels[idx]
  if (!m || !ch) return 0
  const v = Math.min(Math.max(ch.output_center ?? 1500, 1000), 2000)
  return m.trackLeftRel + ((v - 1000) / 1000) * m.trackWidthRel
}
// 中心值步长: 与输出范围滑块 :step="50" 对齐, 拖动时吸附到 50 的整数倍
const CENTER_STEP = 50
function centerValueFromClientX(idx: number, clientX: number): number {
  const track = sliderBoxRefs.get(idx)?.querySelector<HTMLElement>('.v-slider-track')
  if (!track) return 1500
  const r = track.getBoundingClientRect()
  const v = Math.round((1000 + ((clientX - r.left) / r.width) * 1000) / CENTER_STEP) * CENTER_STEP
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
        gears: Array.from({ length: GEAR_COUNT }, (_, g) => ({
          trigger: ch.gears?.[g]?.trigger ?? 'NONE',
          value: rawToUs(ch.gears?.[g]?.value ?? 186),
        })),
        input_min: ch.input_min,
        input_center: ch.input_center,
        input_max: ch.input_max,
        output_min: rawToUs(ch.output_min),
        output_max: rawToUs(ch.output_max),
        output_center: rawToUs(ch.output_center),
        deadzone: ch.deadzone,
        // 步进以 µs/格 直传: 固件按量程比例换算到 raw 再取整, 避免取整偏差累积
        ec11_step: flat.ec11_step ?? 50,
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
        lock_reset_input: flat.lock_reset_input === undefined ? false : !!flat.lock_reset_input,
        aux_source: flat.aux_source ?? 'NONE',
        mix_enabled: !!flat.mix_enabled,
        mix_items: Array.isArray(flat.mix_items) ? flat.mix_items.map((mi: any) => ({
          src: mi.src ?? 'NONE',
          w: mi.w ?? 0,
          reverse: !!mi.reverse,
        })) : [],
        triggers: Array.isArray(flat.triggers) ? flat.triggers.slice(0, TRIGGER_COUNT).map((t: any) => ({
          low: rawToUs(t.low ?? 186),
          high: rawToUs(t.high ?? 1796),
          action: t.action ?? 'NONE',
          param: t.param ?? 0,
          enabled: t.enabled === undefined ? true : !!t.enabled,
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

/** 全局底栏「从设备加载」: 复用本页加载逻辑, 完成后回报 App 关闭全局按钮 loading */
async function onGlobalReload() {
  try {
    await loadFromDevice()
  } finally {
    window.dispatchEvent(new CustomEvent('app:reload-done'))
  }
}

async function saveCurrentModel(): Promise<boolean> {
  const model = configStore.config?.models?.[selectedSlot.value]
  const name = model?.name || ''
  const curveEnabled = !!model?.curve_enabled
  // 将 μs 转回 CRSF raw 再发送到固件
  // 条件字段需扁平化并映射到固件缩写的 JSON key
  const rawChannels = editChannels.map((ch, idx) => {
    const { condition, gears, ...rest } = ch
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
      gears: Array.from({ length: GEAR_COUNT }, (_, g) => ({
        trigger: gears?.[g]?.trigger ?? 'NONE',
        value: usToRaw(gears?.[g]?.value ?? 1500),
      })),
      cond_enabled: condition.enabled,
      cond_src: condition.source_channel,
      cond_low: condRaw.low,
      cond_high: condRaw.high,
      cond_switch: condition.switch_source,
      cond_val: condRaw.value,
      cond_alt: condition.alt_source,
      // AUX1 是解锁控制源: 强制关闭自身安全锁, 避免自锁抖动 (历史配置也会被纠正)
      lock_enabled: idx === LOCK_CHANNEL_INDEX ? false : ch.lock_enabled,
      lock_value: usToRaw(ch.lock_value),
      lock_reset_input: idx === LOCK_CHANNEL_INDEX ? false : !!ch.lock_reset_input,
      aux_source: ch.aux_source ?? 'NONE',
      // 步进以 µs/格 直传 (固件内部按 1.61 raw/µs 换算后取整)
      ec11_step: ch.ec11_step ?? 50,
      mix_enabled: ch.mix_enabled,
      mix_items: ch.mix_items?.map(mi => ({ src: mi.src, w: mi.w, reverse: mi.reverse })) ?? [],
      // 触发规则区间 μs → raw (固件判定用 CRSF raw 域)
      triggers: ch.triggers?.slice(0, TRIGGER_COUNT).map(t => ({
        low: usToRaw(t.low),
        high: usToRaw(t.high),
        action: t.action ?? 'NONE',
        param: t.param ?? 0,
        enabled: t.enabled !== false,
      })) ?? [],
    }
  })
  return await configStore.setModel(selectedSlot.value, {
    name,
    channels: rawChannels,
    curve_enabled: curveEnabled,
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
  window.addEventListener('app:reload-from-device', onGlobalReload)
  if (serial.connected && !chStore.polling) chStore.startPolling()
  if (CHANNEL_LINK_ONLY) return  // 调试: 仅保留通道监视, 暂停自动加载
  enterPage()
  // 初次渲染完成后测量刻度重叠与滑块几何 (字体就绪后再测一次)
  nextTick(() => {
    measureTickOverlap()
    measureSliderGeometry()
  })
  document.fonts?.ready.then(() => {
    measureTickOverlap()
    measureSliderGeometry()
  })
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

// 影响滑块布局的因子 (输入源分支切换 / 端点 → 拨杆位置 / 展开态 → DOM 挂载) → 重测几何
watch(
  () => editChannels.map((c) =>
    `${c?.source}|${c?.output_min}|${c?.output_max}|${c?.output_center}`).join(';')
    + `#${expandedIdx.value}`,
  () => nextTick(measureSliderGeometry),
)

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('app:reload-from-device', onGlobalReload)
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

/* 副名称: 1 起始通道号, 弱化显示跟在主名称之后 */
.chan-id-sub {
  opacity: .55;
  font-size: 10px;
  letter-spacing: .3px;
}

/* 当前通道实时输出值 (μs): 等宽数字, 主题色, 靠右 */
.chan-live-value {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
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
  background: rgba(var(--v-theme-primary), 0.3);
  border: 1px solid rgba(var(--v-theme-primary), 0.45);
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

/* switch 配色已统一到 src/styles/switches.css (全局) */

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

/* 禁用按钮: 深色底 + 浅灰文字 (覆盖 Vuetify 默认 disabled 半透明)
   只匹配页面自定义实色按钮: 若用 .v-btn--disabled 全匹配会透传到 Vuetify 内部按钮
   (v-number-input 的 ± / 工具栏图标按钮), 使 overlay 被强制全不透明 —— 既会出现
   灰底块, 又在禁用↔可用切换时先渲染一帧高亮再淡出(闪烁)。内部按钮保持官方禁用态 */
:deep(.v-btn.btn-primary:disabled),
:deep(.v-btn.btn-secondary:disabled),
:deep(.v-btn.btn-accent:disabled),
:deep(.v-btn.btn-danger:disabled) {
  opacity: 1 !important;
}
:deep(.v-btn.btn-primary:disabled .v-btn__overlay),
:deep(.v-btn.btn-secondary:disabled .v-btn__overlay),
:deep(.v-btn.btn-accent:disabled .v-btn__overlay),
:deep(.v-btn.btn-danger:disabled .v-btn__overlay) {
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
