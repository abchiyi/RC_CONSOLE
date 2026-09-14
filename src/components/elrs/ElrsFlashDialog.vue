<template>
  <v-dialog :model-value="modelValue" max-width="680" persistent @update:model-value="onUpdateModelValue">
    <v-card>
      <v-card-title class="d-flex align-center text-body-1">
        <v-icon class="mr-2" color="primary">mdi-chip</v-icon>
        模块固件烧录
        <v-spacer />
        <v-chip v-if="busy" color="warning" size="x-small" variant="tonal">{{ phaseLabel || '处理中' }}</v-chip>
        <v-chip v-else-if="done" color="success" size="x-small" variant="tonal">完成</v-chip>
        <v-chip v-else color="grey" size="x-small" variant="tonal">ESP32-C3</v-chip>
      </v-card-title>

      <v-card-text>
        <v-alert v-if="!serial.connected && !busy" color="info" variant="tonal" density="compact" class="mb-3">
          请先连接设备，再烧录外部模块固件。
        </v-alert>

        <v-file-input :model-value="file" accept=".bin,application/octet-stream" clearable density="compact"
          variant="outlined" hide-details="auto" label="选择模块固件镜像 (.bin)" prepend-icon="mdi-file" show-size
          :disabled="busy || !serial.connected" @update:model-value="onFileChange" />

        <div class="d-flex flex-wrap align-center ga-4 mt-3">
          <v-chip color="grey" size="small" variant="tonal" prepend-icon="mdi-map-marker">
            起始地址 0x000000（完整镜像）
          </v-chip>
          <v-switch :model-value="eraseAll" color="error" density="compact" hide-details inset :disabled="busy"
            label="烧录前整片擦除" @update:model-value="(v: unknown) => (eraseAll = !!v)" />
        </div>

        <v-alert color="info" variant="tonal" density="compact" class="mt-3">
          只支持完整镜像（merged：bootloader + 分区表 + app，从 0x000000 整片写入）；
          仅含 app 的镜像请走 ELRS 自身的 WiFi/OTA 更新。烧录期间通道输出中断，仅在地面操作。
        </v-alert>

        <v-alert v-if="eraseAll" color="warning" variant="tonal" density="compact" class="mt-3">
          整片擦除会清空模块 flash 的全部内容（对频信息、NVS、WiFi 凭据等），烧完必须重新对频配置。
          擦除期间请勿断电；即使断电也不会变砖，重新烧一次即可。
        </v-alert>

        <div v-if="busy" class="mt-4">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">{{ phaseLabel || '处理中' }}</span>
            <span class="text-caption font-weight-medium">{{ progress }}%</span>
          </div>
          <v-progress-linear :model-value="progress" :indeterminate="progress === 0" color="primary" height="10"
            rounded />
          <div v-if="detail" class="text-caption text-medium-emphasis mt-1">{{ detail }}</div>
        </div>

        <v-alert v-if="error" color="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
        <v-alert v-else-if="status" color="success" variant="tonal" density="compact" class="mt-3">{{ status }}</v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="busy" @click="close">关闭</v-btn>
        <v-btn color="warning" variant="tonal" prepend-icon="mdi-upload" :disabled="!canStart" :loading="busy"
          @click="startFlash">
          开始烧录
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { serialService } from '@/services/SerialService'
import { FLASH_BEGIN_ERASE_ALL } from '@/utils/protocol'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done', summary: string): void
}>()

const serial = useSerialStore()

/** 单片固件字节数：固件 chunk_hint=240，单帧 250B 不会触发协议分片 */
const DEFAULT_CHUNK_SIZE = 240
/** BEGIN 含目标侧擦除：整片擦除时 4MB 最长达 40s，超时给足 */
const BEGIN_TIMEOUT_MS = 60000
const CHUNK_TIMEOUT_MS = 15000
/** FINISH 含目标侧 MD5 校验 */
const FINISH_TIMEOUT_MS = 90000

/** 写入起点固定 0x000000：只烧完整镜像(bootloader + 分区表 + app)，固件侧会拒绝其它值 */
const MODULE_IMAGE_OFFSET = 0x000000

const file = ref<File | null>(null)
const eraseAll = ref(false)

const busy = ref(false)
const done = ref(false)
const progress = ref(0)
const phaseLabel = ref('')
const detail = ref('')
const status = ref('')
const error = ref('')

const canStart = computed(() => serial.connected && !!file.value && !busy.value)

