<template>
  <v-app-bar color="surface" density="compact" elevation="1">
    <v-app-bar-nav-icon icon="mdi-menu" @click="$emit('toggle-drawer')" />

    <v-app-bar-title class="text-h6 font-weight-bold">
      RC Controller
    </v-app-bar-title>

    <v-spacer />

    <!-- 串口选择 + 连接 -->
    <template v-if="!serial.connected">
      <!-- Electron：刷新 + 下拉 + 连接 -->
      <template v-if="serial.isElectron">
        <v-btn
          icon="mdi-refresh"
          size="small"
          variant="text"
          :loading="serial.loadingPorts"
          @click="serial.refreshPorts()"
        />

        <v-select
          v-model="selectedPort"
          :items="serial.availablePorts"
          item-title="path"
          item-value="path"
          label="COM"
          hide-details
          density="compact"
          style="max-width: 160px"
          class="mx-1"
          clearable
          :disabled="serial.availablePorts.length === 0"
        />

        <v-btn
          color="primary"
          prepend-icon="mdi-usb-port"
          size="small"
          :disabled="!selectedPort"
          :loading="serial.connecting"
          variant="flat"
          @click="handleConnect"
        >
          连接
        </v-btn>
      </template>

      <!-- Web：单个按钮，弹出浏览器原生串口选择对话框 -->
      <v-btn
        v-else
        :color="serial.supported ? 'primary' : 'grey'"
        :disabled="!serial.supported"
        :loading="serial.connecting"
        prepend-icon="mdi-usb-port"
        size="small"
        variant="flat"
        @click="serial.connect()"
      >
        连接设备
      </v-btn>

      <!-- 蓝牙连接（Web Bluetooth NUS） -->
      <v-btn
        v-if="serial.bluetoothSupported"
        class="ml-2"
        color="primary"
        prepend-icon="mdi-bluetooth"
        size="small"
        variant="tonal"
        :loading="serial.connecting"
        @click="serial.connectBLE()"
      >
        蓝牙
      </v-btn>
    </template>

    <v-chip
      v-else
      color="success"
      label
      size="small"
      variant="tonal"
    >
      <v-icon start size="16">{{ serial.isBluetooth ? 'mdi-bluetooth' : 'mdi-usb' }}</v-icon>
      {{ serial.isBluetooth ? '蓝牙已连接' : '已连接' }}
    </v-chip>

    <v-btn
      v-if="serial.connected && !serial.isBluetooth"
      class="ml-2"
      color="warning"
      icon="mdi-restart"
      size="small"
      variant="text"
      :loading="resetLoading"
      @click="handleReset"
    />

    <v-btn
      v-if="serial.connected"
      class="ml-2"
      color="error"
      icon="mdi-power-plug-off"
      size="small"
      variant="text"
      @click="serial.disconnect()"
    />
  </v-app-bar>
</template>

<script setup lang="ts">
import { watch, ref, onMounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useChannelStore } from '@/stores/channels'
import { serialService } from '@/services/SerialService'
import { CHANNEL_LINK_ONLY } from '@/utils/debugFlags'

defineEmits<{ 'toggle-drawer': [] }>()

const serial = useSerialStore()
const chStore = useChannelStore()
const selectedPort = ref<string | null>(null)
const resetLoading = ref(false)

// 启动时自动刷新串口列表
onMounted(() => { serial.refreshPorts() })

function handleConnect() {
  if (selectedPort.value) {
    serial.connect(selectedPort.value)
  }
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
  } else {
    chStore.resetPolling()  // 断开清除 started 残留，重连后可再次自动开流
  }
}, { immediate: true })
</script>
