<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    persistent
    @update:model-value="onUpdateModelValue"
  >
    <v-card>
      <v-card-title class="d-flex align-center text-body-1">
        <v-icon class="mr-2" color="primary">mdi-upload-network</v-icon>
        固件升级
        <v-spacer />
        <v-chip v-if="firmwareBusy" color="warning" size="x-small" variant="tonal">升级中</v-chip>
        <v-chip v-else-if="firmwareStatus" color="success" size="x-small" variant="tonal">完成</v-chip>
        <v-chip v-else color="grey" size="x-small" variant="tonal">串口 OTA</v-chip>
      </v-card-title>

      <v-card-text>
        <v-alert v-if="!serial.connected && !firmwareBusy" color="info" variant="tonal" density="compact" class="mb-3">
          请先连接设备，再上传固件镜像。
        </v-alert>

        <v-file-input
          :model-value="firmwareFile"
          accept=".bin,application/octet-stream"
          clearable
          density="compact"
          variant="outlined"
          hide-details="auto"
          label="选择固件文件"
          prepend-icon="mdi-file"
          show-size
          :disabled="firmwareBusy || !serial.connected"
          @update:model-value="onFirmwareFileChange"
        />

        <div v-if="firmwareBusy" class="mt-4">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">上传进度</span>
            <span class="text-caption font-weight-medium">{{ firmwareProgress }}%</span>
          </div>
          <v-progress-linear
            :model-value="firmwareProgress"
            color="primary"
            height="10"
            rounded
          />
        </div>

        <v-alert v-if="firmwareError" color="error" variant="tonal" density="compact" class="mt-3">
          {{ firmwareError }}
        </v-alert>
        <v-alert v-else-if="firmwareStatus" color="success" variant="tonal" density="compact" class="mt-3">
          {{ firmwareStatus }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-delete-outline"
          :disabled="firmwareBusy || !firmwareFile"
          @click="clearFirmwareSelection"
        >
          清空
        </v-btn>
        <v-btn variant="text" :disabled="firmwareBusy" @click="close">关闭</v-btn>
        <v-btn
          color="warning"
          variant="tonal"
          prepend-icon="mdi-upload"
          :disabled="!canFlashFirmware"
          :loading="firmwareBusy"
          @click="startFirmwareUpdate"
        >
          上传并刷写
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { serialService } from '@/services/SerialService'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const serial = useSerialStore()

const firmwareFile = ref<File | null>(null)
const firmwareBusy = ref(false)
const firmwareStatus = ref('')
const firmwareError = ref('')
const firmwareProgress = ref(0)
const canFlashFirmware = computed(() => serial.connected && !!firmwareFile.value && !firmwareBusy.value)

/** 升级中强制禁止关闭对话框，避免传输被中断 */
function onUpdateModelValue(v: boolean) {
  if (firmwareBusy.value && !v) return
  emit('update:modelValue', v)
}

function close() {
  if (!firmwareBusy.value) emit('update:modelValue', false)
}

function onFirmwareFileChange(value: File | File[] | null) {
  firmwareFile.value = Array.isArray(value) ? (value[0] ?? null) : value
  firmwareStatus.value = ''
  firmwareError.value = ''
}

function clearFirmwareSelection() {
  firmwareFile.value = null
  firmwareStatus.value = ''
  firmwareError.value = ''
  firmwareProgress.value = 0
}

function waitForCommand(cmd: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`等待设备响应超时: ${cmd}`))
    }, timeoutMs)

    const handler = (obj: Record<string, unknown>) => {
      if (obj.cmd !== cmd) return
      cleanup()
      resolve(obj)
    }

    const cleanup = () => {
      clearTimeout(timer)
      serialService.removeObjectListener(handler)
    }

    serialService.onObject(handler)
  })
}

async function sendCommandAndWait(cmd: string, params?: Record<string, unknown>, timeoutMs = 10000) {
  const pending = waitForCommand(cmd, timeoutMs)
  await serialService.sendCommand(cmd, params)
  return pending
}

async function startFirmwareUpdate() {
  if (!serial.connected) {
    firmwareError.value = '请先连接设备'
    return
  }
  if (!firmwareFile.value) {
    firmwareError.value = '请先选择固件文件'
    return
  }

  firmwareBusy.value = true
  firmwareStatus.value = ''
  firmwareError.value = ''
  firmwareProgress.value = 0

  const selectedFile = firmwareFile.value
  const chunkSize = 96
  let otaStarted = false

  try {
    const data = new Uint8Array(await selectedFile.arrayBuffer())
    const beginResp = await sendCommandAndWait('ota_begin', {
      size: data.byteLength,
    })

    if (beginResp.ok !== true) {
      firmwareError.value = String(beginResp.error || 'OTA 初始化失败')
      return
    }

    otaStarted = true
    const serverChunkSize = Number(beginResp.chunk_hint ?? chunkSize)
    const uploadChunkSize = Number.isFinite(serverChunkSize) && serverChunkSize > 0 ? serverChunkSize : chunkSize
    const totalChunks = Math.max(1, Math.ceil(data.byteLength / uploadChunkSize))

    for (let index = 0; index < totalChunks; index++) {
      const start = index * uploadChunkSize
      const end = Math.min(start + uploadChunkSize, data.byteLength)
      const chunk = data.subarray(start, end)
      // 二进制协议 ota_chunk 直传原始字节（无 index/base64）
      const chunkResp = await sendCommandAndWait('ota_chunk', { data: chunk }, 10000)
      console.log(`[OTA] chunk ${index}/${totalChunks} offset=${start} len=${chunk.length} resp:`, chunkResp)

      if (chunkResp.ok !== true) {
        throw new Error(String(chunkResp.error || `分片写入失败: ${index}`))
      }

      firmwareProgress.value = Math.round(((index + 1) / totalChunks) * 100)
    }

    const finishResp = await sendCommandAndWait('ota_finish', {}, 20000)
    if (finishResp.ok !== true) {
      throw new Error(String(finishResp.error || 'OTA 结束失败'))
    }

    firmwareProgress.value = 100
    firmwareStatus.value = `OTA 上传完成，已写入 ${String(finishResp.total_written ?? data.byteLength)} 字节，设备将重启`

    setTimeout(async () => {
      try {
        if (serial.connected) {
          await serial.disconnect()
        }
        if (serial.isElectron) {
          await serial.connect(serial.lastPortPath)
        } else {
          firmwareStatus.value = 'OTA 完成，设备已重启，请手动重新连接串口'
        }
      } catch {
        // ignore
      }
    }, 3000)
  } catch (e: unknown) {
    console.error('[OTA] failed:', e)
    if (otaStarted) {
      try {
        await serialService.sendCommand('ota_abort')
      } catch (abortErr) {
        console.error('[OTA] abort also failed:', abortErr)
      }
    }
    firmwareError.value = `升级失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    firmwareBusy.value = false
  }
}
</script>
