<template>
  <v-dialog :model-value="modelValue" max-width="640" persistent @update:model-value="onUpdateModelValue">
    <v-card>
      <v-card-title class="d-flex align-center text-body-1">
        <v-icon class="mr-2" color="warning">mdi-tools</v-icon>
        固件烧录（首次烧录）
        <v-spacer />
        <v-chip v-if="flashing" color="warning" size="x-small" variant="tonal">烧录中</v-chip>
        <v-chip v-else-if="connected" color="success" size="x-small" variant="tonal">已连接</v-chip>
        <v-chip v-else color="grey" size="x-small" variant="tonal">未连接</v-chip>
      </v-card-title>

      <v-card-text>
        <v-alert color="warning" variant="tonal" density="compact" class="mb-3">
          将固件整体写入设备存储。仅适用于首次烧录（空片 / 尚无固件的设备）。
        </v-alert>

        <!-- 高级选项：芯片型号 / 闪存参数 / 波特率等 -->
        <v-expansion-panels variant="accordion" class="mb-3 adv-panels">
          <v-expansion-panel>
            <v-expansion-panel-title>
              <v-icon class="mr-2" size="18">mdi-tune-variant</v-icon>
              <span class="text-body-2">高级选项</span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-row dense>
                <v-col cols="12" sm="6">
                  <v-select v-model="cfgChipName" :items="chipNameItems" item-title="title" item-value="value"
                    label="芯片型号" density="compact" variant="outlined" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="cfgFlashSize" :items="flashSizeItems" label="闪存大小" density="compact"
                    variant="outlined" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="cfgFlashMode" :items="flashModeItems" label="闪存模式" density="compact"
                    variant="outlined" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="cfgFlashFreq" :items="flashFreqItems" label="闪存频率" density="compact"
                    variant="outlined" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="cfgBaudrate" :items="baudrateItems" label="波特率" density="compact"
                    variant="outlined" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="cfgRomBaudrate" :items="romBaudrateItems" label="ROM 波特率" density="compact"
                    variant="outlined" hide-details />
                </v-col>
                <v-col cols="12">
                  <v-switch v-model="eraseAll" color="warning" density="compact" hide-details
                    label="整片擦除（烧录前擦除整片 Flash，较慢，仅在必要时使用）" />
                </v-col>
              </v-row>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- 未连接：连接区 -->
        <div v-if="!connected">
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-usb" :loading="connecting" @click="connect">
            连接设备（下载模式）
          </v-btn>
          <div class="text-caption text-medium-emphasis mt-2">
            空片/新板点连接后 ROM 会自动进入下载模式，完成芯片检测。
          </div>
        </div>

        <!-- 已连接：选文件 + 烧录 -->
        <div v-else>
          <div class="d-flex align-center mb-3">
            <v-icon color="success" size="20" class="mr-2">mdi-check-circle</v-icon>
            <span class="text-body-2">已连接：{{ chipName }}</span>
            <v-spacer />
            <v-btn size="x-small" variant="text" prepend-icon="mdi-link-off" :disabled="flashing" @click="disconnect">
              断开
            </v-btn>
          </div>

          <v-file-input :model-value="firmwareFile" accept=".bin,application/octet-stream" clearable
            density="compact" variant="outlined" hide-details="auto" label="选择合并固件 (.bin)"
            prepend-icon="mdi-file" show-size :disabled="flashing" @update:model-value="onFileChange" />

          <div v-if="flashing" class="mt-4">
            <div class="d-flex align-center justify-space-between mb-1">
              <span class="text-caption text-medium-emphasis">{{ status }}</span>
              <span class="text-caption font-weight-medium">{{ progress.percent }}%</span>
            </div>
            <v-progress-linear :model-value="progress.percent" color="warning" height="10" rounded />
            <div v-if="progress.total > 0" class="text-caption text-medium-emphasis mt-1 text-right">
              {{ formatBytes(progress.written) }} / {{ formatBytes(progress.total) }}
            </div>
          </div>
        </div>

        <v-alert v-if="error" color="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
        <v-alert v-else-if="done" color="success" variant="tonal" density="compact" class="mt-3">{{ done }}</v-alert>
        <v-alert v-else-if="info" color="info" variant="tonal" density="compact" class="mt-3">{{ info }}</v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="flashing" @click="close">关闭</v-btn>
        <v-btn v-if="done" color="success" variant="tonal" prepend-icon="mdi-restart" @click="reset">
          复位并启动
        </v-btn>
        <v-btn v-else color="warning" variant="tonal" prepend-icon="mdi-upload" :disabled="!canFlash"
          :loading="flashing" @click="flash">
          烧录到 Flash
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  flashService,
  type FlashProgress,
  type FlashSizeValues,
  type FlashModeValues,
  type FlashFreqValues,
} from '@/services/FlashService'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

// flashService 是普通 class 单例，其 connected 不是响应式，这里用本地状态手动同步
const connected = ref(false)
const chipName = ref('')
const connecting = ref(false)
const firmwareFile = ref<File | null>(null)
const flashing = ref(false)
const progress = ref<FlashProgress>({ written: 0, total: 0, percent: 0 })
const status = ref('')
const error = ref('')
const info = ref('')
const done = ref('')

