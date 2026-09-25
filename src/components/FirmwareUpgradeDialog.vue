<template>
  <v-dialog :model-value="modelValue" max-width="640" persistent @update:model-value="onUpdateModelValue">
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

        <v-file-input :model-value="firmwareFile" accept=".bin,application/octet-stream" clearable density="compact"
          variant="outlined" hide-details="auto" label="选择固件文件" prepend-icon="mdi-file" show-size
          :disabled="firmwareBusy || !serial.connected" @update:model-value="onFirmwareFileChange" />

        <div v-if="firmwareBusy" class="mt-4">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">上传进度</span>
            <span class="text-caption font-weight-medium">{{ firmwareProgress }}%</span>
          </div>
          <v-progress-linear :model-value="firmwareProgress" color="primary" height="10" rounded />
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
        <v-btn size="small" variant="text" prepend-icon="mdi-delete-outline" :disabled="firmwareBusy || !firmwareFile"
          @click="clearFirmwareSelection">
          清空
        </v-btn>
        <v-btn variant="text" :disabled="firmwareBusy" @click="close">关闭</v-btn>
        <v-btn color="warning" variant="tonal" prepend-icon="mdi-upload" :disabled="!canFlashFirmware"
          :loading="firmwareBusy" @click="startFirmwareUpdate">
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
import { STATUS_SEQ_ERR, STATUS_SIZE_ERR } from '@/utils/protocol'

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
    // FE-10: 固件 BEGIN 最坏耗时远超默认超时 —— 会话重入路径（上一会话未 ABORT/FINISH
    //        就再次 BEGIN：残镜像 esp_ota_end 校验 + 全分区重擦）实测 ~120s；正常收尾后
    //        的脏分区 ~0.5s、已擦分区 ~0.4s。默认 10s 超时命中慢路径即误报「OTA 初始化失败」。
    firmwareStatus.value = '正在擦除目标分区…（首次或重试可能需 1~2 分钟，请勿断开）'
    const beginResp = await sendCommandAndWait('ota_begin', {
      size: data.byteLength,
    }, 180000)

    if (beginResp.ok !== true) {
      firmwareStatus.value = ''
      firmwareError.value = String(beginResp.error || 'OTA 初始化失败')
      return
    }

    otaStarted = true
    firmwareStatus.value = '正在上传固件…'
    const serverChunkSize = Number(beginResp.chunk_hint ?? chunkSize)
    const uploadChunkSize = Number.isFinite(serverChunkSize) && serverChunkSize > 0 ? serverChunkSize : chunkSize
    const totalChunks = Math.max(1, Math.ceil(data.byteLength / uploadChunkSize))

    // 流水线+窗口确认: 每 WINDOW_SIZE 个 chunk 等一次响应同步, 兼顾速度和可靠性
    const WINDOW_SIZE = 16
    const MAX_RESEND = 20 // F-28: 丢帧导致的整段重传次数上限
    let lastError: string | null = null
    // F-28: 设备"已接受累计" = 下一个期望 offset (链路确认点; 与落盘进度解耦, 不会回退)
    let accepted = 0
    let shouldStop = false
    const errorHandler = (obj: Record<string, unknown>) => {
      if (obj.cmd === 'ota_chunk') {
        if (obj.ok === false) {
          // F-28: offset 不匹配(请求丢帧/响应丢帧/重复帧)属**可自愈**情形 ——
          // 固件在响应里带回"期望 offset", 由下面的窗口同步从该处重传; 其余错误照旧中止。
          if (obj.status === STATUS_SEQ_ERR || obj.status === STATUS_SIZE_ERR) return
          lastError = String(obj.error || '分片写入失败')
          shouldStop = true
        } else if (typeof obj.total_written === 'number') {
          accepted = Math.max(accepted, obj.total_written)
        }
      }
    }
    serialService.onObject(errorHandler)

    // 进度探针: 只带 offset、不带数据的 ota_chunk。固件对负载 ≤4B 走早期分支, 只回读
    // "已接受累计"(不写 flash)。这是唯一能主动催出 OTA 进度的手段 —— OTA_CHUNK 是被动响应,
    // 窗口同步若只是"停发干等", 就再不会有响应抵达, accepted 冻结, 必然假超时。
    const probeChunk = new Uint8Array(0)

    let sentBytes = 0
    let resendCount = 0
    for (let index = 0; index < totalChunks && !shouldStop;) {
      const start = index * uploadChunkSize
      const end = Math.min(start + uploadChunkSize, data.byteLength)
      const chunk = data.subarray(start, end)
      await serialService.sendCommand('ota_chunk', { offset: start, data: chunk })
      sentBytes = end
      index++
      firmwareProgress.value = Math.round((sentBytes / data.byteLength) * 100)

      // 每窗口等一次同步: 确认固件已接受(含链路重传)
      if (index % WINDOW_SIZE === 0 || index === totalChunks) {
        const syncStart = Date.now()
        while (accepted < sentBytes && Date.now() - syncStart < 5000 && !shouldStop) {
          await serialService.sendCommand('ota_chunk', { offset: accepted, data: probeChunk })
          await new Promise(r => setTimeout(r, 20))
        }
        if (shouldStop) break
        if (accepted < sentBytes) {
          // F-28: 有片未被接受 —— 从设备确认的 offset 处重传(不再是致命错误)
          if (++resendCount > MAX_RESEND) {
            shouldStop = true
            lastError = `重传次数超限: 已发 ${sentBytes} / 设备确认 ${accepted}`
            break
          }
          console.warn(`[OTA] 链路重传 #${resendCount}: 已发 ${sentBytes} -> 回到 ${accepted}`)
          index = Math.floor(accepted / uploadChunkSize)
          sentBytes = index * uploadChunkSize
        }
      }
      // 每 64 个 chunk 让出事件循环
      if (index % 64 === 0) await new Promise(r => setTimeout(r, 0))
    }

    serialService.removeObjectListener(errorHandler)
    if (shouldStop) throw new Error(lastError || '传输中断')
    if (accepted !== data.byteLength) {
      throw new Error(`数据不完整: 已写 ${accepted} / 应写 ${data.byteLength}`)
    }

    // FE-10: FINISH 需等队列排空 + esp_ota_end() 校验整镜像 + 设置启动分区, 60s 偏紧
    const finishResp = await sendCommandAndWait('ota_finish', {}, 180000)
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
    firmwareStatus.value = ''
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
