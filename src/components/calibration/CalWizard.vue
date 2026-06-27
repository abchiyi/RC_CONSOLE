<template>
  <v-card class="ma-4" rounded="lg" variant="outlined">
    <v-card-item>
      <template #prepend>
        <v-icon>mdi-target</v-icon>
      </template>
      <v-card-title>传感器校准</v-card-title>
      <v-card-subtitle>按步骤完成扳机、摇杆和 IMU 的校准</v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <!-- 校准类型选择 -->
      <v-select
        v-model="calType"
        :disabled="calRunning"
        :items="calTypes"
        density="compact"
        label="校准类型"
        variant="outlined"
      />

      <!-- 校准状态 -->
      <v-alert
        v-if="calStatus"
        class="mt-4"
        :color="calStatusColor"
        density="compact"
        variant="tonal"
      >
        <template #prepend>
          <v-progress-circular
            v-if="calRunning"
            indeterminate
            size="16"
            width="2"
          />
          <v-icon v-else :icon="calStatusIcon" />
        </template>
        {{ calStatus }}
      </v-alert>

      <!-- ADC 实时值显示 -->
      <v-row v-if="adcValues" class="mt-4">
        <v-col cols="4">
          <div class="text-caption text-medium-emphasis">扳机 raw</div>
          <div class="text-h6 font-weight-bold">{{ adcValues.trigger ?? '--' }}</div>
        </v-col>
        <v-col cols="4">
          <div class="text-caption text-medium-emphasis">摇杆X raw</div>
          <div class="text-h6 font-weight-bold">{{ adcValues.joy_x ?? '--' }}</div>
        </v-col>
        <v-col cols="4">
          <div class="text-caption text-medium-emphasis">摇杆Y raw</div>
          <div class="text-h6 font-weight-bold">{{ adcValues.joy_y ?? '--' }}</div>
        </v-col>
      </v-row>

      <!-- IMU 信息 -->
      <v-row v-if="imuValues" class="mt-2">
        <v-col cols="4">
          <div class="text-caption text-medium-emphasis">Roll</div>
          <div class="text-h6 font-weight-bold">{{ imuValues.roll ?? '--' }}°</div>
        </v-col>
        <v-col cols="4">
          <div class="text-caption text-medium-emphasis">Pitch</div>
          <div class="text-h6 font-weight-bold">{{ imuValues.pitch ?? '--' }}°</div>
        </v-col>
        <v-col cols="4">
          <div class="text-caption text-medium-emphasis">Yaw</div>
          <div class="text-h6 font-weight-bold">{{ imuValues.yaw ?? '--' }}°</div>
        </v-col>
      </v-row>

      <!-- 死区/LPF 设置 -->
      <v-row class="mt-4">
        <v-col cols="6">
          <v-text-field
            v-model.number="deadzone"
            density="compact"
            label="死区"
            type="number"
            variant="outlined"
            @update:model-value="debouncedSetDeadzone"
          />
        </v-col>
        <v-col cols="6">
          <v-text-field
            v-model.number="lpfAlpha"
            density="compact"
            label="低通滤波系数 (10~990)"
            type="number"
            variant="outlined"
            @update:model-value="debouncedSetLpf"
          />
        </v-col>
      </v-row>
    </v-card-text>

    <v-card-actions>
      <v-spacer />
      <v-btn
        v-if="!calRunning"
        color="primary"
        prepend-icon="mdi-play"
        variant="flat"
        @click="startCal"
      >
        开始校准
      </v-btn>
      <v-btn
        v-else
        color="error"
        variant="tonal"
        @click="cancelCal"
      >
        取消
      </v-btn>
      <v-btn
        color="secondary"
        variant="text"
        @click="zeroIMU"
      >
        IMU 归零
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'

const calTypes = [
  { title: '扳机', value: 'trigger' },
  { title: '摇杆 X', value: 'joy_x' },
  { title: '摇杆 Y', value: 'joy_y' },
  { title: 'IMU', value: 'imu' },
]

const calType = ref('trigger')
const calRunning = ref(false)
const calStatus = ref<string | null>(null)
const adcValues = ref<{ trigger?: number; joy_x?: number; joy_y?: number } | null>(null)
const imuValues = ref<{ roll?: number; pitch?: number; yaw?: number } | null>(null)
const deadzone = ref(50)
const lpfAlpha = ref(500)

const calStatusColor = computed(() =>
  calRunning.value ? 'warning' : 'success',
)
const calStatusIcon = computed(() =>
  calRunning.value ? 'mdi-clock-outline' : 'mdi-check-circle',
)

async function startCal(): Promise<void> {
  calRunning.value = true
  calStatus.value = '校准进行中…'
  await serialService.sendCommand('cal_start', { type: calType.value })
  calRunning.value = false
  calStatus.value = '校准完成'

  // 获取校准结果
  setTimeout(async () => {
    await serialService.sendCommand('cal_get')
  }, 200)
}

async function cancelCal(): Promise<void> {
  calRunning.value = false
  calStatus.value = null
}

async function zeroIMU(): Promise<void> {
  await serialService.sendCommand('cal_zero_imu')
  calStatus.value = 'IMU 已归零'
  setTimeout(() => { calStatus.value = null }, 2000)
}

let timer: ReturnType<typeof setTimeout> | null = null
function debouncedSetDeadzone(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    await serialService.sendCommand('cal_set_deadzone', {
      type: calType.value,
      deadzone: deadzone.value,
    })
  }, 300)
}

function debouncedSetLpf(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    await serialService.sendCommand('cal_set_lpf_alpha', {
      alpha: lpfAlpha.value,
    })
  }, 300)
}
</script>
