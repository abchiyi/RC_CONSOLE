<template>
  <v-app-bar color="surface" density="compact" elevation="1">
    <v-app-bar-nav-icon v-if="serial.connected" icon="mdi-menu" @click="$emit('toggle-drawer')" />

    <v-app-bar-title class="text-h6 font-weight-bold">
      RC Controller
    </v-app-bar-title>

    <v-spacer />

    <!-- 连接入口统一收在「未连接」页, 这里只在已连接时给设备操作 -->
    <template v-if="serial.connected">
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
import { useSerialStore } from '@/stores/serial'
import { useChannelStore } from '@/stores/channels'
import { serialService, bleService } from '@/services/SerialService'
import { CHANNEL_LINK_ONLY } from '@/utils/debugFlags'

defineEmits<{ 'toggle-drawer': [] }>()

const serial = useSerialStore()
const chStore = useChannelStore()
const resetLoading = ref(false)

// 连接后按钮上显示的名称：蓝牙 → 设备名；串口 → COM 口号（无则留空，仅显示"断开连接"）
const connectionName = computed(() => {
  if (serial.isBluetooth) return bleService.deviceName || ''
  return serial.lastPortPath || ''
})

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
  } else {
    chStore.resetPolling()  // 断开清除 started 残留，重连后可再次自动开流
  }
}, { immediate: true })
</script>
