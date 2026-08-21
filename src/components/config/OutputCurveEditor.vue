<template>
  <div class="curve-editor">
    <div class="text-caption text-medium-emphasis mb-1">
      控制点（端点固定 (0,0)/(100,100)，可在上方图形中直接拖动；x:0~100, y:0~100）：
    </div>

    <div class="param-group dz-p1">
      <span class="text-caption font-weight-bold">控制点1 X</span>
      <v-slider v-model="curve.x1" :min="0" :max="100" :step="1" density="compact" hide-details thumb-label color="primary"
        @update:model-value="commit" />
      <span class="text-caption param-num">{{ curve.x1 }}</span>
    </div>
    <div class="param-group dz-p1">
      <span class="text-caption font-weight-bold">控制点1 Y</span>
      <v-slider v-model="curve.y1" :min="0" :max="100" :step="1" density="compact" hide-details thumb-label color="primary"
        @update:model-value="commit" />
      <span class="text-caption param-num">{{ curve.y1 }}</span>
    </div>
    <div class="param-group dz-p2">
      <span class="text-caption font-weight-bold">控制点2 X</span>
      <v-slider v-model="curve.x2" :min="0" :max="100" :step="1" density="compact" hide-details thumb-label color="warning"
        @update:model-value="commit" />
      <span class="text-caption param-num">{{ curve.x2 }}</span>
    </div>
    <div class="param-group dz-p2">
      <span class="text-caption font-weight-bold">控制点2 Y</span>
      <v-slider v-model="curve.y2" :min="0" :max="100" :step="1" density="compact" hide-details thumb-label color="warning"
        @update:model-value="commit" />
      <span class="text-caption param-num">{{ curve.y2 }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OutputCurve } from '@/stores/calibration'

const props = defineProps<{ curve: OutputCurve }>()
const emit = defineEmits<{ commit: [curve: OutputCurve] }>()

let t: ReturnType<typeof setTimeout> | null = null
function commit(): void {
  if (t) clearTimeout(t)
  t = setTimeout(() => emit('commit', props.curve), 300)
}
</script>

<style scoped>
.param-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.param-group + .param-group {
  margin-top: 6px;
}
.param-group .text-caption:first-child {
  min-width: 64px;
  flex-shrink: 0;
}
.param-group .v-slider {
  flex: 1;
}
.param-num {
  min-width: 34px;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-primary));
}

/* 气泡样式: 同页 CalWizard dz-slider 风格 (加粗等宽数字 + 白色细边框) */
.dz-p1 :deep(.v-slider-thumb__label) {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-weight: 600;
}
.dz-p1 :deep(.v-slider-thumb__label::before) {
  border-top-color: rgb(var(--v-theme-primary));
}
.dz-p2 :deep(.v-slider-thumb__label) {
  background: rgb(var(--v-theme-warning));
  color: rgb(var(--v-theme-on-warning));
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-weight: 600;
}
.dz-p2 :deep(.v-slider-thumb__label::before) {
  border-top-color: rgb(var(--v-theme-warning));
}
</style>