/** 烧录中禁止关闭对话框，避免中断传输 */
function onUpdateModelValue(v: boolean) {
  if (busy.value && !v) return
  emit('update:modelValue', v)
}

function close() {
  if (!busy.value) emit('update:modelValue', false)
}

function onFileChange(value: File | File[] | null) {
  file.value = Array.isArray(value) ? (value[0] ?? null) : value
  status.value = ''
  error.value = ''
  done.value = false
}

/** 等待某条命令的响应（一次性监听，收到或超时即注销） */
function waitFor(cmd: string, timeoutMs: number): Promise<Record<string, unknown>> {
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

async function sendAndWait(
  cmd: string,
  params: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const pending = waitFor(cmd, timeoutMs)
  await serialService.sendCommand(cmd, params)
  return pending
}

async function startFlash() {
  const selected = file.value
  if (!selected) return

  busy.value = true
  done.value = false
  error.value = ''
  status.value = ''
  detail.value = ''
  progress.value = 0

  let sessionOpen = false

  try {
    const data = new Uint8Array(await selected.arrayBuffer())
    if (data.byteLength === 0) throw new Error('固件文件为空')

    const offset = MODULE_IMAGE_OFFSET
    // 1) BEGIN：进 ROM 下载模式 + 握手 + [可选整片擦除] + 擦除目标区域（可能耗时数十秒）
    //    不再单独探测链路：固件侧 BEGIN 内部就会握手（探测命令 0x070B 已废弃）
    phaseLabel.value = eraseAll.value ? '整片擦除中，请勿断电…' : '初始化烧录…'
    const begin = await sendAndWait('elrs_flash_begin', {
      offset,
      image_size: data.byteLength,
      flags: eraseAll.value ? FLASH_BEGIN_ERASE_ALL : 0,
    }, BEGIN_TIMEOUT_MS)
    if (begin.ok !== true) throw new Error(String(begin.error || '烧录初始化失败'))
    sessionOpen = true

    const chunkSize = Number(begin.chunk_hint ?? DEFAULT_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE
    const eraseMs = Number(begin.erase_ms ?? 0)
    if (eraseMs > 0) detail.value = `已整片擦除（${(eraseMs / 1000).toFixed(1)}s）`

    // 2) CHUNK：串行逐片，offset 严格续接（固件会校验，错位即中止会话）
    phaseLabel.value = '写入中…'
    const total = data.byteLength
    let sent = 0
    let chunks = 0
    while (sent < total) {
      const end = Math.min(sent + chunkSize, total)
      const resp = await sendAndWait('elrs_flash_chunk', {
        offset: offset + sent,
        data: data.subarray(sent, end),
      }, CHUNK_TIMEOUT_MS)
      if (resp.ok !== true) throw new Error(String(resp.error || `第 ${chunks + 1} 片写入失败`))
      sent = end
      chunks++
      progress.value = Math.floor((sent / total) * 100)
      detail.value = `已下发 ${sent} / ${total} 字节`
      // 每 32 片让出事件循环，保持界面可响应
      if (chunks % 32 === 0) await new Promise(r => setTimeout(r, 0))
    }

    // 3) FINISH：目标侧 MD5 校验 + 目标重启（会恢复 CRSF 通信）
    phaseLabel.value = '校验并重启模块…'
    const fin = await sendAndWait('elrs_flash_finish', undefined, FINISH_TIMEOUT_MS)
    if (fin.ok !== true) throw new Error(String(fin.error || '烧录收尾失败'))
    sessionOpen = false

    progress.value = 100
    const md5Text = fin.md5_ok === true ? 'MD5 校验通过' : 'MD5 未校验（目标不支持）'
    const secs = (Number(fin.elapsed_ms ?? 0) / 1000).toFixed(1)
    const summary = `烧录完成：${String(fin.total_written ?? total)} 字节 / ${String(fin.chunks ?? chunks)} 片 / ${secs}s，${md5Text}`
    status.value = summary
    done.value = true
    phaseLabel.value = ''
    emit('done', summary)
  } catch (e) {
    error.value = `烧录失败: ${e instanceof Error ? e.message : String(e)}`
    // 失败必须补一条 ABORT：否则被暂停的流不会恢复、ELRS 可能停在下载模式
    if (sessionOpen) {
      try { await serialService.sendCommand('elrs_flash_abort') } catch { /* ignore */ }
    }
    phaseLabel.value = ''
  } finally {
    busy.value = false
  }
}
</script>
