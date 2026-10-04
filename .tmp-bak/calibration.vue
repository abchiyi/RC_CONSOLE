<template>
  <div class="sensor-page">
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-chip</v-icon>
        传感器
      </v-toolbar-title>
      <v-spacer />
      <!-- 与通道页一致: 改动先只写设备内存, 显式保存才落 NVS; 未保存时给出提示 -->
      <v-chip v-if="cal.calDirty" color="warning" size="small" variant="tonal">未保存</v-chip>
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

    <!-- 保存到设备: 与通道页同一布局 —— 投递到全局底栏右侧槽, 排在「从设备加载」左侧 -->
    <Teleport to="#global-footer-right">
      <v-btn v-if="serial.connected" class="btn-primary" prepend-icon="mdi-content-save" size="small"
        :loading="saving" :disabled="!cal.calDirty" @click="saveAll">
        <span class="btn-text">保存到设备</span>
      </v-btn>
    </Teleport>

    <!-- 统一提示: 配色由 useNotice 决定 (成功=绿 / 失败=红 / 提醒=橙), tonal 变体不刺眼 -->
    <v-snackbar v-model="saveMsgVisible" :color="saveMsgColor" :timeout="noticeTimeout" variant="tonal">
      {{ saveMsg }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useCalibrationStore } from '@/stores/calibration'
import { useNotice } from '@/composables/useNotice'
import CalWizard from '@/components/calibration/CalWizard.vue'
import CalStepperGuide from '@/components/calibration/CalStepperGuide.vue'
import OutputCurvePanel from '@/components/calibration/OutputCurvePanel.vue'

const serial = useSerialStore()
const cal = useCalibrationStore()

/** 保存到设备 NVS: 一次落下 校准(死区等) + 6 条响应曲线 (+ 通道/全局配置) */
const saving = ref(false)
/** 统一提示: 配色由 type 决定 (成功=绿 / 失败=红 / 提醒=橙 / 其余=蓝) */
const {
  text: saveMsg, color: saveMsgColor, visible: saveMsgVisible, show: notify, timeoutMs: noticeTimeout,
} = useNotice(2500)

async function saveAll(): Promise<void> {
  saving.value = true
  try {
    const r = await cal.saveCal()
    if (r === 'ok') {
      notify('已保存到设备（重启后保留）', 'success')
    } else if (r === 'unacked') {
      // 指令已发出且 save 幂等 → 设备大概率已落盘, 只是确认帧丢了, 不能报"失败"
      notify('保存指令已发送，但未收到设备确认（链路丢包）；请用「从设备加载」核对', 'warning')
    } else {
      notify('保存失败：请确认连接后重试', 'error')
    }
  } finally {
    saving.value = false
  }
}
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

/* ── 底栏「保存到设备」: 与通道页 (.config-page) 同一套按钮风格 ── */
/* 实色主色填充 + 深色字; 扁平化去阴影 (与通道页 :deep(.v-btn) 一致) */
.btn-primary {
  background-color: rgb(var(--v-theme-primary)) !important;
  color: #1a1a1a !important;
  box-shadow: none !important;
}

/* 停用态不要用实色主色, 否则与"可点"混淆 */
.btn-primary.v-btn--disabled {
  background-color: rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.4) !important;
}
</style>
