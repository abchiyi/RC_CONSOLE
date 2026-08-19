<template>
  <div class="slider-thumb-label-container">
    <div class="slider-thumb-label">
      <div class="slider-thumb-label-wedge"></div>
      <slot>
        <span>{{ value }}</span>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ value?: string | number }>()
</script>

<style scoped>
/* 与 Vuetify v-slider-thumb__label 结构/尺寸一致: 35x25 圆角气泡 + 8x8 三角箭头 */
.slider-thumb-label-container {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  margin-bottom: 6px;
  pointer-events: none;
}
.slider-thumb-label {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  min-width: 35px;
  height: 25px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  color: rgb(var(--v-theme-on-primary));
  background: rgb(var(--v-theme-primary));
}
.slider-thumb-label-wedge {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 8px;
  background: inherit;
  clip-path: polygon(50% 100%, 0 50%, 100% 50%);
}
</style>
