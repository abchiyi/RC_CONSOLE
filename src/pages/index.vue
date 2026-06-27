<template>
  <div>
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6">
        <v-icon class="mr-2">mdi-view-dashboard</v-icon>
        通道仪表盘
      </v-toolbar-title>

      <v-spacer />

      <v-chip
        v-if="serial.connected && channelStore.polling"
        color="success"
        label
        size="small"
        variant="tonal"
      >
        <v-icon start size="14">mdi-pulse</v-icon>
        {{ channelStore.lastUpdate ? `${((Date.now() - channelStore.lastUpdate) / 1000).toFixed(1)}s 前` : '监控中' }}
      </v-chip>
    </v-toolbar>
    <ChannelGrid />
  </div>
</template>

<script setup lang="ts">
import { useSerialStore } from '@/stores/serial'
import { useChannelStore } from '@/stores/channels'
import ChannelGrid from '@/components/channel/ChannelGrid.vue'

const serial = useSerialStore()
const channelStore = useChannelStore()
</script>
