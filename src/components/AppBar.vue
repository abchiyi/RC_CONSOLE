<template>
  <v-app-bar color="surface" density="compact" elevation="1">
    <v-app-bar-nav-icon v-if="serial.connected" icon="mdi-menu" @click="$emit('toggle-drawer')" />

    <v-app-bar-title class="text-h6 font-weight-bold">
      RC Controller
    </v-app-bar-title>

    <v-spacer />

    <!-- 亮/跟随系统/暗: 属于界面偏好而非设备操作, 未连接时同样可用, 故常显 -->
    <ThemeModeToggle class="ml-2" />

    <!-- 连接入口统一收在「未连接」页, 这里只在已连接时给设备操作 -->
    <template v-if="serial.connected">
      <!-- RF 安全门: 校准不齐 → 固件把外部 ELRS 模块的 EN 拉低, 射频完全停发。
           此时模型不会有任何反应, 必须显式告知原因并给出去处, 否则用户只会以为设备故障。 -->
      <v-tooltip v-if="calStore.rfLocked === true" location="bottom">
        <template #activator="{ props }">
          <v-chip
            v-bind="props"
            class="ml-2"
            color="error"
            size="small"
            variant="flat"
            prepend-icon="mdi-wifi-off"
            @click="goCalibrate"
          >
            射频已禁用 · 待校准
          </v-chip>
        </template>
        <span>未完成校准，已硬件关断外部 ELRS 模块的输出以避免误控。待校准：{{ calStore.missingItems.join('、') }}</span>
      </v-tooltip>

      <v-btn
        v-if="!serial.isBluetooth"
        class="ml-2"
        color="warning"
        icon="mdi-restart"
        size="small"
        variant="text"
        :loading="resetLoading"
        @click="handleReset"
      />

      <v-btn
        class="ml-2"
        color="error"
        :prepend-icon="serial.isBluetooth ? 'mdi-bluetooth' : 'mdi-usb'"
        size="small"
        variant="tonal"
        @click="serial.disconnect()"
      >
        断开连接<template v-if="connectionName">（{{ connectionName }}）</template>
      </v-btn>
    </template>
  </v-app-bar>
</template>

<script setup lang="ts">
import { watch, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import ThemeModeToggle from '@/components/ThemeModeToggle.vue'
import { useSerialStore } from '@/stores/serial'
import { useChannelStore } from '@/stores/channels'
import { useCalibrationStore } from '@/stores/calibration'
import { serialService, bleService } from '@/services/SerialService'
import { CHANNEL_LINK_ONLY } from '@/utils/debugFlags'

defineEmits<{ 'toggle-drawer': [] }>()

const serial = useSerialStore()
const chStore = useChannelStore()
const calStore = useCalibrationStore()
const router = useRouter()
const resetLoading = ref(false)

// 连接后按钮上显示的名称：蓝牙 → 设备名；串口 → COM 口号（无则留空，仅显示"断开连接"）
const connectionName = computed(() => {
  if (serial.isBluetooth) return bleService.deviceName || ''
  return serial.lastPortPath || ''
})

/** 顶部状态条 → 进强制校准向导页 (与路由门禁指向同一处) */
function goCalibrate() {
  router.push('/setup')
}

async function handleReset() {
  resetLoading.value = true
  try {
    await serialService.resetDevice()
  } finally {
    resetLoading.value = false
  }
}

// 连接时自动启停通道流（链路统计由 ELRS 页按需切流式链路，全局不再轮询）
watch(() => serial.connected, (connected) => {
  if (CHANNEL_LINK_ONLY) return  // 调试: 仅保留通道流
  if (connected) {
    chStore.startPolling()
    // RF 安全门状态查询: 连上后第一件事 —— 决定顶部是否显示"射频已禁用"
    // (store.reset() 已把结论清成 null, 每次重连都会重新问一次)
    calStore.fetchWorkMode()
  } else {
    chStore.resetPolling()  // 断开清除 started 残留，重连后可再次自动开流
  }
}, { immediate: true })
</script>
