<template>
  <!-- 通用二维轴实时位置十字图：只画底图 + 位置点，不绑定任何业务数据。
       传感器页与 Xbox 手柄输出页共用；纯 SVG，颜色全部走 Vuetify 主题通道，亮暗自适应。 -->
  <svg
    :aria-label="label"
    class="axis-cross-2d"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :viewBox="`0 0 ${size} ${size}`"
  >
    <rect
      class="cross-bg"
      :height="size - 2"
      rx="12"
      :width="size - 2"
      x="1"
      y="1"
    />

    <!-- 十字轴线 -->
    <line
      class="cross-line"
      :x1="size / 2"
      :x2="size / 2"
      y1="8"
      :y2="size - 8"
    />

    <line
      class="cross-line"
      x1="8"
      :x2="size - 8"
      :y1="size / 2"
      :y2="size / 2"
    />

    <!-- 虚线边界框 -->
    <rect
      class="cross-bound"
      :height="size - 16"
      rx="8"
      :width="size - 16"
      x="8"
      y="8"
    />

    <!-- 中心死区圆环（半径由调用方按各自量程换算） -->
    <circle
      v-if="deadzoneRadius > 0"
      class="cross-deadzone"
      :cx="size / 2"
      :cy="size / 2"
      :r="deadzoneRadius"
    />

    <!-- 实时位置点 -->
    <g v-if="dot">
      <line
        v-if="trace"
        class="cross-trace"
        :x1="size / 2"
        :x2="dot.x"
        :y1="size / 2"
        :y2="dot.y"
      />

      <circle
        v-if="halo"
        class="cross-halo"
        :cx="dot.x"
        :cy="dot.y"
        :r="dotRadius + 5"
      />

      <circle
        class="cross-dot"
        :cx="dot.x"
        :cy="dot.y"
        :r="dotRadius"
      />
    </g>
  </svg>
</template>

<script setup lang="ts">
  withDefaults(defineProps<{
    /** viewBox 边长，默认 200（与传感器页既有 2D 图一致） */
    size?: number
    /** 实时点坐标（SVG 坐标系），undefined 时隐藏点位 */
    dot?: { x: number, y: number }
    /** 中心死区环半径，0 不显示 */
    deadzoneRadius?: number
    /** 实时点半径 */
    dotRadius?: number
    /** 是否画中心→实时点的虚线 */
    trace?: boolean
    /** 是否画实时点外晕 */
    halo?: boolean
    /** 无障碍描述 */
    label?: string
  }>(), {
    size: 200,
    dot: undefined,
    deadzoneRadius: 0,
    dotRadius: 3,
    trace: false,
    halo: false,
    label: '二维轴实时位置',
  })
</script>

<style scoped>
.axis-cross-2d {
  width: 100%;
  max-width: 240px;
  height: auto;
  display: block;
}

.cross-bg {
  fill: rgba(var(--v-theme-on-surface), 0.04);
  stroke: rgba(var(--v-theme-on-surface), 0.1);
}

.cross-line {
  stroke: rgba(var(--v-theme-on-surface), 0.18);
  stroke-width: 1;
}

.cross-bound {
  fill: none;
  stroke: rgba(var(--v-theme-on-surface), 0.14);
  stroke-dasharray: 4 4;
}

.cross-deadzone {
  fill: none;
  stroke: rgb(var(--v-theme-warning));
  stroke-width: 1.5;
  opacity: 0.9;
}

.cross-dot {
  fill: rgb(var(--v-theme-on-surface));
}

.cross-trace {
  stroke: rgb(var(--v-theme-secondary));
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
  opacity: 0.8;
}

.cross-halo {
  fill: rgba(var(--v-theme-secondary), 0.22);
  stroke: rgba(var(--v-theme-secondary), 0.6);
  stroke-width: 1;
}
</style>
