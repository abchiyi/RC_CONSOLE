<template>
  <v-container fluid>
    <!-- 未连接提示 -->
    <v-alert
      v-if="!serial.connected"
      class="mb-4"
      color="info"
      icon="mdi-information"
      variant="tonal"
    >
      请先点击顶部「连接设备」按钮，选择 ESP32-S3 的 USB 串口
    </v-alert>

    <!-- 连接后显示通道 -->
    <v-row v-if="serial.connected">
      <v-col
        v-for="ch in channelStore.activeChannels"
        :key="ch.index"
        cols="6"
        sm="4"
        md="3"
        lg="2"
      >
        <v-card
          :border="ch.used"
          :color="ch.used ? 'surface-variant' : undefined"
          :variant="ch.used ? 'tonal' : 'outlined'"
          rounded="lg"
        >
          <!-- 通道头部 -->
          <v-card-item density="compact">
            <template #prepend>
              <v-avatar
                :color="ch.used ? channelColor(ch.source) : 'grey-lighten-2'"
                size="28"
              >
                <span class="text-caption font-weight-bold text-white">
                  {{ ch.index }}
                </span>
              </v-avatar>
            </template>
            <v-card-title class="text-body-2">
              {{ ch.label }}
            </v-card-title>
            <template #append>
              <span class="text-caption text-medium-emphasis">
                {{ ch.valueUs }} μs
              </span>
            </template>
          </v-card-item>

          <!-- 通道条形图 -->
          <div class="px-3 pb-2">
            <div class="channel-bar-track">
              <div
                class="channel-bar-fill"
                :style="barStyle(ch.percent)"
              />
              <div class="channel-bar-center" />
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- 轮询开关 -->
    <v-row v-if="serial.connected" class="mt-2">
      <v-col class="d-flex align-center justify-center gap-2">
        <v-switch
          v-model="pollEnabled"
          color="primary"
          density="compact"
          hide-details
          label="实时监控"
          @update:model-value="togglePoll"
        />
        <span class="text-caption text-medium-emphasis">
          更新间隔: 50ms
        </span>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useChannelStore } from '@/stores/channels'

const serial = useSerialStore()
const channelStore = useChannelStore()
const pollEnabled = ref(false)

function togglePoll(on: boolean | null): void {
  if (on) channelStore.startPolling(20)
  else channelStore.stopPolling()
}

function channelColor(source: string): string {
  const map: Record<string, string> = {
    ANALOG_TRIGGER: 'orange-darken-2',
    ANALOG_JOYSTICK_X: 'blue-darken-2',
    ANALOG_JOYSTICK_Y: 'blue-darken-2',
    IMU_ROLL: 'purple-darken-2',
    IMU_PITCH: 'purple-darken-2',
    BUTTON_LOCK: 'red-darken-2',
    BUTTON_MH: 'red-darken-2',
    BUTTON_EC11_BTN: 'red-darken-2',
    BUTTON_SHOT: 'red-darken-2',
    KNOB_EC11: 'teal-darken-2',
  }
  return map[source] ?? 'grey'
}

function barStyle(percent: number): Record<string, string> {
  return {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    left: '0',
    background: 'rgb(var(--v-theme-primary))',
  }
}
</script>

<style scoped>
.channel-bar-track {
  position: relative;
  height: 8px;
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 4px;
  overflow: hidden;
}
.channel-bar-fill {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 4px;
  transition: width 0.15s ease;
}
.channel-bar-center {
  position: absolute;
  left: 50%;
  top: 0;
  width: 2px;
  height: 100%;
  background: rgb(var(--v-theme-on-surface));
  opacity: 0.3;
}
.gap-2 {
  gap: 8px;
}
</style>
