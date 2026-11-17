<template>
  <!-- Xbox 摇杆实时位置：底图直接复用传感器页同款 AxisCross2D，仅标注左/右摇杆。 -->
  <div class="stick-cross-wrap">
    <AxisCross2D
      :dot="liveDot"
      :label="`${title} 实时位置`"
    />

    <div class="stick-cross-side">
      <div class="stick-cross-label">{{ title }}</div>

      <div class="stick-cross-raw mono">
        X: {{ liveX ?? '--' }}
      </div>

      <div class="stick-cross-raw mono">
        Y: {{ liveY ?? '--' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'

  const props = defineProps<{
    title: string
    /** 实时轴值（i16）；未开流时传 undefined，点位隐藏 */
    liveX?: number
    liveY?: number
  }>()

  // i16 → SVG 坐标：中心 100，半幅 72（与传感器页 JOY_RADIUS 一致）。
  //   Y 轴画面向下为正，而 XInput 的 Y 上推为正，故取负号。
  const liveDot = computed(() => {
    if (props.liveX === undefined || props.liveY === undefined)
      return undefined
    const clamp = (v: number) => Math.max(-1, Math.min(1, v / 32_767))
    return {
      x: 100 + clamp(props.liveX) * 72,
      y: 100 - clamp(props.liveY) * 72,
    }
  })
</script>

<style scoped>
.stick-cross-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px;
  padding: 10px;
}

.stick-cross-side {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 72px;
}

.stick-cross-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.stick-cross-raw {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
}
</style>
