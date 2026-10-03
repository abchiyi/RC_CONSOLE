<template>
  <div class="ft-page">
    <v-snackbar v-model="snackbarVisible" :color="snackbarColor" :timeout="noticeTimeout" variant="tonal">
      {{ snackbarMsg }}
    </v-snackbar>

    <v-toolbar color="transparent" density="compact">
      <v-btn
        class="mr-1"
        icon="mdi-arrow-left"
        size="small"
        variant="text"
        @click="router.push('/system')"
      />

      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-clipboard-check-outline</v-icon>
        出厂测试
      </v-toolbar-title>

      <template #append>
        <v-chip :color="serial.connected ? 'success' : 'grey'" size="x-small" variant="tonal">
          {{ linkLabel }}
        </v-chip>

        <!-- 射频模块通讯质量: TX=上行(本机发射侧统计) / RX=下行(本机接收统计) —— 现场一眼看模组是否在好好通讯 -->
        <template v-if="serial.connected">
          <v-chip v-if="linkStale" color="grey" size="x-small" variant="tonal">
            射频 RSSI 无数据
          </v-chip>

          <template v-else>
            <v-chip :color="lqColor(link.ulLq)" size="x-small" variant="tonal">
              TX {{ rssiText(link.ulRssi) }} dBm · {{ link.ulLq }}%
            </v-chip>

            <v-chip :color="lqColor(link.dlLq)" size="x-small" variant="tonal">
              RX {{ rssiText(link.dlRssi) }} dBm · {{ link.dlLq }}%
            </v-chip>
          </template>
        </template>
      </template>
    </v-toolbar>

    <v-alert
      v-if="!serial.connected"
      border="start"
      border-color="primary"
      class="ma-3"
      color="primary"
      icon="mdi-information"
      variant="tonal"
    >
      请先连接待测试的设备
    </v-alert>

    <div v-else class="ft-root">
      <!-- ── 总览 ── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" :color="headColor" size="36">
              <v-icon color="white" size="20">{{ headIcon }}</v-icon>
            </v-avatar>
          </template>

          <v-card-title>测试总览</v-card-title>

          <v-card-subtitle>
            {{ deviceLabel }} · {{ info.hw ? 'HW ' + info.hw : '未知硬件' }}
          </v-card-subtitle>

          <template #append>
            <v-chip v-if="busy" color="info" size="x-small" variant="tonal">测试进行中</v-chip>

            <v-chip
              v-else
              :color="overallPass ? 'success' : counts.fail ? 'error' : 'grey'"
              size="x-small"
              variant="tonal"
            >
              {{ headline }}
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="ft-sum-grid">
            <div class="ft-sum ft-sum-pass">
              <div class="ft-sum-num mono">{{ counts.pass }}</div>
              <div class="ft-sum-label">通过</div>
            </div>

            <div class="ft-sum ft-sum-warn">
              <div class="ft-sum-num mono">{{ counts.warn }}</div>
              <div class="ft-sum-label">警告</div>
            </div>

            <div class="ft-sum ft-sum-fail">
              <div class="ft-sum-num mono">{{ counts.fail }}</div>
              <div class="ft-sum-label">失败</div>
            </div>

            <div class="ft-sum ft-sum-total">
              <div class="ft-sum-num mono">{{ counts.total }}</div>
              <div class="ft-sum-label">总项</div>
            </div>
          </div>

          <!-- 进度条只反映自动项; 人工项在下方单列, 免得没测时进度条永远走不满 -->
          <v-progress-linear
            class="mt-3"
            :color="counts.fail ? 'error' : 'success'"
            height="4"
            :model-value="progress"
            rounded
          />

          <div class="ft-progress-note">
            自动项 {{ autoCounts.done }}/{{ autoCounts.total }} 完成 · 按钮与旋钮：{{ inputVerdictLabel }}
          </div>

          <div class="d-flex flex-wrap ga-2 mt-3">
            <v-btn
              color="primary"
              :loading="busy"
              prepend-icon="mdi-play-circle"
              size="small"
              variant="tonal"
              @click="runAll"
            >
              <span class="btn-text">扫描自动项</span>
            </v-btn>

            <v-btn
              class="btn-secondary"
              :disabled="busy"
              prepend-icon="mdi-restart"
              size="small"
              @click="resetAll"
            >
              <span class="btn-text">清空结果</span>
            </v-btn>
          </div>
        </v-card-text>
      </v-card>

      <!-- ── MCU eFuse 状态（只读，产线核对烧录 / 锁定结果） ── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-fuse</v-icon>
            </v-avatar>
          </template>

          <v-card-title>MCU eFuse 状态</v-card-title>
          <v-card-subtitle>安全保护 / USB 通道 / 调试接口的熔丝位</v-card-subtitle>

          <template #append>
            <v-btn
              color="grey"
              :loading="efuseLoading"
              prepend-icon="mdi-refresh"
              size="small"
              variant="text"
              @click="fetchEfuse"
            >
              刷新
            </v-btn>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div v-if="efuseError" class="ft-tag-hint">{{ efuseError }}</div>

          <div v-else class="efuse-grid">
            <div v-for="row in efuseRows" :key="row.name" class="efuse-row">
              <div class="efuse-name">{{ row.name }}</div>
              <div class="efuse-desc">{{ row.desc }}</div>
              <v-chip :color="row.color" size="x-small" variant="tonal">{{ row.value }}</v-chip>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- ── 出厂锁定: 锁定为 Release 模式（不可撤销） ── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="error" size="36">
              <v-icon color="white" size="20">mdi-lock</v-icon>
            </v-avatar>
          </template>

          <v-card-title>出厂锁定</v-card-title>
          <v-card-subtitle>固化为 Release 模式（不可撤销）</v-card-subtitle>

          <template #append>
            <v-chip :color="lockStateColor" size="x-small" variant="tonal">{{ lockStateLabel }}</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="ft-tag-hint mb-2">
            锁定后仅接受官方签名固件，关闭调试接口并切换 USB 通道（设备重启、端口变化）。
          </div>

          <v-btn
            block
            color="error"
            :disabled="info.secure !== 1"
            :loading="lockBusy"
            prepend-icon="mdi-lock-check"
            variant="tonal"
            @click="lockDialog = true"
          >
            <span class="btn-text">锁定为 Release 模式</span>
          </v-btn>
        </v-card-text>
      </v-card>

      <!-- 交互操作提示: 批量扫描运行期间高亮 -->
      <v-alert
        v-if="instruction"
        class="mb-2 ft-instruction"
        color="primary"
        density="compact"
        icon="mdi-hand-back-right"
        variant="tonal"
      >
        <div class="ft-instruction-inner">
          <span class="ft-instruction-text">{{ instruction }}</span>
          <v-progress-linear color="primary" height="2" indeterminate rounded />
        </div>
      </v-alert>

      <!-- ── 按钮 / 旋钮标签面板（键盘测试式: 实时扫描, 按下 / 转动即亮） ── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="secondary" size="36">
              <v-icon color="white" size="20">mdi-keyboard</v-icon>
            </v-avatar>
          </template>

          <v-card-title>按钮与旋钮</v-card-title>
          <v-card-subtitle>按下 / 转动对应输入，标签亮起</v-card-subtitle>

          <template #append>
            <v-chip :color="allVerified ? 'success' : 'grey'" size="x-small" variant="tonal">
              已验证 {{ verifiedCount }}/{{ tags.length }}
            </v-chip>

            <v-chip :color="streamAlive ? 'success' : 'grey'" size="x-small" variant="tonal">
              {{ streamAlive ? `${frameRate} 帧/秒` : '无数据流' }}
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="ft-tag-grid">
            <div
              v-for="t in tags"
              :key="t.id"
              class="ft-tag"
              :class="tagStateClass(t)"
            >
              <div class="ft-tag-name">{{ t.name }}</div>
            </div>
          </div>

          <!-- 实时扫描: 无需开测, 进页即统计; 全部触发过 → 自动判定通过 -->
          <div class="d-flex flex-wrap ga-2 align-center mt-3">
            <v-chip
              v-if="inputVerdict"
              :color="inputVerdict === 'pass' ? 'success' : 'error'"
              size="small"
              variant="tonal"
            >
              {{ inputVerdictLabel }} · {{ inputSummary }}
            </v-chip>

            <v-spacer />

            <v-btn
              color="grey"
              prepend-icon="mdi-refresh"
              size="small"
              variant="tonal"
              @click="resetMonitor"
            >
              重置
            </v-btn>

            <v-btn
              color="error"
              prepend-icon="mdi-close"
              size="small"
              variant="tonal"
              @click="markFail"
            >
              标记失败
            </v-btn>
          </div>

        </v-card-text>
      </v-card>

      <!-- ── 模拟输入观察（扳机 / 摇杆 / IMU，仅供人工看，不参与判定） ── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="py-2">
          <v-card-title class="text-body-2">模拟输入观察</v-card-title>

          <template #append>
            <v-chip color="grey" size="x-small" variant="tonal">仅供观察，不参与判定</v-chip>

            <v-chip :color="analogSupported ? 'success' : 'grey'" size="x-small" variant="tonal">
              {{ analogSupported ? '有数据' : '固件未上报' }}
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-0 pb-3">
          <v-tabs v-model="analogTab" class="ft-tabs" color="primary" density="compact">
            <v-tab value="sticks">扳机 / 摇杆</v-tab>
            <v-tab value="imu">IMU</v-tab>
          </v-tabs>

          <v-window v-model="analogTab" class="mt-3">
            <v-window-item value="sticks">
              <div class="ft-analog-grid">
                <div v-for="r in ANALOG_ROWS" :key="r.key" class="ft-analog">
                  <div class="ft-analog-head">
                    <span class="ft-analog-name">{{ r.name }}</span>
                    <span class="mono ft-analog-val">{{ analogText(r) }}</span>
                  </div>

                  <div class="ft-analog-bar">
                    <div class="ft-analog-fill" :style="{ width: analogPct(r) + '%' }" />
                  </div>
                </div>
              </div>

            </v-window-item>

            <v-window-item value="imu">
              <!-- 传感器页那张 IMU 卡原样复用: 数据换成出厂测试帧里的 IMU 扩展段 -->
              <ImuCard
                :imu="imuObserve"
                :show-bias="false"
                :show-zero-hint="false"
                subtitle="实时三轴姿态与传感器读数"
                title="IMU"
              />

              <div class="ft-tag-hint">
                {{
                  analogSupported
                    ? '转动机身看视窗与读数是否跟着动 —— 只反映实时读数，不作为合格判据'
                    : '当前固件未在出厂测试帧里上报 IMU 数据（需升级固件），不影响按钮与旋钮检测'
                }}
              </div>
            </v-window-item>
          </v-window>
        </v-card-text>
      </v-card>

      <!-- ── 测试项 ── -->
      <v-card
        v-for="g in groups"
        :key="g.group"
        class="cal-card my-2"
        elevation="0"
        rounded="lg"
        variant="outlined"
      >
        <v-card-item class="py-0">
          <v-card-title class="text-body-2">{{ g.group }}</v-card-title>
        </v-card-item>

        <v-card-text class="pt-1 pb-2">
          <div v-for="it in g.items" :key="it.id" class="ft-row" @click.stop="runOne(it)">
            <div class="ft-row-main">
              <div class="ft-row-title">
                {{ it.name }}
                <v-icon v-if="it.interactive" class="ft-row-badge" size="12">mdi-hand-back-right</v-icon>
                <v-icon v-if="it.manual" class="ft-row-badge" size="12">mdi-account-check-outline</v-icon>
              </div>

              <div class="ft-row-sub">{{ it.detail }}</div>
            </div>

            <div class="ft-row-right">
              <span class="mono ft-row-val">{{ it.value || '--' }}</span>

              <v-chip :color="statusColor(it.status)" size="x-small" variant="tonal">
                {{ statusLabel(it.status) }}
              </v-chip>

              <v-btn
                :disabled="busy"
                icon="mdi-play"
                :loading="it.status === 'running'"
                size="x-small"
                variant="text"
                @click.stop="runOne(it)"
              />
            </div>
          </div>

          <!-- 射频组专属: 直接复用 ELRS 页的字段树组件 —— 扫描到什么就渲染什么 -->
          <template v-if="g.group === '射频'">
            <v-divider class="my-2" />

            <div class="d-flex align-center ga-2 mb-1">
              <span class="text-caption">ELRS 参数字段</span>

              <v-chip :color="link.moduleAlive ? 'success' : 'grey'" size="x-small" variant="tonal">
                {{ link.fieldsLoading ? '扫描中…' : `${link.fields.length} 项参数` }}
              </v-chip>

              <v-spacer />

              <v-btn
                :disabled="link.fieldsLoading"
                :loading="link.fieldsLoading"
                prepend-icon="mdi-refresh"
                size="x-small"
                variant="text"
                @click="scanElrs"
              >
                重扫
              </v-btn>
            </div>

            <div v-if="!link.moduleAlive" class="ft-tag-hint">
              {{
                link.fieldsLoading
                  ? '正在重新发现模块参数，完成后自动列出…'
                  : '模块未上电、未烧固件或未完成字段发现，可点「重扫」再试'
              }}
            </div>

            <ElrsFieldTree
              v-else
              :key="link.fieldsVersion"
              :fields="link.fields"
              :pending-values="link.pendingValues"
              :running-commands="link.runningCommands"
              :updating-id="elrsUpdatingFieldId"
              @set="applyElrsFieldValue"
            />
          </template>
        </v-card-text>
      </v-card>

      <!-- 锁定为 Release 模式确认: 不可撤销, 需明确说明 -->
      <v-dialog v-model="lockDialog" max-width="460" persistent>
        <v-card>
          <v-card-title class="text-body-1">锁定为 Release 模式</v-card-title>

          <v-card-text>
            锁定后设备只接受官方签名固件，将关闭调试接口并切换 USB 通道
            （设备重启后端口会变化，需重新连接）。此操作烧写 eFuse，不可撤销。
          </v-card-text>

          <v-alert
            v-if="lockError"
            class="mx-4 mb-2"
            color="error"
            density="compact"
            variant="tonal"
          >
            {{ lockError }}
          </v-alert>

          <v-card-actions>
            <v-spacer />

            <v-btn
              :disabled="lockBusy"
              variant="text"
              @click="lockDialog = false"
            >
              取消
            </v-btn>

            <v-btn
              color="error"
              :loading="lockBusy"
              variant="tonal"
              @click="startLockSecure"
            >
              确认锁定
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import ImuCard from '@/components/calibration/ImuCard.vue'
  import ElrsFieldTree from '@/components/elrs/ElrsFieldTree.vue'
  import { useNotice } from '@/composables/useNotice'
  import { serialService } from '@/services/SerialService'
  import type { ImuCal } from '@/stores/calibration'
  import { type ElrsFieldInfo, useLinkStatsStore } from '@/stores/linkStats'
  import { useSerialStore } from '@/stores/serial'
  import { OWNER, releaseStream, requestStream } from '@/stores/stream'
  import { STREAM_FACTORY } from '@/utils/protocol'
  import { RequestResponseHandler } from '@/utils/requestResponse'

  const router = useRouter()
  const serial = useSerialStore()
  const link = useLinkStatsStore()

  const { text: snackbarMsg, color: snackbarColor, visible: snackbarVisible, show: notify, timeoutMs: noticeTimeout }
    = useNotice(2000)

  const linkLabel = computed(() => {
    if (!serial.connected) return '未连接'
    return serial.isBluetooth ? '蓝牙链路' : 'USB 链路'
  })

  // ========== 命令收发 ==========
  const rr = new RequestResponseHandler()

  /**
   * 发命令并等待响应。
   * main.ts 会把同一帧路由给对应 Store（更新各自缓存），这里额外注册了一个监听器，
   * 只负责 resolve 本页自己的等待 —— 两者互不影响。
   */
  function ask (cmd: string, timeoutMs = 3000, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const p = rr.wait(cmd, timeoutMs) as Promise<Record<string, unknown>>
    return serialService.sendCommand(cmd, params).then(() => p)
  }

  function sleep (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ========== 数据流活性 ==========
  // 扳机 / 摇杆 / IMU 的行程观测已移除（人工在设备侧确认），这里只统计帧率、
  //   用来在按钮 / 旋钮面板上指示「设备数据是在跑的」。
  const streamFrames = ref(0)
  const lastFrameMs = ref(0)
  let frameWin: number[] = []
  const frameRate = ref(0)
  let rateTimer: ReturnType<typeof setInterval> | null = null

  const streamAlive = computed(() => Date.now() - lastFrameMs.value < 1500 && streamFrames.value > 0)

  /** 只统计帧率: 本页已不再展示行程 / 姿态读数，帧率仅作「设备在线」指示（通道帧也算） */
  function applyStreamEvent (): void {
    streamFrames.value++
    lastFrameMs.value = Date.now()
    frameWin.push(lastFrameMs.value)
  }

  function onObject (obj: Record<string, unknown>): void {
    const cmd = obj.cmd as string | undefined
    if (cmd) rr.tryResolve(cmd, obj)

    if (obj.evt !== 0x00_01) return
    // 本页只跑出厂测试流（content_type=5）：帧里直接带按钮原始电平 / 旋钮累计格数，
    //   不需要通道流。漏掉这一支会让整个面板收不到任何数据（见 applyFactoryEvent）。
    if (obj.contentType === STREAM_FACTORY) applyFactoryEvent(obj.data as Record<string, unknown>)
  }

  /** 页面存活标志: 离页后禁止再登记流请求（见 useFactoryStream） */
  let pageAlive = true

  // ========== 出厂测试流观测（按钮 / 旋钮专用） ==========
  /**
   * 只用一种观测口径: 出厂测试流 (content_type=5, 固件 STREAM_CT_FACTORY)。
   *   帧里带**原始输入状态**: 按钮电平位图 / 边沿 / 按下次数 + 旋钮累计格数，都由固件
   *   直读按钮库回调与 PCNT 得到，不经 CRSF 输出链路、不看模型配置。于是按下即亮、
   *   松手即灭，短按也不漏，模型没配挡位也照测 —— 这才是键盘测试该有的样子。
   *
   *   ★ 不再兼容「普通通道流 (content_type=0) 看挡位变化」的老口径: 那条路分不清
   *     「没挂通道 / 没配挡位 / 配成了长按」，产线上会把配置问题误判成硬件坏。
   *     固件不认 content_type=5 时本页直接报「出厂测试流未就绪」，不再静默降级。
   */
  /** 旋钮转动后的闪亮时长: 转一下就亮一下 */
  const FLASH_MS = 700

  interface InputTag {
    id: string
    name: string
    source: string
    kind: 'button' | 'knob'
    /** 在原始电平位图里的位号 = 固件 InputSource 枚举 id（与 INPUT_SOURCE_NAMES 一致） */
    bit: number
    /**
     * 在 press[] 里的下标 = 固件 **Button 枚举值**。
     * ★ 与 bit 不是一回事: Button 枚举是 POWER=0 / LOCK=1 / MH=2 / EC11_BTN=3 / SHOT=4，
     *   而电平位图里 POWER 单列 bit15、其余用 InputSource id。两者只在前四项上恰好相等，
     *   POWER 必须按下标 0 取，按 bit 取会取到 press[15]（恒 undefined）。
     */
    pressIndex?: number
    /** 硬件键但不对应任何输入源（POWER 键）: 按机型裁剪清单时无条件保留 */
    standalone?: boolean
    /** 该输入源作为**主源**挂在通道 source 表里的索引; -1 = 没挂到任何通道（仅供显示） */
    index: number
    /** 亮灯 */
    active: boolean
    /** 上一帧的按下状态（press 缺失时用它兜底计上升沿） */
    pressed: boolean
    /** 上一帧的旋钮累计格数 */
    lastKnob: number | null
    hits: number
    until: number
  }

  /**
   * 默认清单: 4 个按键 + 1 个旋钮，实际以 get_info 的 input_sources 为准。
   * bit 必须与固件 config.h 的 InputSource 枚举 id 对齐（改动时两边一起改）。
   */
  const INPUT_TAGS: Array<{
    id: string, name: string, source: string, kind: 'button' | 'knob', bit: number
    pressIndex?: number, standalone?: boolean
  }> = [
    { id: 'lock', name: 'LOCK', source: 'BUTTON_LOCK', kind: 'button', bit: 1, pressIndex: 1 },
    { id: 'mh', name: 'MH', source: 'BUTTON_MH', kind: 'button', bit: 2, pressIndex: 2 },
    { id: 'ec11btn', name: 'EC11 键', source: 'BUTTON_EC11_BTN', kind: 'button', bit: 3, pressIndex: 3 },
    { id: 'shot', name: 'SHOT', source: 'BUTTON_SHOT', kind: 'button', bit: 4, pressIndex: 4 },
    // POWER: 没有对应 InputSource（不参与输入映射），电平位图单列 bit15，press[] 下标却是 0
    { id: 'power', name: 'POWER', source: '', kind: 'button', bit: 15, pressIndex: 0, standalone: true },
    { id: 'knob', name: 'EC11 旋钮', source: 'KNOB_EC11', kind: 'knob', bit: 10 },
  ]

  function buildTags (allow: Set<string> | null): InputTag[] {
    // standalone（POWER）不在 input_sources 里: 无条件保留，否则按机型裁剪后它连标签都没有，
    //   产线上就漏了这一个（也是最该测的一个 —— 短按能不能正常释放）。
    return INPUT_TAGS
      .filter(t => !allow || allow.has(t.source) || t.standalone)
      .map(t => ({
        ...t, index: -1, active: false, pressed: false,
        lastKnob: null, hits: 0, until: 0,
      }))
  }

  const tags = ref<InputTag[]>(buildTags(null))
  /** 最近一帧出厂测试数据的时间戳 —— 判断这条流到底有没有起来 */
  let tagAt = 0

  // ========== 模拟输入观察（扳机 / 摇杆 / IMU） ==========
  /**
   * 这一组只**摆读数**，明确不参与判定:
   *   - 不计 hits、不进 verifiedCount，按钮与旋钮的「已验证 x/y」与它无关；
   *   - 合格与否要人在现场推一遍看方向手感，数字只能说明「有没有动、动到哪」，
   *     写进自动判定容易把校准前的偏移误判成故障。
   * 数据在出厂测试帧尾的扩展段（新固件才有）；旧固件不上报，面板提示「固件未上报」。
   */
  interface AnalogRow {
    key: string
    name: string
    /** adc = 扳机 / 摇杆原始采样（12-bit）; deg = IMU 姿态（度） */
    kind: 'adc' | 'deg'
  }

  const ANALOG_ROWS: AnalogRow[] = [
    { key: 'trigger', name: '扳机', kind: 'adc' },
    { key: 'joy_x', name: '摇杆 X', kind: 'adc' },
    { key: 'joy_y', name: '摇杆 Y', kind: 'adc' },
  ]

  const analog = reactive<Record<string, number | null>>({
    trigger: null, joy_x: null, joy_y: null,
  })
  /** 帧里有没有带上扩展段（旧固件没有） */
  const analogSupported = ref(false)
  /** 「扳机 / 摇杆」与「IMU」两个选项卡: IMU 单独一页, 复用传感器页那张 IMU 卡 */
  const analogTab = ref('sticks')

  /** IMU 读数: 结构与 ImuCard 的输入一致, 数据来自出厂测试帧尾的扩展段 */
  const imuObserve = reactive<ImuCal>({
    roll: undefined, pitch: undefined, yaw: undefined,
    acc: { x: undefined, y: undefined, z: undefined },
    rate: { x: undefined, y: undefined, z: undefined },
  })

  /** 位置条占满百分比: ADC 取 0~4095，姿态按 ±180° 摊平 */
  function analogPct (row: AnalogRow): number {
    const v = analog[row.key]
    if (typeof v !== 'number') return 0
    const pct = row.kind === 'adc' ? (v / 4095) * 100 : ((v + 180) / 360) * 100
    return Math.min(100, Math.max(0, pct))
  }

  function analogText (row: AnalogRow): string {
    const v = analog[row.key]
    if (typeof v !== 'number') return '--'
    return row.kind === 'adc' ? String(v) : `${v.toFixed(1)}°`
  }

  function applyAnalog (a: Record<string, number | undefined> | undefined): void {
    if (!a) return
    for (const row of ANALOG_ROWS) analog[row.key] = a[row.key] ?? null
    // IMU: 姿态 + 加速度 / 角速度（后者新固件才追加，旧帧没有就保持上 undefined → 显示 --）
    imuObserve.roll = a.roll
    imuObserve.pitch = a.pitch
    imuObserve.yaw = a.yaw
    if (a.acc_x !== undefined) imuObserve.acc = { x: a.acc_x, y: a.acc_y, z: a.acc_z }
    if (a.rate_x !== undefined) imuObserve.rate = { x: a.rate_x, y: a.rate_y, z: a.rate_z }
    analogSupported.value = true
  }

  /**
   * 消费出厂测试帧: 按钮看电平位图与累计按下次数，旋钮看 PCNT 累计格数 ——
   *   两者都不依赖模型把输入挂到哪个通道、有没有配触发挡位。
   */
  function applyFactoryEvent (data: Record<string, unknown>): void {
    const srcs = Array.isArray(data.sources) ? data.sources as string[] : null
    const rawLevel = typeof data.btnLevel === 'number' ? data.btnLevel : null
    const rawKnob = typeof data.knob === 'number' ? data.knob : null
    const rawPress = Array.isArray(data.press) ? data.press as number[] : null
    // 缺原始输入字段的帧判废: 宁可不更新，也不要把缺失字节静默读成「全松开」
    if (!srcs || rawLevel === null || rawKnob === null) return

    // 本页从进到出就是这一条流: 「设备在线」指示（帧率）也由它承担
    applyStreamEvent()
    tagAt = Date.now()

    // 实时扫描: 亮灯 / 计数常态进行，不再需要「开始监测」开关
    for (const t of tags.value) {
      t.index = srcs.indexOf(t.source)

      // ── 按钮: 按下即亮、松手即灭，一帧内按下又松开的也记得到 ──
      if (t.kind === 'button') {
        const was = t.pressed
        t.pressed = !!(rawLevel & (1 << t.bit))
        t.active = t.pressed
        // 次数优先用固件回调累计的计数（比本地数上升沿准）；老帧没有 press 时兜底自数
        //   ★ 取 pressIndex（Button 枚举下标）而不是 bit —— POWER 的 bit15 与下标 0 对不上
        if (rawPress) t.hits = rawPress[t.pressIndex ?? t.bit] ?? t.hits
        else if (t.pressed && !was) t.hits++
        continue
      }

      // ── 旋钮: 固件累计格数（与通道映射无关，没挂通道也测得出来）──
      if (t.lastKnob === null) t.lastKnob = rawKnob
      else if (rawKnob !== t.lastKnob) {
        t.hits++
        t.until = tagAt + FLASH_MS
        t.lastKnob = rawKnob
      }
      t.active = tagAt < t.until
    }
    // 摇杆 / IMU 只刷新读数，不进 hits、不影响上面任何判定
    applyAnalog(data.analog as Record<string, number> | undefined)

    // 自动判定: 全部输入都触发过 → 直接记通过。
    //   只在还没有结论时写一次; 「标记失败」后不被覆盖（重置后才可重测）。
    if (inputVerdict.value === null && allVerified.value) {
      inputSummary.value = `${verifiedCount.value}/${tags.value.length} 全部触发`
      inputVerdict.value = 'pass'
      notify(`按钮与旋钮自动判定通过 · ${inputSummary.value}`, 'success')
    }
  }

  /**
   * 标签三档视觉状态（同一主题色、只拉透明度，避免乱色干扰「还剩几个没测」的判断）:
   *   最亮 = 此刻按下 / 转动中 → 中间档 = 触发过（松手后留在这里）→ 常规色 = 从未触发。
   * hits 是「本次开测累计」，所以进入「已触发」就一直亮着到测试结束 —— 一眼数得出漏了哪几个。
   */
  function tagStateClass (t: InputTag): string {
    if (t.active) return 'ft-tag-live'
    if (t.hits > 0) return 'ft-tag-seen'
    return ''
  }

  /**
   * 测试页**专用**流: content_type=5（出厂测试专用，带原始输入状态），本页从进到出
   *   只占这一条，不降级、不切换到普通通道流。
   * 平时 50ms（省带宽），监测期间提到 20ms（按键手感更跟手）；只改 interval，
   *   不换 content_type —— 固件侧仍是同一条流的原地替换。
   */
  function useFactoryStream (intervalMs: number): void {
    // 离页后不得再登记: 挂起的手动判定被取消时，它的 finally 还会走一次这里，
    //   若无此闸门会在 releaseStream 之后又占回一条流（别的页面拿不到数据）。
    if (!pageAlive) return
    requestStream({ owner: OWNER.FACTORY, content_type: STREAM_FACTORY, interval_ms: intervalMs, flags: 0 })
  }

  // ========== 设备信息摘要 ==========
  const info = reactive({ device: '', hw: '', fw: '', secure: 0 })
  const deviceLabel = computed(() => info.device || '未知设备')

  // ========== MCU eFuse 状态（只读，产线核对烧录 / 锁定结果） ==========
  const efuseLoading = ref(false)
  const efuseError = ref('')
  /** eFuse 关键位状态；null = 固件未回报该字段 */
  const efuse = reactive({
    usb_phy_sel: null as boolean | null,        // false=USB Serial/JTAG, true=USB OTG(TinyUSB)
    dis_usb_jtag: null as boolean | null,       // 已禁用 USB JTAG
    dis_usb_serial_jtag: null as boolean | null, // 已禁用 USB Serial/JTAG
    flash_crypt_cnt: null as number | null,     // 0=未加密 1=Development 3=Release
    secure_boot_en: null as boolean | null,     // secure boot 已启用
    dis_download_mode: null as boolean | null,  // 已禁用下载模式
    secure_mode: null as number | null,         // 冗余，与 get_info 一致
    switch_status: null as number | null,       // USB_PHY_SEL 烧写结果: 0=未尝试 1=已烧 2=失败
    switch_err: null as number | null,          // 烧写失败时的 esp_err_t
  })

  function toBool (v: unknown): boolean | null {
    if (v === null || v === undefined) return null
    if (typeof v === 'boolean') return v
    return Number(v) !== 0
  }

  function toInt (v: unknown): number | null {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  async function fetchEfuse (): Promise<void> {
    efuseLoading.value = true
    efuseError.value = ''
    try {
      const o = await ask('get_efuse', 3000)
      if (o.ok === false) {
        efuseError.value = String(o.error ?? '设备不支持读取 eFuse')
        return
      }
      efuse.usb_phy_sel = toBool(o.usb_phy_sel)
      efuse.dis_usb_jtag = toBool(o.dis_usb_jtag)
      efuse.dis_usb_serial_jtag = toBool(o.dis_usb_serial_jtag)
      efuse.flash_crypt_cnt = toInt(o.flash_crypt_cnt)
      efuse.secure_boot_en = toBool(o.secure_boot_en)
      efuse.dis_download_mode = toBool(o.dis_download_mode)
      efuse.secure_mode = toInt(o.secure_mode)
      efuse.switch_status = toInt(o.switch_status)
      efuse.switch_err = toInt(o.switch_err)
    } catch (error: unknown) {
      efuseError.value = error instanceof Error ? error.message : '读取 eFuse 超时'
    } finally {
      efuseLoading.value = false
    }
  }

  interface EfuseRow { name: string, desc: string, value: string, color: string }

  const efuseRows = computed<EfuseRow[]>(() => {
    const onOff = (v: boolean | null, on: string, off: string, onColor: string, offColor: string) =>
      ({ value: v === null ? '未知' : (v ? on : off), color: v === null ? 'grey' : (v ? onColor : offColor) })

    const crypt = efuse.flash_crypt_cnt
    const cryptMap: Record<number, string> = { 0: '未启用', 1: 'Development', 3: 'Release' }
    const secureMap = ['未启用', '开发模式', '已启用']

    return [
      {
        name: 'USB PHY', desc: '内部 PHY 归属（决定走 USB Serial/JTAG 还是 TinyUSB CDC）',
        value: efuse.usb_phy_sel === null ? '未知' : (efuse.usb_phy_sel ? 'USB OTG (TinyUSB)' : 'USB Serial/JTAG'),
        color: efuse.usb_phy_sel === null ? 'grey' : (efuse.usb_phy_sel ? 'info' : 'grey'),
      },
      { name: 'USB JTAG', desc: 'USB Serial/JTAG 调试口', ...onOff(efuse.dis_usb_jtag, '已禁用', '启用中', 'success', 'warning') },
      { name: 'USB Serial/JTAG', desc: '整块 USB Serial/JTAG 外设', ...onOff(efuse.dis_usb_serial_jtag, '已禁用', '启用中', 'success', 'grey') },
      {
        name: 'Flash 加密', desc: 'flash encryption 计数',
        value: crypt === null ? '未知' : (cryptMap[crypt] ?? `cnt=${crypt}`),
        color: crypt === null ? 'grey' : (crypt === 3 ? 'success' : (crypt === 1 ? 'warning' : 'grey')),
      },
      { name: 'Secure Boot', desc: '只接受签名固件', ...onOff(efuse.secure_boot_en, '已启用', '未启用', 'success', 'grey') },
      { name: '下载模式', desc: 'UART/USB 烧录入口', ...onOff(efuse.dis_download_mode, '已禁用', '允许', 'warning', 'grey') },
      {
        name: '安全模式', desc: '设备上报的 secure_mode',
        value: efuse.secure_mode === null ? '未知' : (secureMap[efuse.secure_mode] ?? '未知'),
        color: efuse.secure_mode === 2 ? 'success' : (efuse.secure_mode === 1 ? 'warning' : 'grey'),
      },
      {
        name: 'USB 切换', desc: 'USB_PHY_SEL 烧写结果（release 机器应切到 TinyUSB）',
        value: efuse.switch_status === null
          ? '未知'
          : (efuse.switch_status === 1
            ? '已烧写'
            : (efuse.switch_status === 2 ? `烧写失败 err=${efuse.switch_err ?? 0}` : '未尝试')),
        color: efuse.switch_status === 1 ? 'success' : (efuse.switch_status === 2 ? 'error' : 'grey'),
      },
    ]
  })

  // ========== 出厂锁定（锁定为 Release 模式） ==========
  const lockBusy = ref(false)
  const lockDialog = ref(false)
  const lockError = ref('')

  /** 0=未加密 1=Development 2=Release（与 get_info 的 secure_mode 一致） */
  const lockStateLabel = computed(() => {
    switch (info.secure) {
      case 0: return '未启用'
      case 1: return '开发模式'
      case 2: return '已锁定'
      default: return '未知'
    }
  })
  const lockStateColor = computed(() => {
    switch (info.secure) {
      case 0: return 'grey'
      case 1: return 'warning'
      case 2: return 'success'
      default: return 'grey'
    }
  })

  /** 仅 Development（secure_mode=1）可锁定；锁定后设备烧 eFuse 并重启、切换 USB 通道 */
  async function startLockSecure (): Promise<void> {
    lockBusy.value = true
    lockError.value = ''
    try {
      const resp = await ask('lock_secure', 8000)
      if (resp.ok === true) {
        lockDialog.value = false
        notify('已锁定为 Release 模式，设备重启后请重新连接', 'success')
        // 设备即将重启并切换 USB 通道，端口必然失效：延迟释放，等 ACK 落地
        setTimeout(() => { void serial.disconnect({ releasePort: true }) }, 1300)
      } else {
        lockError.value = `锁定失败: ${String(resp.error || '未知错误')}`
      }
    } catch (error: unknown) {
      lockError.value = `锁定失败: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      lockBusy.value = false
    }
  }

  // ========== 测试用例 ==========
  type TestStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn'

  interface TestResult {
    status: TestStatus
    value?: string
    detail?: string
  }

  interface TestItem {
    id: string
    name: string
    group: string
    desc: string
    /** 需要人工操作手柄: 会给出操作提示并实时显示读数 */
    interactive?: boolean
    /** 结论由操作者判定（阈值只给参考），而不是自动下结论 */
    manual?: boolean
    status: TestStatus
    value: string
    detail: string
    run: () => Promise<TestResult>
  }

  const busy = ref(false)
  const instruction = ref('')

  function setInstruction (s: string): void {
    instruction.value = s
  }

  function clearInstruction (): void {
    instruction.value = ''
  }

  // ── 通讯与固件 ──
  async function tPing (): Promise<TestResult> {
    const t0 = performance.now()
    try {
      await ask('ping', 3000)
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
    const ms = Math.round(performance.now() - t0)
    return { status: ms <= 1000 ? 'pass' : 'warn', value: `${ms} ms` }
  }

  async function tInfo (): Promise<TestResult> {
    try {
      const o = await ask('get_info', 3000)
      if (o.ok === false) return { status: 'fail', detail: String(o.error ?? '未知错误') }
      info.device = String(o.device ?? '')
      info.hw = String(o.hw_version ?? '')
      info.fw = String(o.fw_version ?? '')
      info.secure = Number(o.secure_mode ?? 0)
      const ch = Number(o.channel_count ?? 0)
      return {
        status: ch >= 16 ? 'pass' : 'warn',
        value: `${info.hw} / ${info.fw}`,
        detail: `通道 ${ch} · 输入映射 ${Number(o.input_src_count ?? 0)} 项`,
      }
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
  }

  async function tNvs (): Promise<TestResult> {
    try {
      const o = await ask('get_config', 5000)
      if (o.ok === false) return { status: 'fail', detail: String(o.error ?? '未知错误') }
      const models = Array.isArray(o.models) ? o.models.length : 0
      return { status: models > 0 ? 'pass' : 'warn', value: `${models} 个模型` }
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
  }

  async function tCalData (): Promise<TestResult> {
    try {
      const o = await ask('cal_get', 3000)
      if (o.ok === false) return { status: 'fail', detail: String(o.error ?? '未知错误') }
      return { status: 'pass', value: '可读' }
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
  }

  async function tSecure (): Promise<TestResult> {
    if (!info.device) {
      try {
        await tInfo()
      } catch {
      // 由下方统一判定
      }
    }
    const map = ['未启用', '开发模式', '已启用'] as const
    return {
      status: info.secure === 0 ? 'pass' : 'warn',
      value: map[info.secure] ?? '未知',
      detail: '出厂态应为「未启用」，由用户自行开启安全保护',
    }
  }

  // ── 电源 ──
  async function readPower (): Promise<Record<string, unknown>> {
    const o = await ask('get_power_state', 3000)
    if (o.ok === false) throw new Error(String(o.error ?? '设备返回错误'))
    return o
  }

  async function tPmu (): Promise<TestResult> {
    try {
      const o = await readPower()
      const sys = Number(o.sys_mv ?? 0)
      const batt = Number(o.battery_mv ?? 0)
      const vbus = Number(o.vbus_mv ?? 0)
      if (sys <= 0) {
        return {
          status: 'fail',
          value: 'SYS = 0 mV',
          detail: 'PMU 无有效读数：BQ25895 未应答会中断整条 hardware_init（摇杆/IMU/按键全部不初始化）',
        }
      }
      return {
        status: 'pass',
        value: `${(sys / 1000).toFixed(2)} V`,
        detail: `系统电压 SYS · 电池 ${(batt / 1000).toFixed(2)} V · VBUS ${(vbus / 1000).toFixed(2)} V`,
      }
    } catch (error: unknown) {
      return {
        status: 'fail',
        detail: `${(error as Error).message} —— PMU 未应答时 firmware 会中止后续全部外设初始化`,
      }
    }
  }

  async function tBattery (): Promise<TestResult> {
    try {
      const o = await readPower()
      const mv = Number(o.battery_mv ?? 0)
      const level = Number(o.battery_level ?? 0)
      if (mv <= 0) return { status: 'warn', value: '未检出', detail: '未接电池或电池座未导通' }
      if (mv < 3000 || mv > 4300) return { status: 'fail', value: `${(mv / 1000).toFixed(2)} V`, detail: '电压超出 3.0~4.3 V 合理区间' }
      return { status: 'pass', value: `${(mv / 1000).toFixed(2)} V`, detail: `电量档位 ${level} / 4` }
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
  }

  async function tVbus (): Promise<TestResult> {
    try {
      const o = await readPower()
      const vbus = Number(o.vbus_mv ?? 0)
      const type = Number(o.vbus_type ?? 0)
      if (vbus >= 4000) return { status: 'pass', value: `${(vbus / 1000).toFixed(2)} V`, detail: `输入类型 ${type}` }
      return { status: 'warn', value: `${(vbus / 1000).toFixed(2)} V`, detail: '未检测到 USB 输入' }
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
  }

  // ── 按钮 / 旋钮（面板内实时扫描 + 自动判定） ──

  /**
   * 自动判定口径: 按钮 hits>0、旋钮转过格 —— 只看「动过没有」，与挂没挂通道、
   * 有没有配挡位无关。判定结果交给下方的 verifiedCount / allVerified。
   */
  const verifiedCount = computed(() => tags.value.filter(t => t.hits > 0).length)
  const allVerified = computed(() => tags.value.length > 0 && verifiedCount.value === tags.value.length)

  /** 人工结论: null = 还没测 */
  const inputVerdict = ref<'pass' | 'fail' | null>(null)
  const inputSummary = ref('')
  const inputVerdictLabel = computed(() => {
    if (inputVerdict.value === 'pass') return '已通过'
    return inputVerdict.value === 'fail' ? '未通过' : '未检测'
  })

  /** 重置: 清计数与结论，重新扫一轮（保留机型裁剪后的清单与通道挂载信息，不清 index） */
  function resetMonitor (): void {
    for (const t of tags.value) {
      t.active = false
      t.pressed = false
      t.lastKnob = null
      t.hits = 0
      t.until = 0
    }
    inputVerdict.value = null
    inputSummary.value = ''
  }

  /**
   * 人工兜底: 自动判定只看「每个输入动过没有」，判不出卡滞 / 连击 / 误触发这类
   *   质量问题 —— 操作者发现异常时手动标记失败，优先级高于自动通过（重置后才清掉）。
   */
  function markFail (): void {
    inputVerdict.value = 'fail'
    inputSummary.value = `人工标记 · ${verifiedCount.value}/${tags.value.length} 已触发`
    notify(`按钮与旋钮已标记为未通过 · ${inputSummary.value}`, 'error')
  }

  // ── 射频 ──
  // 字段发现是模块上电后的异步过程（模块要一个个回报参数才建成树），
  //   只读一次 field_count 计数必然漏判 —— 这里无条件触发重新扫描：
  //   进页 / 恢复连接自动开扫，点播放键也重扫；扫到的字段实时写进 linkStats store，
  //   下方面板直接复用 ELRS 页的字段树组件渲染（扫到什么就显示什么）。
  /** 单次重新扫描的等待上限: 够跑完一轮发现，又不至于让产线干等 */
  const ELRS_SCAN_TIMEOUT_MS = 12_000

  /** 正在写入的字段 id（传给字段树做忙碌态） */
  const elrsUpdatingFieldId = ref<number | null>(null)

  /** 重新扫描字段: 无条件清固件缓存重建；已在扫描中时忽略，避免并发打乱发现队列 */
  function scanElrs (): void {
    if (!serial.connected || link.fieldsLoading) return
    void link.rescanFields(ELRS_SCAN_TIMEOUT_MS).catch(() => {
      /* 断连 / 命令失败: 保留上一次已渲染的字段，不打扰面板 */
    })
  }

  /** 字段树写入: 与 ELRS 页同一套乐观更新 + 回读确认，提示复用本页 snackbar */
  async function applyElrsFieldValue (payload: { field: ElrsFieldInfo, value: number }): Promise<void> {
    const { field, value } = payload
    elrsUpdatingFieldId.value = field.id
    try {
      const ok = await link.setParam(field.id, value)
      if (ok) notify(field.type === 13 ? `已发送 ${field.name}` : `已写入 ${field.name}`)
      else notify(`写入失败: ${field.name}`, 'error')
    } catch {
      notify(`写入失败: ${field.name}`, 'error')
    }
    elrsUpdatingFieldId.value = null
  }

  async function tElrs (): Promise<TestResult> {
    try {
      // 无条件重扫而非只读缓存计数: 出厂 / 换过高频头 / 刷过固件都会让缓存残缺，
      //   只轮询计数会把「还没发现完」判成「模块没有字段」。
      await link.rescanFields(ELRS_SCAN_TIMEOUT_MS)
      const fc = link.fields.length
      if (fc > 0) return { status: 'pass', value: `${fc} 个字段`, detail: '模块已响应，参数字段见下方面板' }
      return { status: 'warn', value: '无字段', detail: '模块未上电、未烧固件或未完成字段发现' }
    } catch (error: unknown) {
      return { status: 'fail', detail: (error as Error).message }
    }
  }

  // ── 顶部链路质量指示（TX / RX 的 RSSI 与 LQ）──
  //   本页不能起链路流（content_type=3）: 固件是单流会话，起链路流会把出厂测试流顶掉，
  //   按钮 / 旋钮面板的实时数据立刻断供 —— 所以这里改为 1s 轮询 get_link_stats，
  //   命令响应由 main.ts 顺带写进 linkStats store，本页只负责发起与标注"这次没读到"。
  const LINK_POLL_MS = 1000
  /** 本次轮询没读到有效链路统计: 顶部读数置灰（不用时间差判过期，省一个 tick） */
  const linkStale = ref(true)
  let linkPollTimer: ReturnType<typeof setTimeout> | null = null

  async function pollLinkQuality (): Promise<void> {
    try {
      const o = await ask('get_link_stats', 900)
      linkStale.value = !o.valid
    } catch {
      linkStale.value = true
    }
  }

  /** 自调度轮询: 上一轮彻底结束才排下一轮，避免同一命令分槽互相取代 */
  function scheduleLinkPoll (): void {
    if (linkPollTimer) clearTimeout(linkPollTimer) // 幂等: 连接抖动重复调用不会叠一组定时器
    if (!pageAlive || !serial.connected) return
    linkPollTimer = setTimeout(async () => {
      await pollLinkQuality()
      scheduleLinkPoll()
    }, LINK_POLL_MS)
  }

  /** RSSI 带符号显示: 正值补 '+', 负值保留 '-' */
  function rssiText (v: number): string {
    return v > 0 ? `+${v}` : `${v}`
  }

  /** LQ 配色: >80 绿 / >50 黄 / 其余红（与 ELRS 页同一口径） */
  function lqColor (lq: number): string {
    return lq > 80 ? 'success' : (lq > 50 ? 'warning' : 'error')
  }

  const items = ref<TestItem[]>([
    {
      id: 'ping', name: '通讯往返', group: '通讯与固件', desc: 'ping 往返时延',
      status: 'idle', value: '', detail: 'ping 往返时延', run: tPing,
    },
    {
      id: 'info', name: '设备信息', group: '通讯与固件', desc: '读取型号 / 硬件版本 / 固件版本',
      status: 'idle', value: '', detail: '读取型号 / 硬件版本 / 固件版本', run: tInfo,
    },
    {
      id: 'nvs', name: 'NVS 配置读取', group: '通讯与固件', desc: 'get_config 读取 8 模型槽位',
      status: 'idle', value: '', detail: 'get_config 读取 8 模型槽位', run: tNvs,
    },
    {
      id: 'cal', name: '校准数据读取', group: '通讯与固件', desc: 'cal_get 读取校准与曲线',
      status: 'idle', value: '', detail: 'cal_get 读取校准与曲线', run: tCalData,
    },
    {
      id: 'secure', name: '安全模式', group: '通讯与固件', desc: '出厂态应为「未启用」',
      status: 'idle', value: '', detail: '出厂态应为「未启用」', run: tSecure,
    },
    {
      id: 'pmu', name: '电源管理 (BQ25895)', group: '电源', desc: 'PMU 应答与系统电压',
      status: 'idle', value: '', detail: 'PMU 应答与系统电压', run: tPmu,
    },
    {
      id: 'battery', name: '电池电压', group: '电源', desc: '合理区间 3.0 ~ 4.3 V',
      status: 'idle', value: '', detail: '合理区间 3.0 ~ 4.3 V', run: tBattery,
    },
    {
      id: 'vbus', name: 'USB 输入检测', group: '电源', desc: 'VBUS ≥ 4.0 V',
      status: 'idle', value: '', detail: 'VBUS ≥ 4.0 V', run: tVbus,
    },
    {
      id: 'elrs', name: 'ELRS 模块', group: '射频', desc: '外部射频模块字段发现',
      status: 'idle', value: '', detail: '外部射频模块字段发现', run: tElrs,
    },
  ])

  const groups = computed(() => {
    const order: string[] = []
    const map = new Map<string, TestItem[]>()
    for (const it of items.value) {
      if (!map.has(it.group)) {
        map.set(it.group, [])
        order.push(it.group)
      }
      map.get(it.group)?.push(it)
    }
    return order.map(g => ({ group: g, items: map.get(g) ?? [] }))
  })

  const counts = computed(() => {
    let pass = 0
    let fail = 0
    let warn = 0
    for (const it of items.value) {
      switch (it.status) {
        case 'pass': {
          pass++
          break
        }
        case 'fail': {
          fail++
          break
        }
        case 'warn': { {
                         warn++
                         // No default
                       }
                       break
        }
      }
    }
    return { pass, fail, warn, total: items.value.length }
  })

  /** 是否已有结论（未跑的项是 idle，不算已测） */
  function isDone (s: TestStatus): boolean {
    return s === 'pass' || s === 'fail' || s === 'warn'
  }

  /** 列表里现在全是自动项（人工检测在「按钮与旋钮」面板里做） */
  const autoCounts = computed(() => ({
    total: items.value.length,
    done: items.value.filter(it => isDone(it.status)).length,
  }))

  const progress = computed(() => {
    const { total, done } = autoCounts.value
    return total === 0 ? 0 : (done / total) * 100
  })

  const overallPass = computed(
    () => counts.value.fail === 0 && inputVerdict.value !== 'fail' && (counts.value.pass + counts.value.warn) > 0,
  )
  const headline = computed(() => {
    if (counts.value.pass + counts.value.warn + counts.value.fail === 0) return '未测试'
    if (counts.value.fail) return `${counts.value.fail} 项失败`
    // 按钮 / 旋钮还没人工确认过就不能说「全部通过」—— 报告会误导
    if (inputVerdict.value === null) return '按钮与旋钮待检测'
    return inputVerdict.value === 'fail' ? '按钮与旋钮未通过' : '全部通过'
  })
  const headColor = computed(() => {
    if (counts.value.fail) return 'error'
    if (overallPass.value) return 'success'
    return 'grey'
  })
  const headIcon = computed(() => {
    if (counts.value.fail) return 'mdi-close-circle-outline'
    if (overallPass.value) return 'mdi-check-circle-outline'
    return 'mdi-clipboard-check-outline'
  })

  function statusColor (s: TestStatus): string {
    return { idle: 'grey', running: 'info', pass: 'success', fail: 'error', warn: 'warning' }[s]
  }

  function statusLabel (s: TestStatus): string {
    return { idle: '未测试', running: '测试中', pass: '通过', fail: '失败', warn: '警告' }[s]
  }



  // ========== 执行 ==========
  async function exec (it: TestItem): Promise<void> {
    it.status = 'running'
    it.value = ''
    it.detail = it.desc
    try {
      const r = await it.run()
      it.status = r.status
      it.value = r.value ?? ''
      it.detail = r.detail ?? it.desc
    } catch (error: unknown) {
      it.status = 'fail'
      it.detail = (error as Error).message
    }
  }

  async function runOne (it: TestItem): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      await exec(it)
    } finally {
      busy.value = false
    }
  }

  /**
   * 批量运行只扫能自动下结论的项目: 按钮 / 旋钮要人上手逐个按，混进来会卡在等判定上
   *   （60s 超时），产线上跑不动 —— 它在「按钮与旋钮」面板里单独做。
   */
  async function runAll (): Promise<void> {
    if (busy.value) return
    busy.value = true
    resetAll(false)
    try {
      for (const it of items.value) {
        if (!serial.connected) break
        await exec(it)
        await sleep(120)
      }
      // 输入类不进批量扫描: 提醒去面板里实时扫描（触发齐了会自动判定）
      const tail = inputVerdict.value === null ? ' · 按钮与旋钮请在下方面板实时扫描判定' : ''
      notify(
        counts.value.fail ? `自动项 ${counts.value.fail} 项失败${tail}` : `自动项全部通过${tail}`,
        counts.value.fail ? 'error' : 'success',
      )
    } finally {
      busy.value = false
      clearInstruction()
    }
  }

  function resetAll (notifyDone = true): void {
    for (const it of items.value) {
      it.status = 'idle'
      it.value = ''
      it.detail = it.desc
    }
    resetMonitor()
    if (notifyDone) notify('已清空测试结果')
  }

  /**
   * 按设备实际支持的输入源裁剪按钮 / 旋钮标签面板:
   *   get_info 的 input_sources 是真相源（固件只上报本机型真实存在的输入）。
   *   读不到该字段时保守保留完整清单 —— 宁可多显示一个标签，也不要静默漏测。
   */
  async function syncInputSources (): Promise<void> {
    try {
      const o = await ask('get_info', 4000)
      info.device = String(o.device ?? '')
      info.hw = String(o.hw_version ?? '')
      info.fw = String(o.fw_version ?? '')
      const list = Array.isArray(o.input_sources) ? o.input_sources as Array<{ id?: unknown }> : null
      if (!list) return
      const ids = new Set(list.map(s => String(s.id ?? '')))
      tags.value = buildTags(ids)
    } catch {
      // 连接抖动导致读取失败: 保留静态清单，用户可重进本页
    }
  }

  // ========== 生命周期 ==========
  // 先进页再连设备的情况: onMounted 时没连接会跳过扫描，连接建立后补跑一次
  watch(() => serial.connected, connected => {
    if (!connected) return
    scanElrs()
    scheduleLinkPoll() // 顶部 TX / RX 读数跟着连接一起恢复（断连时轮询自行停摆）
    void fetchEfuse() // 恢复连接后重拉一次 eFuse 状态
  })

  onMounted(() => {
    serialService.onObject(onObject)
    useFactoryStream(50)
    void syncInputSources()
    void fetchEfuse() // eFuse 状态: 进页即读
    scanElrs() // 射频: 进页即重新扫描字段，不等手点播放
    scheduleLinkPoll() // 射频通讯质量: 顶部 TX / RX 读数 1s 一刷
    rateTimer = setInterval(() => {
      const now = Date.now()
      frameWin = frameWin.filter(t => now - t < 1000)
      frameRate.value = frameWin.length
    }, 500)
  })

  onUnmounted(() => {
    pageAlive = false // 先落闸: 离页后任何迟到的流登记都被拒绝
    serialService.removeObjectListener(onObject)
    releaseStream(OWNER.FACTORY)
    if (rateTimer) {
      clearInterval(rateTimer)
      rateTimer = null
    }
    if (linkPollTimer) {
      clearTimeout(linkPollTimer)
      linkPollTimer = null
    }
  })
</script>

<style scoped>
/* ── 页面布局 (与 system 页一致) ── */
.ft-page {
  padding: 0 16px 96px;
}

.ft-page>.v-toolbar {
  margin: 0 -16px;
}

.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}

.ft-root {
  width: 100%;
}

/* 卡片外壳 (与校准/系统页一致) */
.cal-card {
  background: #1e1e1e !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  transition: border-color 0.3s, background-color 0.3s;
}

.cal-card:hover {
  border-color: rgba(255, 255, 255, 0.16) !important;
}

.cal-avatar {
  margin-right: 4px;
}

/* 底栏/次级按钮: 深色底 + 白字 */
.btn-secondary {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: #fff !important;
}

.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* eFuse 状态行: 名称固定宽 + 说明撑开 + 状态 chip 靠右 */
.efuse-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.efuse-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.efuse-row:last-child {
  border-bottom: none;
}

.efuse-name {
  width: 130px;
  flex: none;
  font-weight: 600;
  font-size: 0.82rem;
}

.efuse-desc {
  flex: 1;
  font-size: 0.74rem;
  color: rgba(255, 255, 255, 0.45);
}

@media (max-width: 600px) {
  .btn-text {
    display: none;
  }
}

/* ── 总览计数 ── */
.ft-sum-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.ft-sum {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  text-align: center;
}

.ft-sum-num {
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.1;
}

.ft-sum-label {
  margin-top: 2px;
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.45);
}

.ft-sum-pass .ft-sum-num {
  color: rgb(var(--v-theme-success));
}

.ft-sum-warn .ft-sum-num {
  color: rgb(var(--v-theme-warning));
}

.ft-sum-fail .ft-sum-num {
  color: rgb(var(--v-theme-error));
}

.ft-sum-total .ft-sum-num {
  color: rgba(255, 255, 255, 0.85);
}

/* ── 交互操作提示 ── */
.ft-instruction-text {
  font-size: 0.9rem;
  font-weight: 600;
}

.ft-instruction-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── 手动判定条 ── */
.ft-manual-obs {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.75);
}

/* ── 按钮 / 旋钮标签（键盘测试式） ── */
.ft-tag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}

.ft-tag {
  padding: 7px 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  text-align: center;
  transition: background-color 0.12s, border-color 0.12s, box-shadow 0.12s;
}

/* ── 三档状态: 同一主题色, 只靠透明度 / 描边拉开层级 ──
   常规(从未触发) → ft-tag-seen(触发过, 中间档) → ft-tag-live(此刻按下 / 转动中, 最亮) */

/* 中间档: 本次测试里按下 / 转过 —— 松手后留在这里, 靠它数「还剩几个没测」 */
.ft-tag-seen {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.12);
}

/* 最亮: 此刻正按着 / 正转着 —— 加内描边把它从「已触发」里挑出来 */
.ft-tag-live {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.32);
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary));
}

.ft-tag-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.ft-tag-hint {
  margin-top: 8px;
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.35);
}

/* ── 模拟输入观察（扳机 / 摇杆 / IMU） ──
   整组走中性灰、不加主题色也不做「已触发」高亮: 它不参与判定，
   视觉上不能和上面那堆按钮 / 旋钮标签抢层次（否则容易被当成又一个要测的项目） */
.ft-tabs {
  margin-bottom: 4px;
}

.ft-analog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.ft-analog {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
}

.ft-analog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.ft-analog-name {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.6);
}

.ft-analog-val {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

/* 位置条只是「当前在哪」的指针，不是进度 */
.ft-analog-bar {
  margin-top: 5px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.ft-analog-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.45);
  transition: width 0.08s linear;
}

/* 进度条下的口径说明: 自动 / 人工分别计 */
.ft-progress-note {
  margin-top: 6px;
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.42);
}

/* ── 测试项行 ── */
.ft-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.ft-row:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(255, 255, 255, 0.06);
}

/* 相邻条目间距（最后一条不加，避免撑高卡片底部） */
.ft-row + .ft-row {
  margin-top: 8px;
}

.ft-row-main {
  min-width: 0;
}

.ft-row-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.ft-row-badge {
  color: rgba(255, 255, 255, 0.35);
}

.ft-row-sub {
  margin-top: 1px;
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ft-row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.ft-row-val {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
