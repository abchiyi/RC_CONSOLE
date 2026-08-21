<template>
  <div class="cal-root">
    <!-- ==================== IMU 姿态 (3D 模型) ==================== -->
    <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
      <v-card-item>
        <template #prepend>
          <v-avatar color="warning" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-axis-arrow</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          IMU 校准
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
        <!-- IMU 姿态: 宽屏左右布局 (视窗 | 读数), 窄屏上下布局 -->
        <div class="imu-layout">
          <!-- 3D 姿态画布: 网格背景 + 手柄模型 (保持 4:3 比例尺, 不随容器拉伸) -->
          <div class="imu-canvas-wrap">
            <div class="imu-canvas-frame">
              <canvas ref="imuCanvas" class="imu-canvas" width="480" height="360" />
            </div>
          </div>

          <!-- 右侧数据面板: 分组卡片 (标题 + 数值格), 等宽字体, 无阴影扁平 -->
          <div class="imu-panel">
            <div class="imu-group">
              <div class="imu-group-title">基础角度</div>
              <div class="stat-grid">
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Roll</div>
                  <div class="mono text-h6 font-weight-bold">{{ fmtDeg(imu.roll) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Pitch</div>
                  <div class="mono text-h6 font-weight-bold">{{ fmtDeg(imu.pitch) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Yaw</div>
                  <div class="mono text-h6 font-weight-bold">{{ fmtDeg(imu.yaw) }}</div>
                </div>
              </div>
            </div>

            <div class="imu-group">
              <div class="imu-group-title">加速度</div>
              <div class="stat-grid">
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">X</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtG(imu.acc?.x) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Y</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtG(imu.acc?.y) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Z</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtG(imu.acc?.z) }}</div>
                </div>
              </div>
            </div>

            <div class="imu-group">
              <div class="imu-group-title">角速度</div>
              <div class="stat-grid">
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">X</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtRate(imu.rate?.x) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Y</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtRate(imu.rate?.y) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Z</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtRate(imu.rate?.z) }}</div>
                </div>
              </div>
            </div>

            <div class="imu-group">
              <div class="imu-group-title">零偏移</div>
              <div class="stat-grid">
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">X</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtBias(imu.gyro_bias_x) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Y</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtBias(imu.gyro_bias_y) }}</div>
                </div>
                <div class="stat-col text-center">
                  <div class="text-caption text-medium-emphasis mb-1">Z</div>
                  <div class="mono text-subtitle-1 font-weight-bold">{{ fmtBias(imu.gyro_bias_z) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <v-divider class="my-3" opacity="0.4" />

        <v-progress-linear v-if="runningType === 'imu'" :model-value="calProgress" color="warning" class="mt-3"
          height="6" rounded />
        <v-alert v-if="lastMessage && lastType === 'imu'" class="mt-3 py-1" density="compact"
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

    <!-- ==================== 扳机校准 ==================== -->
    <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-gamepad-right</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          扳机校准
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

        <v-divider class="my-3" opacity="0.4" />

        <div class="stat-grid">
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

        <v-divider class="my-3" opacity="0.4" />

        <div class="d-flex align-center mb-1">
          <span class="text-caption text-medium-emphasis mr-2">死区</span>
          <v-chip size="x-small" variant="tonal" class="mono">{{ trigger.deadzone }}</v-chip>
        </div>
        <v-slider v-model.number="trigger.deadzone" :min="0" :max="500" :step="1" density="compact" hide-details
          thumb-label :disabled="runningType !== null" @end="debounceDeadzone('trigger')" />

        <v-progress-linear v-if="runningType === 'trigger'" :model-value="calProgress" color="warning" class="mt-3"
          height="6" rounded />
        <v-alert v-if="lastMessage && lastType === 'trigger'" class="mt-3 py-1" density="compact"
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

    <!-- ==================== 摇杆校准 (性能展示) ==================== -->
    <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
      <v-card-item>
        <template #prepend>
          <v-avatar color="success" size="36" class="cal-avatar">
            <v-icon color="white" size="20">mdi-gamepad-variant</v-icon>
          </v-avatar>
        </template>
        <v-card-title>
          摇杆校准
        </v-card-title>
        <v-card-subtitle>摇杆实时位置与行程范围 (校准在弹窗中进行)</v-card-subtitle>
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

        <!-- 死区设置 (X/Y 合并) -->
        <v-divider class="my-3" opacity="0.4" />
        <div class="d-flex align-center mb-1">
          <span class="text-caption text-medium-emphasis mr-2">死区 (X/Y)</span>
          <v-chip size="x-small" variant="tonal" class="mono">{{ joyX.deadzone }}</v-chip>
        </div>
        <v-slider v-model.number="joyX.deadzone" :min="0" :max="500" :step="1" density="compact" hide-details
          thumb-label :disabled="runningType !== null" @end="debounceDeadzone('joy_xy')" />
      </v-card-text>

      <v-card-actions>
        <v-btn block size="large" color="primary" prepend-icon="mdi-play" variant="tonal"
          @click="openCalDialog">开始校准</v-btn>
      </v-card-actions>
    </v-card>

    <!-- ==================== 摇杆校准弹窗 (stepper 向导) ==================== -->
    <v-dialog v-model="calDialog" max-width="560" persistent>
      <v-card rounded="lg" elevation="0">
        <v-card-item>
          <template #prepend>
            <v-avatar color="success" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-gamepad-variant</v-icon>
            </v-avatar>
          </template>
          <v-card-title>摇杆校准向导</v-card-title>
          <v-card-subtitle>按步骤引导完成摇杆校准</v-card-subtitle>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="closeCalDialog" />
          </template>
        </v-card-item>

        <v-card-text>
          <v-stepper v-model="calStep" complete-icon="mdi-check-circle" edit-icon="mdi-cog">
            <v-stepper-header>
              <v-stepper-item v-for="(title, i) in calStepTitles" :key="i" :value="i" :title="title"
                :complete="i < calStep" />
            </v-stepper-header>

            <v-stepper-window>
              <!-- 步骤1: 居中采样 (X/Y 双轴) -->
              <v-stepper-window-item :value="0">
                <v-alert type="info" density="compact" variant="tonal" class="mb-2">
                  请将摇杆<span class="font-weight-bold">保持居中不动</span>，点击"开始采样"，X/Y 两轴同时采样（约 1 秒）。
                </v-alert>

                <template v-for="ax in calAxes" :key="ax.key">
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

                <v-progress-linear v-if="runningType === 'joy_xy'" :model-value="calProgress" color="warning" class="mt-3"
                  height="6" rounded />
                <v-alert v-if="lastMessage && lastType === 'joy_xy'" class="mt-3 py-1" density="compact"
                  :color="runningType === 'joy_xy' ? 'warning' : 'success'" variant="tonal">
                  {{ lastMessage }}
                </v-alert>

                <div class="d-flex justify-space-between mt-3">
                  <v-btn color="grey" variant="text" @click="closeCalDialog">取消</v-btn>
                  <v-btn v-if="runningType !== 'joy_xy'" color="success" prepend-icon="mdi-play" variant="tonal"
                    @click="runCalStep(1)">开始采样</v-btn>
                  <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                </div>
              </v-stepper-window-item>

              <!-- 步骤2: 行程扫描 (X/Y 双轴) -->
              <v-stepper-window-item :value="1">
                <v-alert type="info" density="compact" variant="tonal" class="mb-2">
                  请将摇杆<span class="font-weight-bold">推到行程两端</span>并缓慢画圈，覆盖全部范围（约 4 秒）。
                </v-alert>

                <template v-for="ax in calAxes" :key="ax.key">
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

                <v-progress-linear v-if="runningType === 'joy_xy'" :model-value="calProgress" color="warning" class="mt-3"
                  height="6" rounded />
                <v-alert v-if="lastMessage && lastType === 'joy_xy'" class="mt-3 py-1" density="compact"
                  :color="runningType === 'joy_xy' ? 'warning' : 'success'" variant="tonal">
                  {{ lastMessage }}
                </v-alert>

                <div class="d-flex justify-space-between mt-3">
                  <v-btn color="grey" variant="text" @click="calStep = 0">上一步</v-btn>
                  <v-btn v-if="runningType !== 'joy_xy'" color="success" prepend-icon="mdi-play" variant="tonal"
                    @click="runCalStep(2)">开始采样</v-btn>
                  <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                </div>
              </v-stepper-window-item>

              <!-- 步骤3: 完成 -->
              <v-stepper-window-item :value="2">
                <v-alert type="success" density="compact" variant="tonal" class="mb-2">
                  校准完成！X/Y 两轴结果已保存，死区可在展示卡片中调整。
                </v-alert>

                <template v-for="ax in calAxes" :key="ax.key">
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
                  <v-btn color="primary" prepend-icon="mdi-check-circle" variant="tonal" @click="closeCalDialog">完成</v-btn>
                </div>
              </v-stepper-window-item>
            </v-stepper-window>
          </v-stepper>
        </v-card-text>
      </v-card>
    </v-dialog>

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
            <v-slider v-model.number="lpfAlpha" :min="10" :max="990" :step="10" density="compact" hide-details
              thumb-label @end="sendLpf" />
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
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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

// ---- 摇杆校准向导 (stepper) ----
const calDialog = ref(false)
const calStep = ref(0) // 0=居中采样 1=行程扫描 2=完成
const calStepTitles = ['居中采样', '行程扫描', '完成']

// 双轴量程展示 (reactive 使嵌套的 joyX/joyY ref 自动解包)
const calAxes = reactive([
  { key: 'joy_x', label: 'X 轴', data: joyX, color: 'success', gradient: 'linear-gradient(90deg, rgb(var(--v-theme-success)), #26c6da)' },
  { key: 'joy_y', label: 'Y 轴', data: joyY, color: 'info', gradient: 'linear-gradient(90deg, rgb(var(--v-theme-info)), #29b6f6)' },
])

function openCalDialog(): void {
  calDialog.value = true
  if (calStore.runningType === null) {
    calStep.value = 0
  }
}

function closeCalDialog(): void {
  calDialog.value = false
}

/** 执行双轴分步采样 (step=1 居中, 2=行程扫描) */
async function runCalStep(step: 1 | 2): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCalStep('joy_xy', step)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

// 分步校准完成后自动推进向导
watch(runningType, (nv, ov) => {
  if (ov !== null && nv === null && lastType.value === 'joy_xy' && lastMessage.value !== '已取消') {
    if (calStep.value === 0) calStep.value = 1
    else if (calStep.value === 1) calStep.value = 2
  }
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

// --- IMU 3D 姿态画布 (原生 canvas 2D 手写透视投影) ---
const imuCanvas = ref<HTMLCanvasElement | null>(null)

type Vec3 = [number, number, number]
type Vec2 = { x: number; y: number }

/** 3×3 矩阵乘法 */
function mul3(a: number[][], b: number[][]): number[][] {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j]
      r[i][j] = s
    }
  }
  return r
}

/** 单轴旋转矩阵, 弧度制 */
function rotX(a: number): number[][] {
  const c = Math.cos(a), s = Math.sin(a)
  return [[1, 0, 0], [0, c, -s], [0, s, c]]
}
function rotY(a: number): number[][] {
  const c = Math.cos(a), s = Math.sin(a)
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
}
function rotZ(a: number): number[][] {
  const c = Math.cos(a), s = Math.sin(a)
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
}

/**
 * 设备轴 → 屏幕轴: 固件 Mahony 输出 ZYX 欧拉角 (roll 绕设备 X, pitch 绕设备 Y, yaw 绕设备 Z)
 * roll → 屏幕 Z, pitch → 屏幕 X, yaw → 屏幕 Y
 */
function deviceToScreen(roll: number, pitch: number, yaw: number): number[][] {
  return mul3(mul3(rotY(yaw), rotX(pitch)), rotZ(roll))
}

function apply(R: number[][], v: Vec3): Vec3 {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ]
}

interface Box3 {
  verts: Vec3[]   // 8 顶点
  faces: Vec3[][] // 6 面, 每面 4 顶点(逆时针朝外)
  fill: string
  stroke: string
}

/** 长方体: 中心(cx,cy,cz), 半尺寸(hw,hh,hd) */
function makeBox(cx: number, cy: number, cz: number, hw: number, hh: number, hd: number): Box3 {
  const v = (x: number, y: number, z: number): Vec3 => [x, y, z]
  const verts: Vec3[] = [
    v(cx - hw, cy - hh, cz - hd), v(cx + hw, cy - hh, cz - hd),
    v(cx + hw, cy + hh, cz - hd), v(cx - hw, cy + hh, cz - hd),
    v(cx - hw, cy - hh, cz + hd), v(cx + hw, cy - hh, cz + hd),
    v(cx + hw, cy + hh, cz + hd), v(cx - hw, cy + hh, cz + hd),
  ]
  const faces: Vec3[][] = [
    [4, 5, 6, 7].map(i => verts[i]), // +z 前
    [1, 0, 3, 2].map(i => verts[i]), // -z 后
    [0, 4, 7, 3].map(i => verts[i]), // -x 左
    [5, 1, 2, 6].map(i => verts[i]), // +x 右
    [3, 7, 6, 2].map(i => verts[i]), // +y 上
    [0, 1, 5, 4].map(i => verts[i]), // -y 下
  ]
  return { verts, faces, fill: '', stroke: '' }
}

/** 模型: 简单立方体 (中心在原点, 半边长 1.6) */
const boxes: Box3[] = [
  makeBox(0, 0, 0, 1.6, 1.6, 1.6),
]

/** 面朝向颜色: 面向相机(正面)亮 / 背对相机(背面)暗 */
const FILL_FRONT = 'rgba(255,152,0,0.14)'
const FILL_BACK = 'rgba(255,152,0,0.05)'
const STROKE_FRONT = 'rgba(255,167,38,0.9)'
const STROKE_BACK = 'rgba(255,167,38,0.35)'

/** 三轴指示线: X红 / Y绿 / Z蓝, 长度约 40px */
const AXES: Array<[Vec3, string]> = [
  [[1, 0, 0], '#ff5252'],
  [[0, 1, 0], '#69f0ae'],
  [[0, 0, 1], '#448aff'],
]
const AXIS_LEN = 1.25

function drawScene(): void {
  const canvas = imuCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 固定 480×360 逻辑坐标系: 位图恒定, 模型比例尺不变, 缩放由 CSS 等比完成
  const W = canvas.width
  const H = canvas.height

  // 黑底
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // 浅灰网格 28px
  const g = 28
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
  for (let y = 0; y <= H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
  ctx.stroke()

  // 中央十字 (提亮)
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.beginPath()
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H)
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2)
  ctx.stroke()

  // 姿态 → 旋转矩阵 (模型先绕 Y 轴 180°: 0 位时前方由朝向屏幕外 → 朝向屏幕内)
  const deg = Math.PI / 180
  const roll = (imu.roll ?? 0) * deg
  const pitch = (imu.pitch ?? 0) * deg
  const yaw = (imu.yaw ?? 0) * deg
  const R0: number[][] = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]] // Ry(180°): 0 位时前方朝屏幕内
  const R = mul3(deviceToScreen(roll, pitch, yaw), R0)

  // 透视投影: focal=200, 相机 z=6 (固定坐标系)
  const focal = 200
  const camZ = 6
  const cx = W / 2
  const cy = H / 2
  const proj = (v: Vec3): Vec2 => {
    const r = apply(R, v)
    const s = focal / (camZ - r[2])
    return { x: cx + r[0] * s, y: cy + r[1] * s }
  }

  // 全部面按深度从远到近绘制 (画家算法); 按朝向区分亮/暗边框
  type FaceDraw = { pts: Vec2[]; avgZ: number; fill: string; stroke: string }
  const faces: FaceDraw[] = []
  for (const b of boxes) {
    for (const f of b.faces) {
      // 变换后的面顶点
      const rs = f.map(v => apply(R, v))
      let avgZ = 0
      const pts = rs.map(r => {
        avgZ += r[2]
        const s = focal / (camZ - r[2])
        return { x: cx + r[0] * s, y: cy + r[1] * s }
      })
      // 面法向量 n = (p1-p0) × (p2-p0), 屏幕系
      const u: Vec3 = [rs[1][0] - rs[0][0], rs[1][1] - rs[0][1], rs[1][2] - rs[0][2]]
      const v2: Vec3 = [rs[2][0] - rs[0][0], rs[2][1] - rs[0][1], rs[2][2] - rs[0][2]]
      const nx = u[1] * v2[2] - u[2] * v2[1]
      const ny = u[2] * v2[0] - u[0] * v2[2]
      const nz = u[0] * v2[1] - u[1] * v2[0]
      // 面中心 (顶点均值)
      let mx = 0, my = 0, mz = 0
      for (const r of rs) { mx += r[0]; my += r[1]; mz += r[2] }
      mx /= rs.length; my /= rs.length; mz /= rs.length
      // 面向相机 = 法向量 · (相机位置 - 面中心) > 0
      const facing = nx * (0 - mx) + ny * (0 - my) + nz * (camZ - mz) > 0
      faces.push({
        pts,
        avgZ: avgZ / f.length,
        fill: facing ? FILL_FRONT : FILL_BACK,
        stroke: facing ? STROKE_FRONT : STROKE_BACK,
      })
    }
  }
  faces.sort((a, b) => a.avgZ - b.avgZ) // z 小 = 更远, 先画

  for (const f of faces) {
    ctx.beginPath()
    ctx.moveTo(f.pts[0].x, f.pts[0].y)
    for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y)
    ctx.closePath()
    ctx.fillStyle = f.fill
    ctx.fill()
    ctx.strokeStyle = f.stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // 三轴指示线
  const o = proj([0, 0, 0])
  ctx.lineWidth = 2
  for (const [dir, color] of AXES) {
    const p = proj([dir[0] * AXIS_LEN, dir[1] * AXIS_LEN, dir[2] * AXIS_LEN])
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(o.x, o.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  // 正前方标记: 立方体 +Z 正面中心的白色实心三角箭头 (尖端指向模型前方投影方向, 正对时朝上兜底)
  const f = proj([0, 0, 1.6])
  const c0 = proj([0, 0, 0])
  let dx = f.x - c0.x
  let dy = f.y - c0.y
  const dlen = Math.hypot(dx, dy)
  if (dlen < 1e-3) { dx = 0; dy = -1 } // 前方垂直屏幕(投影退化)时箭头朝上
  else { dx /= dlen; dy /= dlen }
  const size = 11
  const px = -dy, py = dx // 垂直于箭头方向的单位向量
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(f.x + dx * size, f.y + dy * size)                                            // 尖端
  ctx.lineTo(f.x - dx * size * 0.6 + px * size * 0.6, f.y - dy * size * 0.6 + py * size * 0.6)
  ctx.lineTo(f.x - dx * size * 0.6 - px * size * 0.6, f.y - dy * size * 0.6 - py * size * 0.6)
  ctx.closePath()
  ctx.fill()

  // 原点标记
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2)
  ctx.fill()
}

let rafId = 0
function startRender(): void {
  cancelAnimationFrame(rafId)
  const loop = (): void => {
    drawScene()
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
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
function fmtG(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(2) + ' g'
}
function fmtRate(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(1) + ' °/s'
}

// --- 生命周期 ---
onMounted(async () => {
  // 先停通道流，让校准流独占流会话（固件单流会话，后发覆盖先发，避免 ct=0/ct=1 互相覆盖）
  await chStore.stopPolling()
  // 获取初始校准数据
  setTimeout(() => calStore.fetchCalData(), 300)
  // 持续推送实时 raw/IMU 值 (STREAM content_type=1)
  calStore.startCalDataPolling(100)  // 30→100ms，降低串口命令频率，避免 ESP32 栈溢出
  // 3D 姿态渲染循环
  startRender()
})

onUnmounted(async () => {
  cancelAnimationFrame(rafId)
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

/* 状态数值网格: flex + gap 产生真实间距 (不依赖 Vuetify gutter, 避免被 stat-col padding 覆盖) */
.stat-grid {
  display: flex;
  gap: 12px;
}

.stat-grid > .stat-col {
  flex: 1 1 0;
  min-width: 0;
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

/* IMU 姿态布局: 窄屏上下 (视窗在上, 读数在下), 宽屏左右 */
.imu-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.imu-canvas-wrap {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  justify-content: center;
  aspect-ratio: 4 / 3;   /* 窄屏兜底高度, 防止画布塌陷 */
}

/* 裁剪容器: 不锁比例, 宽屏由布局 stretch 决定高度 */
.imu-canvas-frame {
  position: relative;
  width: 100%;
  max-width: 640px;
  height: 100%;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* 画布: 填满父节点, cover 等比显示 + 裁剪, 比例尺恒定不失真 */
.imu-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 右侧数据面板: 简单文字排列 + 等宽字体, 无背景无阴影 */
.imu-panel {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 8px 4px;
}

/* 参数分组卡片: 浅色圆角块, 无阴影扁平 */
.imu-group {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 12px;
}

.imu-group-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 6px;
}

.imu-group .stat-col {
  border: none;
  background: transparent;
}

.imu-group .stat-col .mono {
  font-family: 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

/* 宽屏: 左右布局 */
@media (min-width: 720px) {
  .imu-layout {
    flex-direction: row;
    align-items: stretch;
  }
  .imu-canvas-wrap {
    aspect-ratio: auto;   /* 高度改由布局 stretch 决定, 与右侧面板等高 */
    max-width: 55%;
  }
}

/* 响应式: 窄屏下 2D 与读数值堆叠 */
@media (max-width: 420px) {
  .joy-2d-wrap {
    flex-direction: column;
  }
}
</style>