// ── 高级选项（连接前配置芯片型号 / 波特率，连接后配置闪存参数 / 擦除）──
const cfgChipName = ref('ESP32-S3')
/** 已知芯片型号（对应 esptool-js 各 ROM 的 CHIP_NAME） */
const chipNameItems = [
  { title: '不校验型号', value: '' },
  { title: 'ESP8266', value: 'ESP8266' },
  { title: 'ESP32', value: 'ESP32' },
  { title: 'ESP32-S2', value: 'ESP32-S2' },
  { title: 'ESP32-S3', value: 'ESP32-S3' },
  { title: 'ESP32-S31', value: 'ESP32-S31' },
  { title: 'ESP32-C2', value: 'ESP32-C2' },
  { title: 'ESP32-C3', value: 'ESP32-C3' },
  { title: 'ESP32-C5', value: 'ESP32-C5' },
  { title: 'ESP32-C6', value: 'ESP32-C6' },
  { title: 'ESP32-C61', value: 'ESP32-C61' },
  { title: 'ESP32-E22', value: 'ESP32-E22' },
  { title: 'ESP32-H2', value: 'ESP32-H2' },
  { title: 'ESP32-H21', value: 'ESP32-H21' },
  { title: 'ESP32-H4', value: 'ESP32-H4' },
  { title: 'ESP32-P4', value: 'ESP32-P4' },
]
const cfgFlashSize = ref<string>('8MB')
const cfgFlashMode = ref<string>('dio')
const cfgFlashFreq = ref<string>('80m')
const cfgBaudrate = ref(921600)
const cfgRomBaudrate = ref(115200)
const eraseAll = ref(false)

const flashSizeItems = ['detect', 'keep', '256KB', '512KB', '1MB', '2MB', '4MB', '8MB', '16MB', '32MB', '64MB', '128MB']
const flashModeItems = ['keep', 'dio', 'qio', 'dout', 'qout']
const flashFreqItems = ['keep', '80m', '60m', '48m', '40m', '30m', '26m', '24m', '20m', '16m', '15m', '12m']
const baudrateItems = [921600, 460800, 230400, 115200]
const romBaudrateItems = [115200, 230400, 460800, 921600]

const canFlash = computed(() => connected.value && !!firmwareFile.value && !flashing.value)

/** 收集当前高级选项为配置对象 */
function buildConfig() {
  return {
    chipName: cfgChipName.value || undefined,
    flashSize: cfgFlashSize.value as FlashSizeValues,
    flashMode: cfgFlashMode.value as FlashModeValues,
    flashFreq: cfgFlashFreq.value as FlashFreqValues,
    baudrate: cfgBaudrate.value,
    romBaudrate: cfgRomBaudrate.value,
    eraseAll: eraseAll.value,
  }
}

/** 复位烧录流程状态（清文件/进度/提示），不改变连接状态 */
function resetFlashState() {
  firmwareFile.value = null
  progress.value = { written: 0, total: 0, percent: 0 }
  status.value = ''
  error.value = ''
  info.value = ''
  done.value = ''
}

// 关闭对话框时释放下载模式端口
watch(() => props.modelValue, open => {
  if (!open && connected.value) void disconnect()
})

// 设备拔出：FlashService 检测到 Web Serial disconnect 后回调
function handleDeviceLost() {
  connected.value = false
  chipName.value = ''
  resetFlashState()
  error.value = '设备已断开，请重新连接'
}

onMounted(() => flashService.onDeviceLost(handleDeviceLost))
onUnmounted(() => flashService.onDeviceLost(null))

function onUpdateModelValue(v: boolean) {
  if (flashing.value && !v) return // 烧录中禁止关闭
  emit('update:modelValue', v)
}

function close() {
  if (!flashing.value) emit('update:modelValue', false)
}

async function connect() {
  connecting.value = true
  error.value = ''
  info.value = ''
  chipName.value = ''
  try {
    chipName.value = await flashService.connect(buildConfig())
    connected.value = true
  } catch (e) {
    error.value = `连接失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  await flashService.disconnect()
  connected.value = false
  chipName.value = ''
  resetFlashState()
}

function onFileChange(value: File | File[] | null) {
  firmwareFile.value = Array.isArray(value) ? (value[0] ?? null) : value
  error.value = ''
  info.value = ''
  done.value = ''
}

async function flash() {
  if (!firmwareFile.value) return
  flashing.value = true
  error.value = ''
  info.value = ''
  done.value = ''
  status.value = '正在烧录…'
  progress.value = { written: 0, total: 0, percent: 0 }
  try {
    const data = new Uint8Array(await firmwareFile.value.arrayBuffer())
    await flashService.writeFirmware(data, p => { progress.value = p }, buildConfig())
    done.value = '烧录完成，点击「复位并启动」让新固件运行'
  } catch (e) {
    // 设备丢失时 handleDeviceLost 已给出提示，这里不覆盖
    if (!connected.value) return
    error.value = `烧录失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    flashing.value = false
  }
}

async function reset() {
  status.value = '正在复位…'
  error.value = ''
  info.value = ''
  try {
    await flashService.reset()
  } catch {
    // hard_reset 后端口可能异常，忽略
  } finally {
    // 复位后设备已跑新固件，下载模式端口失效：断开并复位界面，恢复为「烧录」按钮
    await flashService.disconnect()
    connected.value = false
    chipName.value = ''
    resetFlashState()
    info.value = '已复位，设备将启动新固件，请关闭或重新连接'
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}
</script>

<style scoped>
/* 高级选项折叠面板：去掉默认边框与阴影，融入卡片 */
.adv-panels :deep(.v-expansion-panel) {
  box-shadow: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
}

.adv-panels :deep(.v-expansion-panel-title) {
  min-height: 40px;
  padding: 0 12px;
  font-size: 0.85rem;
}
</style>
