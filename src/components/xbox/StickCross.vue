<template>
  <!-- Xbox 摇杆映射十字示意图：静态展示 X/Y 两轴各自的输入源、正负方向与翻转。
       坐标与图元颜色全部沿用 CalWizard.vue 的 .joy-2d-* 主题派生规则，亮暗自适应。 -->
  <div class="stick-cross-wrap">
    <svg
      :aria-label="`${title} X 轴 ${xLabel}，Y 轴 ${yLabel}`"
      class="stick-cross"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox="0 0 200 200"
    >
      <rect
        class="cross-bg"
        height="198"
        rx="12"
        width="198"
        x="1"
        y="1"
      />

      <!-- 十字轴线 + 边界框 -->
      <line
        class="cross-line"
        x1="100"
        x2="100"
        y1="8"
        y2="192"
      />

      <line
        class="cross-line"
        x1="8"
        x2="192"
        y1="100"
        y2="100"
      />

      <rect
        class="cross-bound"
        height="184"
        rx="8"
        width="184"
        x="8"
        y="8"
      />

      <!-- 四端方向箭头（源映射到该方向；翻转时箭头方向不变、标注互换） -->
      <g class="cross-arrows">
        <path d="M100 18 L96 26 L104 26 Z" />
        <path d="M100 182 L96 174 L104 174 Z" />
        <path d="M18 100 L26 96 L26 104 Z" />
        <path d="M182 100 L174 96 L174 104 Z" />
      </g>

      <!-- 中心点 -->
      <circle class="cross-dot" cx="100" cy="100" r="3.5" />
      <circle class="cross-hub" cx="100" cy="100" r="9" />

      <!-- 四端标签：上=Y+ 下=Y− 左=X− 右=X+；翻转时 +/− 互换 -->
      <g class="cross-labels">
        <text class="cross-label-y" text-anchor="middle" x="100" y="36">
          {{ yPositive }} · {{ yLabel }}
        </text>

        <text class="cross-label-y" text-anchor="middle" x="100" y="172">
          {{ yNegative }} · {{ yLabel }}
        </text>

        <text class="cross-label-x" text-anchor="start" x="10" y="94">
          {{ xNegative }} · {{ xLabel }}
        </text>

        <text class="cross-label-x" text-anchor="end" x="190" y="94">
          {{ xPositive }} · {{ xLabel }}
        </text>
      </g>

      <!-- 角落标注：翻转状态 -->
      <g v-if="xInvert || yInvert" class="cross-invert">
        <text x="12" y="190">{{ invertText }}</text>
      </g>
    </svg>

    <div class="cross-caption">
      <div class="text-caption font-weight-bold">{{ title }}</div>

      <div class="text-caption text-medium-emphasis">
        X: {{ xLabel }}<span v-if="xRange">（{{ xRange }}°）</span>
      </div>

      <div class="text-caption text-medium-emphasis">
        Y: {{ yLabel }}<span v-if="yRange">（{{ yRange }}°）</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'

  const props = defineProps<{
    title: string
    xLabel: string
    yLabel: string
    xInvert: boolean
    yInvert: boolean
    /** IMU 源的角度量程（0 表示非姿态源，不显示） */
    xRange?: number
    yRange?: number
  }>()

  // 翻转后，物理源的「正」落到摇杆的负方向，故标注互换
  const xPositive = computed(() => props.xInvert ? '−' : '+')
  const xNegative = computed(() => props.xInvert ? '+' : '−')
  const yPositive = computed(() => props.yInvert ? '−' : '+')
  const yNegative = computed(() => props.yInvert ? '+' : '−')

  const invertText = computed(() => {
    const parts: string[] = []
    if (props.xInvert) parts.push('X')
    if (props.yInvert) parts.push('Y')
    return `${parts.join(' / ')} 已翻转`
  })
</script>

<style scoped>
.stick-cross-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px;
  padding: 10px;
}

.stick-cross {
  width: 100%;
  max-width: 210px;
  height: auto;
  display: block;
}

.cross-bg {
  fill: rgba(var(--v-theme-on-surface), 0.04);
  stroke: rgba(var(--v-theme-on-surface), 0.1);
}

.cross-line {
  stroke: rgba(var(--v-theme-on-surface), 0.28);
  stroke-width: 1;
}

.cross-bound {
  fill: none;
  stroke: rgba(var(--v-theme-on-surface), 0.14);
  stroke-dasharray: 4 4;
}

.cross-arrows path {
  fill: rgba(var(--v-theme-primary), 0.75);
}

.cross-dot {
  fill: rgb(var(--v-theme-primary));
}

.cross-hub {
  fill: none;
  stroke: rgba(var(--v-theme-primary), 0.45);
  stroke-width: 1;
}

.cross-labels text {
  font-size: 8px;
}

.cross-label-x,
.cross-label-y {
  fill: rgba(var(--v-theme-on-surface), 0.72);
}

.cross-invert text {
  font-size: 8px;
  fill: rgb(var(--v-theme-warning));
}

.cross-caption {
  min-width: 96px;
  flex: 1 1 96px;
}

@media (max-width: 520px) {
  .stick-cross-wrap {
    flex-direction: column;
  }

  .cross-caption {
    text-align: center;
  }
}
</style>
