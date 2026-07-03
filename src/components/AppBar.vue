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
          {{ link.txPower }}dBm
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

    <!-- 串口连接按钮 -->
    <v-btn
      v-if="!serial.connected"
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

    <v-chip
      v-else
      color="success"
      label
      size="small"
      variant="tonal"
    >
      <v-icon start size="16">mdi-usb</v-icon>
      已连接
    </v-chip>

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
import { computed, watch } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useLinkStatsStore } from '@/stores/linkStats'

defineEmits<{ 'toggle-drawer': [] }>()

const serial = useSerialStore()
const link   = useLinkStatsStore()

// LQ 颜色：>80 绿色，>50 黄色，<=50 红色
const ulLqColor = computed(() => link.ulLq > 80 ? 'success' : link.ulLq > 50 ? 'warning' : 'error')
const dlLqColor = computed(() => link.dlLq > 80 ? 'success' : link.dlLq > 50 ? 'warning' : 'error')

// 连接时自动启停轮询
watch(() => serial.connected, (connected) => {
  if (connected) link.startPolling(100)
  else link.stopPolling()
}, { immediate: true })
</script>
