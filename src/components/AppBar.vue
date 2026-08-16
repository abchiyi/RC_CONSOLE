<template>
  <v-app-bar color="surface" density="compact" elevation="1">
    <v-app-bar-nav-icon @click="$emit('toggle-drawer')" />

    <v-app-bar-title class="text-h6 font-weight-bold">
      RC Controller
    </v-app-bar-title>

    <!-- ELRS 链路统计 -->
    <template v-if="serial.connected">
      <!-- 有效数据 -->
      <template v-if="link.valid">
        <v-chip
          class="mx-1"
          :color="ulLqColor"
          label size="x-small" variant="tonal"
        >
          <v-icon start size="14">mdi-arrow-up-bold</v-icon>
          {{ link.ulRssi }}dBm {{ link.ulLq }}%
        </v-chip>

        <v-chip
          class="mx-1"
          :color="dlLqColor"
          label size="x-small" variant="tonal"
        >
          <v-icon start size="14">mdi-arrow-down-bold</v-icon>
          {{ link.dlRssi }}dBm {{ link.dlLq }}%
        </v-chip>

        <v-chip
          class="mr-2"
          color="primary"
          label size="x-small" variant="tonal"
        >
          <v-icon start size="14">mdi-broadcast</v-icon>
          {{ txPwrLabel }}
        </v-chip>
      </template>

      <!-- 无有效数据：按模块状态分情况提示 -->
      <v-chip
        v-else-if="!link.moduleAlive"
        class="mx-1"
        color="error"
        label size="x-small" variant="tonal"
      >
        <v-icon start size="14">mdi-alert-circle-outline</v-icon>
        ELRS 未响应
      </v-chip>

      <v-chip
        v-else
        class="mx-1"
        color="warning"
        label size="x-small" variant="tonal"
      >
        <v-icon start size="14">mdi-signal-cellular-outline</v-icon>
        接收机未连接
      </v-chip>
    </template>

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
import { computed, watch, ref, onMounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useLinkStatsStore } from '@/stores/linkStats'
import { useChannelStore } from '@/stores/channels'
import { serialService } from '@/services/SerialService'
import { CHANNEL_LINK_ONLY } from '@/utils/debugFlags'

defineEmits<{ 'toggle-drawer': [] }>()

const serial = useSerialStore()
const link   = useLinkStatsStore()
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

// LQ 颜色：>80 绿色，>50 黄色，<=50 红色
const ulLqColor = computed(() => link.ulLq > 80 ? 'success' : link.ulLq > 50 ? 'warning' : 'error')
const dlLqColor = computed(() => link.dlLq > 80 ? 'success' : link.dlLq > 50 ? 'warning' : 'error')

// TX 功率 档位索引 → dBm
const txPwrLabel = computed(() => {
  const v = link.txPower
  if (v <= 0) return '-- dBm'
  if (v <= 7) {
    const map = [10, 14, 17, 20, 24, 27, 30, 33]
    return `${map[v] ?? v} dBm`
  }
  return `${v} dBm`
})

async function handleReset() {
  resetLoading.value = true
  try {
    await serialService.resetDevice()
  } finally {
    resetLoading.value = false
  }
}

// 连接时自动启停轮询
watch(() => serial.connected, (connected) => {
  if (CHANNEL_LINK_ONLY) return  // 调试: 暂停 get_link_stats 轮询
  if (connected) {
    link.startPolling(100)
    chStore.startPolling()
  } else {
    link.stopPolling()
    chStore.resetPolling()  // 断开清除 started 残留，重连后可再次自动开流
  }
}, { immediate: true })
</script>
