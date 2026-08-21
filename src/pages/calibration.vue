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

    <OutputCurvePanel v-if="serial.connected" />
    <CalWizard v-if="serial.connected" />
    <CalStepperGuide v-if="serial.connected" v-model="guideOpen" />

    <!-- 校准按钮: Teleport 到全局底栏左侧槽 (App.vue) -->
    <Teleport to="#global-footer-left">
      <v-btn v-if="serial.connected" color="primary" prepend-icon="mdi-help-circle" size="small"
        variant="tonal" @click="guideOpen = true">
        校准
      </v-btn>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSerialStore } from '@/stores/serial'
import CalWizard from '@/components/calibration/CalWizard.vue'
import CalStepperGuide from '@/components/calibration/CalStepperGuide.vue'
import OutputCurvePanel from '@/components/calibration/OutputCurvePanel.vue'

const serial = useSerialStore()
const guideOpen = ref(false)
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
