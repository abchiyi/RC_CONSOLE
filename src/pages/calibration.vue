<template>
  <div>
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6">
        <v-icon class="mr-2">mdi-target</v-icon>
        校准
      </v-toolbar-title>
    </v-toolbar>

    <v-alert
      v-if="!serial.connected"
      class="ma-3"
      color="info"
      icon="mdi-information"
      variant="tonal"
    >
      请先连接设备以进行校准
    </v-alert>

    <CalWizard v-if="serial.connected" />
  </div>
</template>

<script setup lang="ts">
import { useSerialStore } from '@/stores/serial'
import CalWizard from '@/components/calibration/CalWizard.vue'

const serial = useSerialStore()
</script>
