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
          <!-- 速率 / 剩余时间（倒计时）。OTA_BEGIN 阶段只是在擦 Flash，没有有效速率可言，
               两者都为空时整行不占位，避免出现 "0.0 KB/s 剩余 00:00" 这种误导性数字 -->
          <div v-if="transferSpeed || transferEta" class="d-flex align-center justify-space-between mt-2">
            <span class="text-caption text-medium-emphasis d-flex align-center">
              <v-icon size="12" class="mr-1">mdi-speedometer</v-icon>{{ transferSpeed }}
            </span>
            <span class="text-caption text-medium-emphasis d-flex align-center">
              <v-icon size="12" class="mr-1">mdi-timer-outline</v-icon>{{ transferEta }}
            </span>
          </div>
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
import { STATUS_CRC_ERR, STATUS_SEQ_ERR, STATUS_SIZE_ERR } from '@/utils/protocol'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const serial = useSerialStore()

const firmwareFile = ref<File | null>(null)
const firmwareBusy = ref(false)
const firmwareStatus = ref('')
const firmwareError = ref('')
const firmwareProgress = ref(0)
// 实时传输统计（速率 / 剩余时间）。空串表示「还没有有效样本」，UI 据此隐藏整行。
const transferSpeed = ref('')
const transferEta = ref('')
const canFlashFirmware = computed(() => serial.connected && !!firmwareFile.value && !firmwareBusy.value)

/** 字节/秒 → 人类可读速率 */
function formatSpeed(bps: number): string {
  return `${(bps / 1024).toFixed(bps < 1024 * 100 ? 1 : 0)} KB/s`
}

/** 秒 → mm:ss；超过 1 小时进位为 h:mm:ss */
function formatEta(sec: number): string {
  const total = Math.round(sec)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const mm = pad(Math.floor((total % 3600) / 60))
  return h > 0 ? `${h}:${mm}:${pad(total % 60)}` : `${mm}:${pad(total % 60)}`
}

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
  transferSpeed.value = ''
  transferEta.value = ''
}

