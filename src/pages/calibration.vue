<template>
  <div class="sensor-page">
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-chip</v-icon>
        传感器
      </v-toolbar-title>
    </v-toolbar>

    <!-- 未连接 -->
    <v-alert v-if="!serial.connected" class="ma-3" color="primary" border="start" border-color="primary"
      icon="mdi-information" variant="tonal">
      请先连接设备以查看传感器数据
    </v-alert>

    <CalWizard v-if="serial.connected" />
  </div>
</template>

<script setup lang="ts">
import { useSerialStore } from '@/stores/serial'
import CalWizard from '@/components/calibration/CalWizard.vue'

const serial = useSerialStore()
</script>

<style scoped>
.sensor-page {
  padding: 0 16px 96px;
}

/* 顶部工具栏保持原边缘对齐, 内容区仍缩进 16px */
.sensor-page > .v-toolbar {
  margin: 0 -16px;
}

.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}
</style>
