<template>
  <v-dialog max-width="680" :model-value="modelValue" persistent @update:model-value="onUpdateModelValue">
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
        <v-alert
          v-if="!serial.connected && !busy"
          class="mb-3"
          color="info"
          density="compact"
          variant="tonal"
        >
          请先连接设备，再烧录外部模块固件。
        </v-alert>

        <v-file-input
          accept=".bin,application/octet-stream"
          clearable
          density="compact"
          hide-details="auto"
          label="选择模块固件镜像 (.bin)"
          :disabled="busy || !serial.connected"
          :model-value="file"
          prepend-icon="mdi-file"
          show-size
          variant="outlined"
          @update:model-value="onFileChange"
        />

        <div class="d-flex flex-wrap align-center ga-4 mt-3">
          <v-chip color="grey" prepend-icon="mdi-map-marker" size="small" variant="tonal">
            起始地址 0x000000（完整镜像）
          </v-chip>

          <v-switch
            color="error"
            density="compact"
            :disabled="busy"
            hide-details
            inset
            label="烧录前整片擦除"
            :model-value="eraseAll"
            @update:model-value="(v: unknown) => (eraseAll = !!v)"
          />
        </div>

        <v-alert class="mt-3" color="info" density="compact" variant="tonal">
          只支持完整镜像（merged：bootloader + 分区表 + app，从 0x000000 整片写入）；
          仅含 app 的镜像请走 ELRS 自身的 WiFi/OTA 更新。烧录期间通道输出中断，仅在地面操作。
        </v-alert>

        <v-alert
          v-if="eraseAll"
          class="mt-3"
          color="warning"
          density="compact"
          variant="tonal"
        >
          整片擦除会清空模块 flash 的全部内容（对频信息、NVS、WiFi 凭据等），烧完必须重新对频配置。
          擦除期间请勿断电；即使断电也不会变砖，重新烧一次即可。
        </v-alert>

        <div v-if="busy" class="mt-4">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">{{ phaseLabel || '处理中' }}</span>
            <span class="text-caption font-weight-medium">{{ progress }}%</span>
          </div>

          <v-progress-linear
            color="primary"
            height="10"
            :indeterminate="progress === 0"
            :model-value="progress"
            rounded
          />

          <div v-if="detail" class="text-caption text-medium-emphasis mt-1">{{ detail }}</div>
        </div>

        <v-alert
          v-if="error"
          class="mt-3"
          color="error"
          density="compact"
          variant="tonal"
        >{{ error }}</v-alert>

        <v-alert
          v-else-if="status"
          class="mt-3"
          color="success"
          density="compact"
          variant="tonal"
        >{{ status }}</v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="busy" variant="text" @click="close">关闭</v-btn>

        <v-btn
          color="warning"
          :disabled="!canStart"
          :loading="busy"
          prepend-icon="mdi-upload"
          variant="tonal"
          @click="startFlash"
        >
          开始烧录
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { BleService, serialService } from '@/services/SerialService'
  import { useSerialStore } from '@/stores/serial'
  import { decoderStats, FLASH_BEGIN_ERASE_ALL, STATUS_BUSY } from '@/utils/protocol'

  const props = defineProps<{ modelValue: boolean }>()
  const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void
    (e: 'done', summary: string): void
  }>()

  const serial = useSerialStore()

  /** 单片固件字节数（BLE 回退值）：固件 chunk_hint=240，单帧 250B 不会触发协议分片 */
  const DEFAULT_CHUNK_SIZE = 240
  /**
   * USB / 串口链路的分片大小：chunk_hint=240 是固件为 BLE 定的（避免 BLE 层再分片），
   * USB 没有 244B MTU 约束，沿用它会把 1.4MB 拆成 ~6000 次严格请求-响应往返。
   * 992 的取值依据：
   *   - payload = 2(cmd) + 4(offset) + 992 = 998 ≤ SINGLE_FRAME_MAX(1000) → 不触发协议分片
   *   - 整帧 = 10(header) + 998 = 1008B ≤ 固件侧一次读取上限 1023B（usb_channel 的 buf[1024]）
   *     → 整帧一次抽完，帧尾不会残留在 RX 队列里，零溢出风险
   * 往返次数降到 ~1450（1/4）。
   */
  const USB_CHUNK_SIZE = 992
  /** BEGIN 含目标侧擦除：整片擦除时 4MB 最长达 40s，超时给足 */
  const BEGIN_TIMEOUT_MS = 60_000
  /**
   * FE-09: 上一次会话中止后，固件在 **10s 内**仍把会话视为"忙碌"并以 `S_BUSY` 拒绝 BEGIN
   * （`lib/FwFlash/fw_flash.cpp` 的 `flashTryClaim()` 陈旧会话判定：idle < 10s → reject）。
   * 触发场景：上次中止时那条 ABORT 的**请求帧**丢了（USB 侧实测丢帧 1~7%），用户随即点重试。
   * 此时退避 2s × 6 次刚好盖住 10s 窗口，避免"立刻重试必然又失败"的观感。
   */
  const BEGIN_BUSY_RETRIES = 6
  const BEGIN_BUSY_BACKOFF_MS = 2000
  /** ABORT 是会话收尾命令：固件靠它释放会话所有权 + 复位目标，必须确认到响应 */
  const ABORT_TIMEOUT_MS = 5000
  /**
   * 单片超时。实测：成功单片 wait ≈ 100ms、send ≈ 3ms；失败单片必然耗满整个超时
   * （现场 max 恰好等于本值 3002ms）。所以本值直接就是失败代价，应贴着真实延迟取：
   *   平均单片耗时 = 成功率×(send+wait) + 失败率×本值
   *     3s  ：0.76×100 + 0.24×3000 ≈ 796ms/片 → 1.25 KB/s（实测 1.2 KB/s，吻合）
   *     0.8s：0.76×100 + 0.24×800  ≈ 268ms/片 → 3.7 KB/s
   * 实测（两轮对照，这是把机制钉死的证据）：
   *   超时 800ms → 迟到量 maxLate=1~2ms，maxTrip=804.7ms
   *   超时 1200ms → 迟到量 maxLate=3ms，maxTrip=1205.5ms
   * 即"真正响应时刻" = T + 1~3ms，跟着 T 一起动。设备自身卡顿不会这样：固定延迟
   * 下 T 变大迟到量应变小，固定绝对延迟下 T=1200 那轮该几乎不迟到。都不是。
   * 再看 late=29 / resync=29 / 未到=0 —— 每次超时都紧跟着一条迟到响应（100%）。
   * 超时那一刻主机唯一发出的东西是 resync() 的空包探针，1~3ms 正好是一个空包往返。
   * ⇒ 那些响应早就在设备里等着，是**探针的到达把它冲了出来**，设备侧从不真丢。
   * ⇒ 结论反过来：抬超时只是白等（实测 1200 反而从 3.8 掉到 2.8 KB/s），该往下降。
   * 降到 T 之后，"迟到"就变成"准时"，代价从 T 变成一次探针往返(≈36ms)+退避(20ms)。
   * 注意下限是真实分布：正常片 wait≈94ms，太贴近会把好片也误判成超时（不会错，
   * 但白跑一次 resync），所以配 latHist 直方图盯真实分布，再决定能压到多低。
   * 注：wait≈94ms 本身偏慢（1024B @460800 应约 22ms，@115200 约 89ms）—— 根因已定位，不必再猜：
   * lib/FwFlash/fw_flash.cpp:356 调的是 esp_loader_change_transmission_rate()（ROM 版），而
   * esp_loader.c:784 在该函数开头 `esp_stub_get_running()` 为真时直接回 UNSUPPORTED_FUNC；
   * 本会话走的是 esp_loader_connect_with_stub()，stub 确实在跑 ⇒ 提速必然失败、静默留在 115200。
   * 应改调 esp_loader_change_transmission_rate_stub(kConnectBaud, kFlashBaud)（条件相反）。
   * 提速修复后实测整轮 20KB/s（反推 w_s≈30ms），写死的超时必然不再贴身 —— 改为自适应：
   * 循环里按最近成功片 wait 的 p90×3 动态定预算（见 timeoutMs），本常量只作首几片的初值。
   */
  const CHUNK_TIMEOUT_MS = 100
  /** 自适应超时的上下限：下限防抖（低于 ~50ms 会被正常抖动打穿），上限防呆 */
  const CHUNK_TIMEOUT_MIN_MS = 50
  const CHUNK_TIMEOUT_MAX_MS = 300
  /** FINISH 含目标侧 MD5 校验 */
  const FINISH_TIMEOUT_MS = 90_000
  /** 进度查询（0 字节空包）超时：固件侧是纯查询不落 flash，不该慢 */
  const PROBE_TIMEOUT_MS = 3000
  /** 链路重同步次数上限：超过说明链路持续丢帧，不再无意义重试。
   *  取 800 的实测依据（2026-09-26 全量烧录 DJI M2 TX C3 E28 1.37MB 镜像：
   *  主机侧 1447 片、实测 227 次重同步 ≈ 15.7% 响应丢失）—— 400 的余量只有约 1.7 倍，
   *  而 USB 链路丢帧（F-34 家族）尚未根治。本常量只作「别对彻底断掉的链路无限重试」的
   *  兜底，不是丢帧率门限，故在丢帧率降到个位数百分比前保持 800。 */
  const MAX_RESYNCS = 800

  /** 写入起点固定 0x000000：只烧完整镜像(bootloader + 分区表 + app)，固件侧会拒绝其它值 */
  const MODULE_IMAGE_OFFSET = 0x00_00_00

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
  function onUpdateModelValue (v: boolean) {
    if (busy.value && !v) return
    emit('update:modelValue', v)
  }

  function close () {
    if (!busy.value) emit('update:modelValue', false)
  }

  function onFileChange (value: File | File[] | null) {
    file.value = Array.isArray(value) ? (value[0] ?? null) : value
    status.value = ''
    error.value = ''
    done.value = false
  }

  /** 等待某条命令的响应（一次性监听，收到或超时即注销） */
  function waitFor (cmd: string, timeoutMs: number): Promise<Record<string, unknown>> {
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

  async function sendAndWait (
    cmd: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const pending = waitFor(cmd, timeoutMs)
    await serialService.sendCommand(cmd, params)
    return pending
  }

  // ── 按 seq 精确匹配 CHUNK 响应 ──
  // 背景：一轮烧录要收发上千次 elrs_flash_chunk，而这些响应的 obj.cmd 完全相同。
  // 固件 dispatch_binary 构建响应时原样回显请求帧头的 seq，所以 seq 才是"这一片的应答"
  // 的唯一标识；binaryHandler 已把它带在 obj.seq 上，sendCommand() 则返回请求帧的 seq。
  //
  // 为什么必须按 seq 取：只按 cmd 匹配时，一旦某片超时，它那条迟到的响应会被下一次
  // waitFor 当成新应答。主机据此推进 sent，就会跑到设备实际进度前面 —— 而固件
  // flashWrite() 要求 offset == sOffset + sAccepted，错位即 flashAbort()
  // （lib/FwFlash/fw_flash.cpp:434）。也就是说串片一次不是"变慢"，而是必然把会话搞崩。
  //
  // 为什么用"先收集再取"而不是"先注册再发"：响应可能先于 sendCommand() 返回到达
  // （设备极快时 IPC 回包比 await 更快），届时监听还没挂上，响应就丢了。
  /** 已收到但尚未取走的 chunk 响应（含 seq） */
  let pendingChunks: Array<Record<string, unknown>> = []
  /** 新响应到达时的通知（严格请求-响应，同一时刻只有一个等待者） */
  let onNewChunk: (() => void) | null = null
  /** 兜底上限：seq 只有 8 位会回绕，堆积的陈旧响应可能与未来的 seq 撞号 */
  const MAX_PENDING_CHUNKS = 4

  // ── 超时的两种成因必须分开：迟到（设备只是慢，调超时即可）vs 真丢（设备→主机
  // 方向掉帧，要查 TX 截断 / 日志混流）。记下每个超时 seq 的时刻，若它之后仍然到达
  // 就计一次迟到 —— 这是 USB 烧录期间拿不到设备日志时唯一能区分两者的手段。
  /** 链路诊断开关：true 时在控制台打印每 8 片的详细统计，并在进度行末尾追加
   *  send/wait 拆分、重同步/迟到/未到、最迟延迟、解码器计数等字段。这些都是为定位
   *  "提速失败"和"响应被扣死"加的，对使用者是噪音，排查完保持 false。
   *  注意：统计量本身照常累加，与开关无关，所以打开开关即可复现完整信息。 */
  const FLASH_DIAG = false

  const timedOutAt = new Map<number, number>()
  const MAX_TIMED_OUT = 256 // seq 只有 8 位，超过一轮就没有判别意义
  let lateHits = 0
  /** 迟到响应的最大延迟。只有最大值能暴露"卡顿到底有多长"，也就决定超时该设多少：
   *  若最迟≈810ms 说明只有 801ms 这一档（抬超时即可）；若达数千 ms 说明还有更长的一档。
   *  前 5 条只打日志看不全，所以必须全量取最大值。 */
  let maxLateMs = 0

  function chunkCollector (obj: Record<string, unknown>): void {
    if (obj.cmd !== 'elrs_flash_chunk') return
    const s = Number(obj.seq)
    const t0 = timedOutAt.get(s)
    if (t0 !== undefined) {
      timedOutAt.delete(s)
      lateHits++
      const lateMs = performance.now() - t0
      if (lateMs > maxLateMs) maxLateMs = lateMs
      if (FLASH_DIAG && lateHits <= 5) {
        console.warn(`[Flash] 迟到响应 seq=${s}，迟了 ${lateMs.toFixed(0)}ms`)
      }
    }
    pendingChunks.push(obj)
    if (pendingChunks.length > MAX_PENDING_CHUNKS) pendingChunks.shift()
    onNewChunk?.()
  }

  /** 取走 seq 对应的那条响应；尚未到达则等待，超时返回 null */
  function takeChunk (seq: number, timeoutMs: number): Promise<Record<string, unknown> | null> {
    return new Promise(resolve => {
      const pick = (): Record<string, unknown> | undefined => {
        const i = pendingChunks.findIndex(o => Number(o.seq) === seq)
        return i === -1 ? undefined : pendingChunks.splice(i, 1)[0]
      }
      const hit = pick()
      if (hit) {
        resolve(hit); return
      }
      const timer = setTimeout(() => {
        onNewChunk = null
        // 登记本次超时，供 chunkCollector 判定它到底是"迟到"还是"真丢"
        if (timedOutAt.size >= MAX_TIMED_OUT) timedOutAt.clear()
        timedOutAt.set(seq, performance.now())
        resolve(null)
      }, timeoutMs)
      onNewChunk = () => {
        const got = pick()
        if (!got) return
        clearTimeout(timer)
        onNewChunk = null
        resolve(got)
      }
    })
  }

  /**
   * 查询固件侧真实已接收字节数：发一个 0 字节的 CHUNK 空包。
   * 固件 flashWrite() 的 len==0 分支在校验 offset 之前就返回 sAccepted
   * （lib/FwFlash/fw_flash.cpp:426），所以这是纯状态查询：既不写 flash，
   * 也不会因 offset 错位触发 flashAbort()，可以安全地用于丢包后的断点续传。
   * @returns 已接收字节数；设备无响应或会话已结束时返回 null
   */
  async function queryAccepted (): Promise<number | null> {
    const seq = await serialService.sendCommand('elrs_flash_chunk', {
      offset: 0,
      data: new Uint8Array(0),
    })
    // seq 缺失（未连接/未知命令）时退回按 cmd 匹配的老行为
    const probe = seq === undefined
      ? await waitFor('elrs_flash_chunk', PROBE_TIMEOUT_MS).catch(() => null)
      : await takeChunk(seq, PROBE_TIMEOUT_MS)
    if (!probe || probe.ok !== true) return null
    const n = Number(probe.accepted_total)
    return Number.isFinite(n) ? n : null
  }

  async function startFlash () {
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
      // FE-09: `S_BUSY` 表示固件侧"上一会话尚未释放"（10s 空闲窗口内），不是真故障 ——
      // 退避重试即可，别让用户看到"中止后立刻重试必然失败"（见 BEGIN_BUSY_* 注释）。
      let begin: Record<string, unknown> | null = null
      for (let attempt = 0; attempt < BEGIN_BUSY_RETRIES; attempt++) {
        const resp = await sendAndWait('elrs_flash_begin', {
          offset,
          image_size: data.byteLength,
          flags: eraseAll.value ? FLASH_BEGIN_ERASE_ALL : 0,
        }, BEGIN_TIMEOUT_MS)
        if (resp.ok === true) {
          begin = resp
          break
        }
        if (Number(resp.status) !== STATUS_BUSY) {
          throw new Error(String(resp.error || '烧录初始化失败'))
        }
        const leftS = ((BEGIN_BUSY_RETRIES - attempt - 1) * BEGIN_BUSY_BACKOFF_MS) / 1000
        phaseLabel.value = `设备仍在结束上一次烧录会话，${BEGIN_BUSY_BACKOFF_MS / 1000}s 后重试…（最多再等 ${leftS}s）`
        await new Promise(r => setTimeout(r, BEGIN_BUSY_BACKOFF_MS))
      }
      if (!begin) throw new Error('烧录初始化失败：设备会话未释放，请等十几秒后再试')
      sessionOpen = true

      // 分片大小按链路介质选: chunk_hint(240) 是固件为 BLE 定的 —— 避免 BLE 层再分片。
      // USB/串口没有 MTU 约束, 而"片数"就是严格请求-响应的往返次数, 每片都要白等一次
      // 设备轮询 + IPC 往返, 所以 USB 放大到 USB_CHUNK_SIZE（往返次数降到约 1/4）。
      const isBle = serialService instanceof BleService
      const chunkSize = isBle
        ? (Number(begin.chunk_hint ?? DEFAULT_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE)
        : USB_CHUNK_SIZE
      const eraseMs = Number(begin.erase_ms ?? 0)
      if (eraseMs > 0) detail.value = `已整片擦除（${(eraseMs / 1000).toFixed(1)}s）`

      // 2) CHUNK：串行逐片，offset 严格续接（固件会校验，错位即中止会话）
      //    USB 链路没有 BLE 那种写入重试，单片的请求帧/响应帧丢一次就会让整次烧录失败，
      //    所以这里自己做丢帧自愈：超时后先问固件真实进度，再决定重发还是跳过（对齐 BLE 的重试思路）。
      phaseLabel.value = '写入中…'
      const total = data.byteLength
      let sent = 0
      let chunks = 0
      let resyncs = 0
      // 计时诊断: "发送耗时"(上位机→设备) 与 "等待耗时"(设备处理 + 响应回传) 分开统计,
      // 用于分辨瓶颈在链路还是设备侧块刷写 (1024B @460800 ≈ 22ms + ROM ACK)
      let sumSendMs = 0
      let sumWaitMs = 0
      let maxTripMs = 0
      // ── 响应延迟直方图 ──
      // 均值分不出"设备本来就慢"和"回包被扣住"：前者是连续分布，后者是双峰。
      // 分档边界按**当前超时**的比例切，不写死。提速前 w_s≈94ms、提速后 ≈30ms，写死的
      // 边界在提速后会把所有正常片挤进第一档，直方图彻底失去分辨力。按 T 缩放则永远贴身：
      //   <0.3T 正常簇 | 0.3-0.6T | 0.6-1.0T ← 警戒区(它堆量 = T 切进了真实分布)
      //   | 1.0-1.3T 超时片(被探针放出来的) | >1.3T
      // 实测(T=300, 提速前) lat=[63,1,0,10,0]：正常片全在最低档、中间档是空的
      // ⇒ 那 10 次不是"设备慢"(慢是连续分布, 中间档一定会堆量), 是响应被扣住了。
      // 必须显式给初值生成器: Array.from({length:5}) 推断成 {}[]，.fill(0) 也不会收窄类型
      const latHist = Array.from({ length: 5 }, () => 0)
      const bucketOf = (ms: number): number => {
        const edges = [timeoutMs * 0.3, timeoutMs * 0.6, timeoutMs, timeoutMs * 1.3]
        for (let i = 0; i < edges.length; i++) if (ms < (edges[i] ?? 0)) return i
        return edges.length
      }
      // 迭代计数器: 循环体每次执行必走 chunks++ 或 resyncs++，所以 iter 必须恒等于
      // chunks+resyncs。三者对不上就说明有重复迭代（resync 让 sent 倒退）。
      let iter = 0
      // ── 自适应超时 ──
      // 提速把 w_s 从 ~94ms 打到 ~30ms，写死的常量只会越来越离谱（要么白等要么误判）。
      // 取最近 16 片**成功**片 wait 的 p90 × 3 作为下一片的超时预算：
      //   · 只吃成功片 —— 卡顿片（被探针放出来的）若计入，T 会被自己越撑越大；
      //   · 取 p90 而非 max —— max 会被偶发抖动钉死在一个偏高的值上；
      //   · ×3 留余量；且误判代价本身也随 T 下降（重同步成本 = T + 探针 + 退避），
      //     所以 T 偏小的最坏情况只是多跑一次 resync，不会丢数据。
      const recentWaits: number[] = []
      let timeoutMs = CHUNK_TIMEOUT_MS
      const adaptTimeout = (waitMs: number): void => {
        recentWaits.push(waitMs)
        if (recentWaits.length > 16) recentWaits.shift()
        if (recentWaits.length < 4) return // 样本太少，先沿用初值
        const s = [...recentWaits].sort((a, b) => a - b)
        const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] ?? 0
        const next = Math.round(p90 * 3)
        timeoutMs = Math.max(CHUNK_TIMEOUT_MIN_MS, Math.min(CHUNK_TIMEOUT_MAX_MS, next))
      }
      const tStart = performance.now()
      /** 实时速率 + 剩余时间预估 */
      const rateText = (n: number): string => {
        const elapsedMs = performance.now() - tStart
        if (elapsedMs <= 0 || n <= 0) return '--'
        const kb = (n / 1024) / (elapsedMs / 1000)
        const etaS = Math.ceil(((total - n) / 1024) / kb)
        return `${kb.toFixed(1)} KB/s · 剩余约 ${etaS}s`
      }
      /**
       * 进度行末尾的诊断后缀。send/wait 拆分、重同步/迟到/未到、最迟延迟、解码器计数
       * 只在排查链路卡顿时有意义，对使用者是噪音，故默认不显示（见 FLASH_DIAG）。
       * 统计量本身照常累加，打开开关即可完整复现，不需要重新收集。
       */
      const diagSuffix = (): string => {
        if (!FLASH_DIAG) return ''
        const parts: string[] = []
        if (chunks >= 8) {
          parts.push(`send ${(sumSendMs / iter).toFixed(1)} / wait ${(sumWaitMs / iter).toFixed(1)} ms`)
        }
        // 重同步次数直接反映丢片率；迟到/未到把"设备慢"和"链路掉帧"分开
        if (resyncs > 0) parts.push(`重同步 ${resyncs} · 迟到 ${lateHits} / 未到 ${timedOutAt.size}`)
        // 最迟延迟 = 卡顿的真实量级，用来判定 CHUNK_TIMEOUT_MS 该定多少
        if (maxLateMs > 0) parts.push(`最迟 ${maxLateMs.toFixed(0)}ms`)
        // 解码器计数 = 丢帧根因的判别式：半帧复位>0 说明设备 TX 被截断（已自愈）；
        // CRC失败>0 说明帧被 ESP_LOG 混流插花；两者都 0 说明设备压根没回
        if (decoderStats.idleResets > 0 || decoderStats.crcFails > 0 || decoderStats.logBytes > 0) {
          const { idleResets, crcFails, logBytes } = decoderStats
          parts.push(`半帧复位 ${idleResets} / CRC失败 ${crcFails} / 非帧 ${logBytes}B`)
        }
        return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
      }
      // 响应收集器必须在任何一次下发之前挂上，否则先于 sendCommand() 返回的响应会丢
      pendingChunks = []
      timedOutAt.clear()
      lateHits = 0
      maxLateMs = 0
      // 解码器计数清零。logBytes 是"USB 口里有没有非帧文本(系统日志)"的判据 ——
      // 它和 idleResets/crcFails 互补: 日志若只落在帧与帧之间, 那两个恒为 0。
      decoderStats.idleResets = 0
      decoderStats.crcFails = 0
      decoderStats.logBytes = 0
      decoderStats.logSample = ''
      serialService.onObject(chunkCollector)

      /** 丢帧/串片后的对齐：丢弃陈旧响应 → 问设备真实进度 → 重排 sent */
      const resync = async (): Promise<number> => {
        // 已超时那一片的响应随时可能补到，它属于旧片，留着会污染后续匹配
        pendingChunks = []
        const accepted = await queryAccepted()
        if (accepted === null) throw new Error(`第 ${chunks + 1} 片无响应，链路重同步失败`)
        resyncs++
        if (resyncs > MAX_RESYNCS) throw new Error(`链路丢帧过多（重同步 ${resyncs} 次），已中止`)
        const aligned = accepted - offset
        progress.value = Math.floor((aligned / total) * 100)
        // 丢帧后进度可能倒退（resync 把 sent 拉回设备真实位置），所以速率/剩余时间要重算
        detail.value = `已下发 ${aligned} / ${total} 字节 · ${rateText(aligned)}` + diagSuffix()
        // 稍作退避，给链路一点恢复时间（对齐 BLE 的退避重试）
        await new Promise(r => setTimeout(r, 20))
        return aligned
      }

      while (sent < total) {
        const end = Math.min(sent + chunkSize, total)
        const t0 = performance.now()
        const seq = await serialService.sendCommand('elrs_flash_chunk', {
          offset: offset + sent,
          data: data.subarray(sent, end),
        })
        const t1 = performance.now()
        // 只认本次请求 seq 的那条响应；超时预算扣掉已花在发送上的时间
        const resp = seq === undefined
          ? await waitFor('elrs_flash_chunk', timeoutMs).catch(() => null)
          : await takeChunk(seq, Math.max(1, timeoutMs - (t1 - t0)))
        const t2 = performance.now()
        iter++
        sumSendMs += t1 - t0
        sumWaitMs += t2 - t1
        if (t2 - t0 > maxTripMs) maxTripMs = t2 - t0
        // 分档直方图只服务于 FLASH_DIAG，关掉就不必逐片归类
        if (FLASH_DIAG) {
          const bucket = bucketOf(t2 - t1)
          latHist[bucket] = (latHist[bucket] ?? 0) + 1
        }

        if (resp === null) {
          // 超时：请求帧丢了（设备没收到）或响应帧丢了（设备已写入）。
          // 注意不能盲目重发本片 —— 若设备其实已接受，重发会撞上 offset mismatch
          // 导致固件 flashAbort()。先用空包问出真实进度，再对齐。
          sent = await resync()
          continue
        }

        if (resp.ok !== true) throw new Error(String(resp.error || `第 ${chunks + 1} 片写入失败`))

        // 用响应自带的 accepted_total 校验双方是否仍对齐：
        // 固件 sAccepted 从 0 起、每片 += len（lib/FwFlash/fw_flash.cpp:383），
        // 写完本片后应恰好等于 end。不等说明这条响应不是本片的（迟到/串片），
        // 照常推进 sent 就会跑到设备前面，下一次下发必然 offset mismatch
        // → flashAbort()（同文件 :434）。这里按丢帧处理是最稳的。
        const gotAccepted = Number(resp.accepted_total)
        if (Number.isFinite(gotAccepted) && gotAccepted !== end) {
          sent = await resync()
          continue
        }

        sent = end
        chunks++
        adaptTimeout(t2 - t1) // 自适应超时只吃成功片
        progress.value = Math.floor((sent / total) * 100)
        detail.value = `已下发 ${sent} / ${total} 字节 · ${rateText(sent)}` + diagSuffix()
        if (FLASH_DIAG && chunks % 8 === 0) {
          // acc vs elapsed 对账: 累计 send+wait 必然 ≤ 真实 elapsed（每段都在 [tStart,now]
          // 内且不重叠）。若 acc > elapsed，说明 sumWaitMs 被多计，wait 均值不可信。
          // T = 自适应超时的当前值，它贴着 w_s 的 3 倍走才说明模型对得上。
          // lat = wait 分档(相对 T): <0.3 / 0.3-0.6 / 0.6-1.0 / 1.0-1.3 / >1.3
          // idleReset/crcFail/logBytes = 丢帧根因判别式：半帧复位>0 说明设备 TX 被截断
          //   （已自愈）；CRC失败>0 说明帧被 ESP_LOG 混流插花；两者都 0 但 logBytes>0
          //   说明日志只落在帧与帧之间 —— 同样挤占 TX，且此前完全不可见。
          const parts = [
            `${chunks}/${Math.ceil(total / chunkSize)} 片`,
            `avg send=${(sumSendMs / iter).toFixed(2)}ms wait=${(sumWaitMs / iter).toFixed(2)}ms`,
            `max=${maxTripMs.toFixed(1)}ms resync=${resyncs} late=${lateHits}`,
            `maxLate=${maxLateMs.toFixed(0)}ms`,
            `iter=${iter} acc=${((sumSendMs + sumWaitMs) / 1000).toFixed(1)}s`,
            `elapsed=${((performance.now() - tStart) / 1000).toFixed(1)}s`,
            `T=${timeoutMs}`,
            `lat=[${latHist.join(',')}]`,
            `idleReset=${decoderStats.idleResets} crcFail=${decoderStats.crcFails}`,
            `logBytes=${decoderStats.logBytes}`,
            decoderStats.logSample
              ? `[${decoderStats.logSample.slice(0, 80).replace(/\n/g, '|')}]`
              : '',
            rateText(sent),
          ]
          console.log(`[Flash] ${parts.filter(Boolean).join(' ')}`)
        }
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
      // 无日志时的关键诊断: FINISH 回报的 chunks = 真正写进 flash 的 1024B 块数,
      // 用它把总耗时摊到每块上, 就能直接反推链路实际波特率 ——
      // 1024B 块的 SLIP 帧约 1042B ≈ 10420 bit, @460800 线速 22.6ms/块, @115200 约 90ms/块。
      // 所以这行能一眼看出"握手后提速"到底成没成(失败会静默留在 115200)。
      const blocks = Number(fin.chunks ?? chunks) || chunks
      const writeMs = Math.max(0, Number(fin.elapsed_ms ?? 0) - eraseMs)
      const perBlockMs = blocks > 0 ? writeMs / blocks : 0
      const baudText = perBlockMs > 0
        ? `，写入 ${(writeMs / 1000).toFixed(1)}s · ${perBlockMs.toFixed(1)}ms/块 ≈ ${Math.round(10_420 / (perBlockMs / 1000) / 1000)}k baud`
        : ''
      // 迟到占比是判断根因的关键：迟到多 = 设备侧慢（调超时/查波特率）；
      // 真丢多 = 设备→主机方向掉帧（查 TX 截断与日志混流）
      const lostHits = Math.max(0, resyncs - lateHits)
      const resyncText = resyncs > 0 ? `，链路重同步 ${resyncs} 次（迟到 ${lateHits} / 真丢 ${lostHits}）` : ''
      // 半帧复位 / CRC 失败：丢帧根因的判别式，写进摘要才不会随进度行消失
      const decoderText = (decoderStats.idleResets > 0 || decoderStats.crcFails > 0)
        ? `，半帧复位 ${decoderStats.idleResets} / CRC失败 ${decoderStats.crcFails}`
        : ''
      const summary = `烧录完成：${String(fin.total_written ?? total)} 字节 / ${blocks} 块 / ${secs}s，${md5Text}${baudText}${resyncText}${decoderText}`
      status.value = summary
      done.value = true
      phaseLabel.value = ''
      emit('done', summary)
    } catch (error_) {
      error.value = `烧录失败: ${error_ instanceof Error ? error_.message : String(error_)}`
      // 失败必须补一条 ABORT：否则被暂停的流不会恢复、ELRS 可能停在下载模式。
      // FE-09: 必须**等响应**并在未确认时重试一次 —— 原来只 sendCommand() 不等回包，
      // 那条帧一丢固件侧所有权就不释放，随后 10s 内的重试会被 BEGIN 拒为 S_BUSY。
      if (sessionOpen) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const ack = await sendAndWait('elrs_flash_abort', undefined, ABORT_TIMEOUT_MS)
            if (ack.ok === true) break
            throw new Error(String(ack.error || 'abort 未确认'))
          } catch (abortErr) {
            if (attempt === 1) console.error('[Flash] abort 未确认，设备可能停在下载模式:', abortErr)
            else await new Promise(r => setTimeout(r, 200))
          }
        }
      }
      phaseLabel.value = ''
    } finally {
      serialService.removeObjectListener(chunkCollector)
      busy.value = false
    }
  }
</script>