async function sendCommandAndWait(
  cmd: string,
  params?: Record<string, unknown>,
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  const buffered: Record<string, unknown>[] = []
  let notify: (() => void) | null = null
  const handler = (obj: Record<string, unknown>) => {
    if (obj.cmd !== cmd) return
    buffered.push(obj)
    notify?.()
  }

  serialService.onObject(handler)
  try {
    const seq = await serialService.sendCommand(cmd, params)
    if (seq === undefined) throw new Error(`命令未发送: ${cmd}`)

    const deadline = Date.now() + timeoutMs
    while (true) {
      const index = buffered.findIndex(obj => Number(obj.seq) === seq)
      if (index >= 0) {
        const matched = buffered[index]
        if (matched) {
          buffered.splice(index, 1)
          return matched
        }
      }

      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`等待设备响应超时: ${cmd}`)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          notify = null
          reject(new Error(`等待设备响应超时: ${cmd}`))
        }, remaining)
        notify = () => {
          clearTimeout(timer)
          notify = null
          resolve()
        }
      })
    }
  } finally {
    notify = null
    serialService.removeObjectListener(handler)
  }
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
  transferSpeed.value = ''
  transferEta.value = ''

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

    // 流水线 + 严格窗口确认：每个窗口都以设备确认量收口，下一窗口不会越过确认点。
    // 固件 3.1.5 的 USB Serial/JTAG RX 缓冲只有 4096B；8 × (236B 载荷 + 16B 帧开销)
    // = 2016B，再加一帧探针仍低于缓冲的一半。后续固件即使扩大缓冲，前端也保持此前向兼容基线。
    const WINDOW_SIZE = 8
    const PROBE_TIMEOUT_MS = 2000
    const MAX_PROBE_ATTEMPTS = 3
    // F-28: 重传预算按「连续原地不动」计算，确认量前进即清零，避免大镜像因累计偶发丢帧失败。
    const MAX_RESEND_STALL = 20
    let lastError: string | null = null
    // F-28: 设备"已接受累计" = 下一个期望 offset (链路确认点; 与落盘进度解耦, 不会回退)
    let accepted = 0
    let shouldStop = false
    // 设备回 S_CRC_ERR 的次数：最终仍失败时把"链路本就不干净"这一事实透出来
    let crcNackCount = 0
    const errorHandler = (obj: Record<string, unknown>) => {
      if (obj.cmd === 'ota_chunk') {
        if (obj.ok === false) {
          // offset 不匹配、请求丢帧或重复帧可由窗口探针取得真实确认点后自愈。
          if (obj.status === STATUS_SEQ_ERR || obj.status === STATUS_SIZE_ERR) return
          // CRC 失配表示当前帧未被接受，设备确认点不会推进，交由窗口同步重传。
          if (obj.status === STATUS_CRC_ERR) {
            crcNackCount++
            console.warn(`[OTA] 设备 CRC 失配 NACK #${crcNackCount}，交给窗口同步重传`)
            return
          }
          lastError = String(obj.error || '分片写入失败')
          shouldStop = true
        } else if (typeof obj.total_written === 'number') {
          accepted = Math.max(accepted, obj.total_written)
        }
      }
    }

    // 进度探针不写 flash，只回读设备真实确认量。响应必须按请求 seq 精确匹配，
    // 否则窗口内迟到的数据分片响应会被误当成探针响应，引发错误回退和重复重传。
    const probeChunk = new Uint8Array(0)
    let sentBytes = 0
    let resendCount = 0
    let lastProgressOffset = 0

    // ── 传输统计：速率 + 剩余时间（倒计时）─────────────────────────────────
    // ★ 三个关键点：
    //   1) 统计口径必须是 accepted（设备确认量）而不是 sentBytes —— 前者单调，
    //      后者每次重传都会回退到确认点。用 sentBytes 算速率会把同一份数据重复计数，
    //      显示虚高，且 ETA 会随着重传来回跳。
    //   2) 计时起点必须在 OTA_BEGIN 之后：BEGIN 可能是一次持续 1~2 分钟的全分区擦除，
    //      把它算进传输耗时，开头几十秒的速率会低到没有参考意义。
    //   3) EMA 平滑 + 400ms 节流：accepted 每 WINDOW_SIZE(8) 片才推进一次，
    //      直接做瞬时差分会让数字在 0 与峰值之间反复跳。
    const totalBytes = data.byteLength
    const STATS_MIN_INTERVAL_MS = 400
    let lastStatsAt = 0
    let lastSampleAt = performance.now()
    let lastSampleBytes = 0
    let smoothRate = -1 // EMA 平滑后的字节/秒；< 0 表示尚无有效样本

    function refreshTransferStats(confirmed: number, force = false) {
      const now = performance.now()
      if (!force && now - lastStatsAt < STATS_MIN_INTERVAL_MS) return
      const dtSec = (now - lastSampleAt) / 1000
      if (dtSec > 0) {
        const instRate = Math.max(0, confirmed - lastSampleBytes) / dtSec
        smoothRate = smoothRate < 0 ? instRate : smoothRate * 0.6 + instRate * 0.4
      }
      lastStatsAt = now
      lastSampleAt = now
      lastSampleBytes = confirmed

      if (smoothRate <= 0) {
        // 还没有任何字节被确认（仍在等第一帧响应），此时给不出有意义的估算
        transferEta.value = '正在计算…'
        return
      }
      transferSpeed.value = formatSpeed(smoothRate)
      const remainBytes = totalBytes - confirmed
      transferEta.value = remainBytes <= 0 ? '即将完成' : `剩余 ${formatEta(remainBytes / smoothRate)}`
    }

    serialService.onObject(errorHandler)
    try {
      for (let index = 0; index < totalChunks && !shouldStop;) {
        const start = index * uploadChunkSize
        const end = Math.min(start + uploadChunkSize, data.byteLength)
        const chunk = data.subarray(start, end)
        const seq = await serialService.sendCommand('ota_chunk', { offset: start, data: chunk })
        if (seq === undefined) throw new Error(`OTA 分片未发送: offset=${start}`)
        sentBytes = end
        index++
        // 进度使用设备确认量且锁在 99%，最后 1% 留给 esp_ota_end() 和启动分区切换。
        firmwareProgress.value = Math.min(99, Math.round((accepted / totalBytes) * 100))
        refreshTransferStats(accepted)

        if (index % WINDOW_SIZE === 0 || index === totalChunks) {
          // 每窗口固定让出一次事件循环，让串口读循环先处理已到达的响应。该节流对
          // 3.1.5 的 4096B RX 缓冲是兼容性约束，不依赖后续固件扩大到 16384B。
          await new Promise<void>(resolve => setTimeout(resolve, 0))

          // 若普通分片响应尚未把确认点推进到窗口末尾，发送按 seq 匹配的进度探针。
          // 探针响应丢失时最多重试三次；只有拿到真实确认点后才决定是否回退。
          for (let attempt = 1;
            accepted < sentBytes && !shouldStop && attempt <= MAX_PROBE_ATTEMPTS;
            attempt++) {
            try {
              const probe = await sendCommandAndWait(
                'ota_chunk', { offset: accepted, data: probeChunk }, PROBE_TIMEOUT_MS)
              if (probe.ok === true && typeof probe.total_written === 'number') {
                accepted = Math.max(accepted, probe.total_written)
                break
              }
              if (shouldStop) break
            } catch {
              console.warn(`[OTA] 窗口探针超时 ${attempt}/${MAX_PROBE_ATTEMPTS}`)
            }
          }

          if (shouldStop) break
          if (accepted < sentBytes) {
            // 有分片未被设备接受，从设备确认点开始重传。预算只统计连续无进展次数。
            if (accepted > lastProgressOffset) {
              lastProgressOffset = accepted
              resendCount = 0
            }
            if (++resendCount > MAX_RESEND_STALL) {
              shouldStop = true
              lastError = `重传次数超限: 已发 ${sentBytes} / 设备确认 ${accepted}` +
                `（连续 ${MAX_RESEND_STALL} 次原地不动` +
                (crcNackCount ? `，期间设备 CRC 失配 NACK ${crcNackCount} 次` : '') +
                '）。链路持续丢字节：检查 USB 链路、日志混流或设备接收缓冲。'
              break
            }
            console.warn(`[OTA] 链路重传 #${resendCount}: 已发 ${sentBytes} -> 回到 ${accepted}`)
            index = Math.floor(accepted / uploadChunkSize)
            sentBytes = index * uploadChunkSize
          } else {
            lastProgressOffset = accepted
            resendCount = 0
          }

          firmwareProgress.value = Math.min(99, Math.round((accepted / totalBytes) * 100))
          refreshTransferStats(accepted)
        }
      }
    } finally {
      serialService.removeObjectListener(errorHandler)
    }
    if (shouldStop) throw new Error(lastError || '传输中断')
    if (accepted !== data.byteLength) {
      throw new Error(`数据不完整: 已写 ${accepted} / 应写 ${data.byteLength}`)
    }

    // 数据已全部被设备确认：强制刷新一次，避免最后一个 400ms 节流窗口没把 UI 推到最新。
    refreshTransferStats(accepted, true)
    firmwareStatus.value = '已全部下发，正在校验镜像并设置启动分区…'

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
          // 烧录需要独占串口：这里必须真正释放端口，不能用软断开
          await serial.disconnect({ releasePort: true })
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
    // 收尾清空：不让上一次的数字在下次开始时残留一帧
    transferSpeed.value = ''
    transferEta.value = ''
  }
}
</script>
