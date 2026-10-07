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

    // 流水线+窗口确认: 每 WINDOW_SIZE 个 chunk 等一次响应同步, 兼顾速度和可靠性
    // ★ 不变量: WINDOW_SIZE × (单片载荷 + 16B 帧开销) 必须 < 设备侧 rx_buffer_size。
    //   帧开销 = 10B 帧头 + 2B cmd + 4B offset = 16B; 单片载荷取自 BEGIN 响应的 chunk_hint,
    //   固件为迁就 BLE MTU 固定回 236B (command_center_ota.cpp:380), 即 252B/帧 ——
    //   常被误算成 256+10=266B, 实际少了 cmd/offset 那 6B、多了 MTU 扣的那 20B。
    //   窗口同步会等设备确认到窗口末尾, 故"在途未确认字节"的上界就是一个窗口。
    //   旧组合 16 × 252B = 4032B, 对当时设备的 4096B 环形缓冲只剩 64B 余量,
    //   叠加 OTA 期间 flash 擦除造成的停摆 → 几乎每个窗口都溢出 → "每 ~100 片坏一帧"的 CRC NACK。
    //   现取 8 (= 2016B)，对应固件端 rx_buffer_size=16384，约 8.1× 余量。
    //   窗口同步已改为"只在未确认时才发探针"，同步本身近乎零成本，收紧窗口不拖速度。
    //   ★ 提速方案（放宽单片 / 重排 OTA 队列 slot）见 docs/UsbOtaThroughput_zh.md；
    //     改动本节任一常量前，先读该文档 §5 的不变量清单。
    const WINDOW_SIZE = 8
    // F-28: 重传预算。★ 语义是「连续原地不动的次数」上限，**不是**全程累计上限 ——
    //   921KB 镜像有 4000+ 片，链路每 ~100 片丢一个字节，全程累计上限 20 就会被填满，
    //   大镜像必然中途死掉（实测卡在 50%，恰好 20 次 CRC NACK）。
    //   只要设备确认量还在前进就清零；只有连续多次原地不动才判定链路已死。
    const MAX_RESEND_STALL = 20
    // 未确认字节达到该量时主动让出事件循环：约为设备侧 USJ rx_buffer(16384B, usb_backend.cpp:123) 的 1/8。
    //   ★ 注意：一个窗口只有 WINDOW_SIZE × 252B = 2016B，正常情况下够不到这条线，
    //     所以它在正常传输中很少触发；真正每窗口收口的是 WINDOW_SIZE 的同步等待。
    //     单靠抬高本值提升不了速率 —— 实测依据见 docs/UsbOtaThroughput_zh.md §4-C。
    //   调大前仍需确认它 < 设备侧 rx_buffer_size（该限制只对 USJ 后端成立：
    //     USJ 溢出即静默丢字节；TinyUSB 放不下时 USB 会 NAK、由主机重发）。
    const INFLIGHT_YIELD_BYTES = 2048
    let lastError: string | null = null
    // F-28: 设备"已接受累计" = 下一个期望 offset (链路确认点; 与落盘进度解耦, 不会回退)
    let accepted = 0
    let shouldStop = false
    // 设备回 S_CRC_ERR 的次数：最终仍失败时把"链路本就不干净"这一事实透出来
    let crcNackCount = 0
    const errorHandler = (obj: Record<string, unknown>) => {
      if (obj.cmd === 'ota_chunk') {
        if (obj.ok === false) {
          // F-28: offset 不匹配(请求丢帧/响应丢帧/重复帧)属**可自愈**情形 ——
          // 固件在响应里带回"期望 offset", 由下面的窗口同步从该处重传; 其余错误照旧中止。
          if (obj.status === STATUS_SEQ_ERR || obj.status === STATUS_SIZE_ERR) return
          // S_CRC_ERR 同样是**可自愈**的：设备解帧时 CRC 失配 = 这一片没被接受，
          //   g_ota_accepted 不推进，故下面的窗口同步会从设备确认点整片重传 ——
          //   与"这一片丢了"完全等价。原实现把它当致命错误直接中止，
          //   于是链路上一次偶发误帧（解码器扫到伪 SOF 后解出一个失败帧）就能废掉整次升级。
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
    serialService.onObject(errorHandler)

    // 进度探针: 只带 offset、不带数据的 ota_chunk。固件对负载 ≤4B 走早期分支, 只回读
    // "已接受累计"(不写 flash)。这是唯一能主动催出 OTA 进度的手段 —— OTA_CHUNK 是被动响应,
    // 窗口同步若只是"停发干等", 就再不会有响应抵达, accepted 冻结, 必然假超时。
    const probeChunk = new Uint8Array(0)

    let sentBytes = 0
    let resendCount = 0
    // 上一次窗口同步时的设备确认量：用于判定链路是「在前进」还是「原地不动」
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

    for (let index = 0; index < totalChunks && !shouldStop;) {
      const start = index * uploadChunkSize
      const end = Math.min(start + uploadChunkSize, data.byteLength)
      const chunk = data.subarray(start, end)
      await serialService.sendCommand('ota_chunk', { offset: start, data: chunk })
      sentBytes = end
      index++
      // ★ 进度也改用 accepted 为基准：与上面的速率/ETA 同口径，且重传时不会倒退。
      //   上限锁 99% —— 数据全部确认后还有 ota_finish（队列排空 + esp_ota_end 校验
      //   + 设置启动分区），那段最长可达数十秒，这里到 100% 会让人误以为已完成。
      firmwareProgress.value = Math.min(99, Math.round((accepted / totalBytes) * 100))
      refreshTransferStats(accepted)

      // 每窗口同步一次: 确认固件已接受(含链路重传)
      if (index % WINDOW_SIZE === 0 || index === totalChunks) {
        // ★ 只在「设备尚未确认到窗口末尾」时才发探针。多数窗口的分片响应本身就带回
        //   total_written（见 errorHandler），于是零额外 RTT 通过。
        //   原实现无条件发探针 + 睡 20ms + 再看：每个窗口固定付 20ms 起步、响应丢了
        //   还要空转到 5s 上限 —— 250 个窗口就是 5s 打底，重传时再成倍放大。
        if (accepted < sentBytes && !shouldStop) {
          try {
            // 直接等响应（1 个 RTT），而不是"发一条 + 睡 20ms + 再看"。
            // 探针的响应体就是固件回的 (accepted, written)，拿来即权威进度。
            const probe = await sendCommandAndWait(
              'ota_chunk', { offset: accepted, data: probeChunk }, 2000)
            if (typeof probe.total_written === 'number') {
              accepted = Math.max(accepted, probe.total_written)
            }
          } catch {
            // 探针超时：不致命，交给下面的「未确认 -> 重传」分支
          }
        }
        if (shouldStop) break
        if (accepted < sentBytes) {
          // F-28: 有片未被接受 —— 从设备确认的 offset 处重传(不再是致命错误)
          // ★ 预算按「进展」重置：确认量前进了就清零，只有连续原地不动才算链路已死。
          if (accepted > lastProgressOffset) {
            lastProgressOffset = accepted
            resendCount = 0
          }
          if (++resendCount > MAX_RESEND_STALL) {
            shouldStop = true
            lastError = `重传次数超限: 已发 ${sentBytes} / 设备确认 ${accepted}` +
              `（连续 ${MAX_RESEND_STALL} 次原地不动` +
              (crcNackCount ? `，期间设备 CRC 失配 NACK ${crcNackCount} 次` : '') +
              '）。链路持续丢字节：检查设备侧 usb_rx 任务是否被高优先级任务饿死、' +
              '或 usb_serial_jtag 的 rx_buffer(16384B) 是否溢出。'
            break
          }
          console.warn(`[OTA] 链路重传 #${resendCount}: 已发 ${sentBytes} -> 回到 ${accepted}`)
          index = Math.floor(accepted / uploadChunkSize)
          sentBytes = index * uploadChunkSize
        } else {
          lastProgressOffset = accepted
          resendCount = 0
        }
      }
      // 前馈节流：未确认字节逼近设备 RX 环形缓冲时，主动让出事件循环。
      //   ★ 两个后端的丢字节机理不同，别混为一谈：
      //     · usb_serial_jtag 后端：OTA 期间周期性擦除 flash 扇区（单次数十 ms），
      //       期间 usb_rx 任务(prio 3) 被 250Hz 控制环等 prio 4/5 任务挤掉，
      //       rx_buffer(16384B) 填满即**静默丢字节** → 解码器错位 → 下一个能解出的帧
      //       CRC 失配 → 设备回 S_CRC_ERR。这正是"每 ~100 片坏一帧"的来源。
      //     · TinyUSB 后端：tu_edpt_stream_read_xfer 只在 FIFO 剩余 ≥ mps 时才挂传输，
      //       放不下时 USB 直接 NAK、由主机重发 —— 不会静默丢字节。
      //   ★ 顺带修正旧注释的数字错误：setTimeout(0/1) 在浏览器里被钳到 ~4ms 而非 1ms，
      //     所以固定"每 8 片让一次"实测要付约 2s；改为按落后量触发，正常时零开销。
      if (sentBytes - accepted >= INFLIGHT_YIELD_BYTES) {
        await new Promise(r => setTimeout(r, 0))
      }
    }

    serialService.removeObjectListener(errorHandler)
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
