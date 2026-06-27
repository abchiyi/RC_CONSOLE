<template>
  <v-app-bar color="surface" density="compact" elevation="1">
    <v-app-bar-nav-icon @click="$emit('toggle-drawer')" />

    <v-app-bar-title class="text-h6 font-weight-bold">
      RC Controller
    </v-app-bar-title>

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
import { useSerialStore } from '@/stores/serial'

defineEmits<{ 'toggle-drawer': [] }>()

const serial = useSerialStore()
</script>
