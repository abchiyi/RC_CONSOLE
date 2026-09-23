<template>
  <div class="system-page">
    <v-snackbar v-model="snackbarVisible" color="info" timeout="2000">
      {{ snackbarMsg }}
    </v-snackbar>

    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-cog</v-icon>
        系统
      </v-toolbar-title>
    </v-toolbar>

    <!-- 未连接 -->
    <v-alert v-if="!serial.connected" class="ma-3" color="primary" border="start" border-color="primary"
      icon="mdi-information" variant="tonal">
      请先连接设备以管理系统设置
    </v-alert>

    <div v-if="serial.connected" class="sys-root">
      <!-- 实时状态卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="primary" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-monitor-dashboard</v-icon>
            </v-avatar>
          </template>
          <v-card-title>系统状态</v-card-title>
          <v-card-subtitle>设备型号、软硬件版本与实时电源状态</v-card-subtitle>
          <template #append>
            <v-chip v-if="stateError" color="error" size="x-small" variant="tonal">
              {{ stateError }}
            </v-chip>
            <v-chip v-else-if="power.state" :color="pollActive ? 'success' : 'grey'" size="x-small" variant="tonal">
              <v-icon start size="12">mdi-circle</v-icon>
              监控中
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="stat-groups">
            <!-- 设备信息 -->
            <div class="stat-group">
              <div class="stat-group-title">设备信息</div>
              <div class="stat-kv-grid">
                <div class="stat-kv stat-kv-wide">
                  <span class="stat-label">设备型号</span>
                  <span class="stat-value mono">{{ configStore.deviceInfo?.device ?? '--' }}</span>
                </div>
                <div class="stat-kv stat-kv-wide">
                  <span class="stat-label">硬件版本</span>
                  <span class="stat-value mono">{{ configStore.deviceInfo?.hw_version ?? '--' }}</span>
                </div>
                <div class="stat-kv stat-kv-wide">
                  <span class="stat-label">软件版本</span>
                  <span class="stat-value mono">{{ configStore.deviceInfo?.fw_version ?? '--' }}</span>
                </div>
              </div>
            </div>

            <!-- 电源状态 -->
            <div class="stat-group">
              <div class="stat-group-title">电源状态</div>
              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">电量</span>
                  <span class="stat-value">
                    <span v-if="power.state" class="batt-wrap">
                      <span class="batt" :style="{ '--batt-c': battColorVar }" :title="battTitle">
                        <span class="batt-cap"></span>
                        <span class="batt-body">
                          <i v-for="n in 4" :key="n" class="batt-cell"
                            :class="{ 'batt-cell-on': n <= battLevel }"></i>
                        </span>
                      </span>
                      <span class="batt-text">{{ battLabel }}</span>
                    </span>
                    <span v-else class="text-grey">--</span>
                  </span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">电池电压</span>
                  <span class="stat-value mono">
                    {{ power.state ? (power.state.battery_mv / 1000).toFixed(2) + ' V' : '--' }}
                  </span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">系统电压</span>
                  <span class="stat-value mono">
                    {{ power.state ? (power.state.sys_mv / 1000).toFixed(2) + ' V' : '--' }}
                  </span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">充电状态</span>
                  <span class="stat-value">
                    <v-chip v-if="power.state" :color="chargeColor(power.state.charge)" size="x-small" variant="tonal">
                      {{ chargeLabel(power.state.charge) }}
                    </v-chip>
                    <span v-else class="text-grey">--</span>
                  </span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">充电电流</span>
                  <span class="stat-value mono">{{ power.state ? power.state.charge_current_ma + ' mA' : '--' }}</span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">电流上限</span>
                  <span class="stat-value mono">{{ power.state ? (power.state.idpm_limit_ma / 1000).toFixed(2) + ' A' : '--' }}</span>
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- 空闲关机设置卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="primary" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-timer-cog</v-icon>
            </v-avatar>
          </template>
          <v-card-title>空闲关机设置</v-card-title>
          <v-card-subtitle>无操作时先告警、后自动关机的时间阈值</v-card-subtitle>
          <template #append>
            <v-chip v-if="cfgDirty" color="warning" size="x-small" variant="tonal">已修改</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <!-- 唯一可配置项: 整行点击弹出时间选择 -->
          <div class="idle-row" role="button" tabindex="0" @click="openTimeDialog"
            @keydown.enter.prevent="openTimeDialog" @keydown.space.prevent="openTimeDialog">
            <div class="idle-row-main">
              <div class="idle-row-title">关机超时</div>
              <div class="idle-row-sub">
                {{ shutdownSec ? '超时后播关机音效并彻底断电' : '设为 0 关闭空闲关机' }}
              </div>
            </div>
            <div class="idle-row-value">
              <span v-if="shutdownSec" class="mono">{{ shutdownTime }}</span>
              <span v-else>关闭</span>
              <v-icon size="16">mdi-pencil-outline</v-icon>
            </div>
          </div>

          <!-- 空闲警告: 由关机超时推导(-30s), 只读说明 -->
          <div class="idle-warn">
            <v-icon size="13">mdi-bell-outline</v-icon>
            <span v-if="!shutdownSec">
              空闲检测已关闭：不计空闲时长，永不自动关机，也不告警
            </span>
            <span v-else-if="warnSec > 0">
              无操作 {{ warnTime }} 起 LED 慢闪 + 蜂鸣提醒，{{ shutdownTime }} 自动关机
            </span>
            <span v-else>无操作满 {{ shutdownTime }} 直接关机，不再单独提醒</span>
          </div>

          <!-- 实时空闲倒计时: 固件 idle_s 每秒刷新, 轮询间隔靠本地时钟插值平滑 -->
          <div class="idle-count" :class="`tone-${countdownColor}`">
            <div class="idle-count-head">
              <v-icon size="14">mdi-timer-sand</v-icon>
              <span v-if="idleDisabled">空闲检测已关闭（设备当前超时为 0，保存后立即生效）</span>
              <span v-else-if="remainS !== null">
                距自动关机 <span class="mono idle-count-val">{{ countdownText }}</span>
                <span class="idle-count-elapsed">(已空闲 {{ elapsedText }})</span>
              </span>
              <span v-else>未连接设备，倒计时不可用</span>
            </div>
            <template v-if="!idleDisabled">
              <v-progress-linear :model-value="countdownPct" :color="countdownColor" height="3" rounded
                class="mt-1" />

              <!-- 消除误导: 明确"到点了也不会关机"的两种情形 -->
              <div v-if="vbusPresent" class="idle-count-note idle-count-warn">
                <v-icon size="12">mdi-usb</v-icon>
                <span>USB 已接入，不会自动关机</span>
              </div>
              <div v-if="activityLabels.length" class="idle-count-note">
                <v-icon size="12">mdi-motion</v-icon>
                <span>计时已重置：{{ activityLabels.join(' / ') }}</span>
                <span v-if="blockingSrc" class="idle-count-badge">持续中，设备不会关机</span>
              </div>
            </template>
          </div>
        </v-card-text>
      </v-card>

      <!-- 遥测转发端口卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar :color="telemActive ? 'primary' : 'grey'" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-swap-horizontal</v-icon>
            </v-avatar>
          </template>
          <v-card-title>遥测转发</v-card-title>
          <v-card-subtitle>指定 USB / 蓝牙端口输出飞控 MAVLink 遥测</v-card-subtitle>
          <template #append>
            <v-chip v-if="configStore.telem2Busy" color="info" size="x-small" variant="tonal">切换中</v-chip>
            <v-chip v-else-if="telemActive" color="success" size="x-small" variant="tonal">已启用</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="telem-row">
            <div class="telem-main">
              <div class="idle-row-title">USB 端口</div>
              <div class="idle-row-sub">开启后 USB 只输出 MAVLink 遥测，不再响应配置命令</div>
            </div>
            <v-switch class="telem-switch" :model-value="configStore.telem2Usb" :loading="configStore.telem2Busy"
              :disabled="configStore.telem2Supported === false"
              @update:model-value="toggleTelem2('usb', $event)" />
          </div>

          <div class="telem-row mt-2">
            <div class="telem-main">
              <div class="idle-row-title">蓝牙端口</div>
              <div class="idle-row-sub">开启后蓝牙只输出 MAVLink 遥测，不再响应配置命令</div>
            </div>
            <v-switch class="telem-switch" :model-value="configStore.telem2Bt" :loading="configStore.telem2Busy"
              :disabled="configStore.telem2Supported === false"
              @update:model-value="toggleTelem2('bt', $event)" />
          </div>

          <v-alert v-if="telemError" color="error" variant="tonal" density="compact" class="mt-3 py-1">
            {{ telemError }}
          </v-alert>

          <div class="cal-hint hint-neutral mt-3">
            <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
            <span>
              两个端口不能同时开启（至少保留一个配置通道）。开启后该口转为纯 MAVLink 遥测口，
              其上的配置指令会被设备静默丢弃；若误开了正在使用的端口，请改用另一个端口关闭。
            </span>
          </div>
        </v-card-text>
      </v-card>

      <!-- 配置备份 / 还原卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="primary" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-backup-restore</v-icon>
            </v-avatar>
          </template>
          <v-card-title>配置备份</v-card-title>
          <v-card-subtitle>全部模型与校准数据导出为 JSON 文件，或从文件整体还原</v-card-subtitle>
          <template #append>
            <v-chip v-if="backupBusy" color="info" size="x-small" variant="tonal">
              {{ backupLabel }} {{ backupProgress }}%
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-3">
          <v-progress-linear v-if="backupBusy" :model-value="backupProgress" color="primary" height="3"
            rounded class="mb-3" />

          <div class="cal-hint hint-neutral">
            <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
            <span>
              导出含 8 个模型槽位与全部校准数据（摇杆/扳机行程、响应曲线、IMU 零偏、姿态归零）。
              导入为<strong>整体替换</strong>：文件里没有的槽位与校准项会回到默认值。
            </span>
          </div>

          <v-alert v-if="backupError" color="error" variant="tonal" density="compact" class="mt-3 py-1">
            {{ backupError }}
          </v-alert>
          <v-alert v-else-if="backupMsg" color="success" variant="tonal" density="compact" class="mt-3 py-1">
            {{ backupMsg }}
          </v-alert>

          <div class="d-flex justify-end mt-3">
            <v-btn class="btn-secondary me-2" size="small" prepend-icon="mdi-file-export"
              :disabled="!serial.connected || backupBusy" @click="onExportConfig">
              <span class="btn-text">导出配置</span>
            </v-btn>
            <v-btn class="btn-secondary" size="small" prepend-icon="mdi-file-import"
              :disabled="!serial.connected || backupBusy" @click="onImportConfig">
              <span class="btn-text">导入配置</span>
            </v-btn>
          </div>
        </v-card-text>
      </v-card>

      <!-- 恢复出厂设置卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="error" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-alert-octagram</v-icon>
            </v-avatar>
          </template>
          <v-card-title>恢复出厂设置</v-card-title>
          <v-card-subtitle>抹除 NVS 分区全部数据并自动重启</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-3">
          <div class="cal-hint hint-error">
            <v-icon size="16" class="mt-0.5">mdi-alert</v-icon>
            <span>
              此操作会直接抹除 NVS 分区全部数据（模型配置、校准、电源设置等），且不可恢复；
              执行后设备将自动重启，你需要重新连接并重新配置设备。
            </span>
          </div>

          <v-alert v-if="factoryResetError" color="error" variant="tonal" density="compact" class="mt-3 py-1">
            {{ factoryResetError }}
          </v-alert>
          <v-alert v-else-if="factoryResetMsg" color="success" variant="tonal" density="compact" class="mt-3 py-1">
            {{ factoryResetMsg }}
          </v-alert>

          <div class="d-flex justify-end mt-3">
            <v-btn color="error" size="small" variant="tonal" prepend-icon="mdi-delete-alert"
              :disabled="!serial.connected || factoryResetBusy" :loading="factoryResetBusy"
              @click="factoryResetDialog = true">
              抹除 NVS 并重启
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </div>

    <v-dialog v-model="factoryResetDialog" max-width="460" persistent>
      <v-card>
        <v-card-title class="text-body-1">确认恢复出厂设置</v-card-title>
        <v-card-text>
          确认后将抹除 NVS 分区全部数据并自动重启设备。该操作不可撤销。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="factoryResetBusy" @click="factoryResetDialog = false">取消</v-btn>
          <v-btn color="error" variant="tonal" :loading="factoryResetBusy" @click="startFactoryResetNvs">
            确认抹除
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 遥测端口确认: 开启正在使用的端口会失去配置通道 -->
    <v-dialog :model-value="!!telemConfirm" max-width="460" persistent>
      <v-card>
        <v-card-title class="text-body-1">确认开启遥测转发</v-card-title>
        <v-card-text>
          你正在通过{{ telemConfirm?.kind === 'bt' ? '蓝牙' : 'USB' }}连接本设备。开启该端口的遥测转发后，
          此端口将只输出 MAVLink 遥测，不再响应配置命令（含本页开关）。
        </v-card-text>
        <v-card-text class="pt-0 text-medium-emphasis">
          如需关闭，请改用另一个端口（{{ telemConfirm?.kind === 'bt' ? 'USB' : '蓝牙' }}）连接后再关闭。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="telemConfirm = null">取消</v-btn>
          <v-btn color="primary" variant="tonal" @click="confirmTelem2">仍然开启</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 时间选择弹窗: 仅关机超时时间 (警告时间由它推导) -->
    <v-dialog v-model="timeDialog" max-width="336" persistent>
      <v-card>
        <v-time-picker v-model="timeDraft" format="24hr" use-seconds :min="timeMin" :max="timeMax"
          title="关机超时时间" color="primary" class="mx-auto" />
        <div class="d-flex align-center px-4 pb-3">
          <span class="text-caption text-medium-emphasis">≈ {{ fmtSeconds(timeDraftSec) }}</span>
          <v-spacer />
          <v-btn variant="text" size="small" @click="timeDialog = false">取消</v-btn>
          <v-btn color="primary" variant="tonal" size="small" class="ms-1" @click="applyTimeDialog">确定</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <FirmwareUpgradeDialog v-model="upgradeDialog" />

    <!-- 底栏操作按钮: Teleport 到全局底栏右侧槽 (App.vue) -->
    <Teleport to="#global-footer-right">
      <v-btn v-if="serial.connected && cfgDirty" class="btn-secondary me-2" prepend-icon="mdi-content-save" size="small"
        :loading="power.loading" @click="saveSettings">
        <span class="btn-text">保存到设备</span>
      </v-btn>
      <v-btn v-if="serial.connected" class="btn-secondary" prepend-icon="mdi-upload-network" size="small"
        @click="upgradeDialog = true">
        <span class="btn-text">固件升级</span>
      </v-btn>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { usePowerStore } from '@/stores/power'
import { useConfigStore } from '@/stores/config'
import { serialService } from '@/services/SerialService'
import { exportSnapshot, importSnapshot } from '@/services/configBackup'
import { jsonToSnapshot, snapshotToJson } from '@/utils/configSnapshot'
import { openTextFile, saveTextFile } from '@/utils/fileDialog'
import FirmwareUpgradeDialog from '@/components/FirmwareUpgradeDialog.vue'

const serial = useSerialStore()
const power = usePowerStore()
const configStore = useConfigStore()

// ========== 固件升级对话框 ==========
const upgradeDialog = ref(false)

// ========== 轮询 ==========
const pollActive = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

function startPoll() {
  stopPoll()
  pollActive.value = true
  power.fetchState()
  pollTimer = setInterval(() => {
    if (serial.connected && !power.loading) power.fetchState()
  }, 2000)
}

function stopPoll() {
  pollActive.value = false
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ========== 配置表单 ==========
/** 关机超时时间: 本卡片唯一可编辑项 */
const shutdownSec = ref(power.cfg.idle_shutdown_s)
/** 警告提前量: 固定 30s, 只在推导警告时间时使用 */
const WARN_LEAD_S = 30
/** 空闲警告时间: 恒为 关机超时 - 30s, 不可单独修改 (不足 30s 时为 0) */
const warnSec = computed(() => Math.max(0, shutdownSec.value - WARN_LEAD_S))

/** 时间字符串视图 (HH:MM:SS): 仅供表单展示, 写入统一走时间选择弹窗 */
const warnTime = computed(() => toTimeStr(warnSec.value))
const shutdownTime = computed(() => toTimeStr(shutdownSec.value))

// ========== 实时空闲倒计时 ==========
/** 设备当前是否关闭空闲检测 (关机超时 = 0): 固件此时不计时/不告警/不关机 */
const idleDisabled = computed(() => power.cfg.idle_shutdown_s === 0)

/** 1s 心跳: 驱动插值重算 (固件每秒刷新 idle_s, 前端每 2s 轮询一次) */
const tick = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
/** 最近一次收到固件 idle_s 的本地时刻 (ms), 作为插值起点 */
let idleSyncMs = 0
watch(() => power.state?.idle_s, () => { idleSyncMs = Date.now() })

/** 当前已空闲秒数: 固件值 + 距上次同步经过的时间; 未连接/无状态返回 null */
const idleNowS = computed(() => {
  const base = power.state?.idle_s
  if (typeof base !== 'number' || !serial.connected) return null
  void tick.value // 依赖心跳触发重算
  return base + (idleSyncMs ? (Date.now() - idleSyncMs) / 1000 : 0)
})

/** 距自动关机的剩余秒数 (以设备当前生效的超时为准), 未连接或已关闭检测为 null */
const remainS = computed(() => {
  const idle = idleNowS.value
  if (idle === null || idleDisabled.value) return null
  return Math.max(0, Math.ceil(power.cfg.idle_shutdown_s - idle))
})

const countdownText = computed(() => remainS.value === null ? '--:--:--' : toTimeStr(remainS.value))
const elapsedText = computed(() => toTimeStr(Math.floor(idleNowS.value ?? 0)))
/** 已空闲进度 (0~100): 供进度条展示"消耗了多少" */
const countdownPct = computed(() => {
  const idle = idleNowS.value
  if (idle === null) return 0
  const total = power.cfg.idle_shutdown_s || 1
  return Math.min(100, Math.max(0, (idle / total) * 100))
})
/** 分档配色: 剩 ≤10s 危险 / 已进入告警区 警告 / 其余正常 */
const countdownColor = computed(() => {
  const r = remainS.value
  if (r === null) return 'grey'
  if (r <= 10) return 'error'
  const warnLead = power.cfg.idle_shutdown_s - power.cfg.idle_warning_s
  if (power.cfg.idle_warning_s > 0 && warnLead > 0 && r <= warnLead) return 'warning'
  return 'primary'
})

// ---- 为何到点也不关机: 活动源 + USB 供电 ----
/** 活动源位掩码 → 标签 (与固件 ActivitySrc 一致) */
const ACT_SRC_BITS: Array<[number, string]> = [
  [0x01, '按键'],
  [0x02, '摇杆/扳机'],
  [0x04, '旋钮'],
  [0x08, 'IMU 移动'],
  [0x10, 'RF 链路'],
  [0x20, '上位机交互'],
]
/** 持续型活动源: 会不断重置计时, 设备实际不会关机 */
const ACT_SRC_BLOCKING = 0x08 | 0x10

const activitySrc = computed(() => power.state?.activity_src ?? 0)
const activityLabels = computed(() =>
  ACT_SRC_BITS.filter(([bit]) => activitySrc.value & bit).map(([, label]) => label))
const blockingSrc = computed(() => (activitySrc.value & ACT_SRC_BLOCKING) !== 0)
/** VBUS 有输入: 硬件断不了电 (阈值同固件 PMU_VBUS_PRESENT_MV) */
const vbusPresent = computed(() => (power.state?.vbus_mv ?? 0) >= 4000)

// ========== 关机超时时间选择弹窗 ==========
const timeDialog = ref(false)
/** picker 的双向绑定字符串 (仅作展示载体) */
const timeDraft = ref('00:00:00')
/** 编辑中的秒数: 由 picker 每次回传解析得到, 写回以它为准 (解析失败则保留上次有效值) */
const timeDraftSec = ref(0)

/** 可选范围: 0 ~ 1h (0 = 关闭空闲检测) */
const SHUTDOWN_MIN_S = 0
const SHUTDOWN_MAX_S = 3600
const timeMin = toTimeStr(SHUTDOWN_MIN_S)
const timeMax = toTimeStr(SHUTDOWN_MAX_S)

// picker 回传的字符串 → 秒数: 解析失败不改动草稿, 避免静默丢弃用户选择
watch(timeDraft, (v) => {
  const s = parseTimeStr(v)
  if (s !== null) timeDraftSec.value = s
})

function openTimeDialog(): void {
  timeDraftSec.value = shutdownSec.value
  timeDraft.value = toTimeStr(shutdownSec.value)
  timeDialog.value = true
}

function applyTimeDialog(): void {
  shutdownSec.value = Math.min(SHUTDOWN_MAX_S, Math.max(SHUTDOWN_MIN_S, timeDraftSec.value))
  timeDialog.value = false
}
const cfgDirty = ref(false)
const stateError = ref('')

// ========== 操作提示 (snackbar) ==========
const snackbarVisible = ref(false)
const snackbarMsg = ref('')

// ========== 配置备份 / 还原 (协议 §5.15) ==========
//   会话期间暂停状态轮询让出链路带宽；设备侧给的是二进制快照，JSON 编解码在上位机完成。
const backupBusy = ref(false)
const backupProgress = ref(0)
const backupLabel = ref('')
const backupMsg = ref('')
const backupError = ref('')

function backupProgressHandler (p: { done: number, total: number }): void {
  backupProgress.value = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
}

function resetBackupState (): void {
  backupBusy.value = false
  backupProgress.value = 0
  backupLabel.value = ''
  if (serial.connected) startPoll()
}

async function onExportConfig (): Promise<void> {
  if (backupBusy.value) return
  backupBusy.value = true
  backupProgress.value = 0
  backupLabel.value = '导出中'
  backupMsg.value = ''
  backupError.value = ''
  stopPoll()

  try {
    const bytes = await exportSnapshot(backupProgressHandler)
    const json = snapshotToJson(bytes)
    const text = JSON.stringify(json, null, 2)
    const name = `gamepad2rc-config-${new Date().toISOString().slice(0, 10)}.json`
    const saved = await saveTextFile(name, text)
    if (saved) {
      backupMsg.value = `已导出 ${json.models.length} 个模型槽位（${text.length} 字节）`
    }
  } catch (e: unknown) {
    backupError.value = `导出失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    resetBackupState()
  }
}

async function onImportConfig (): Promise<void> {
  if (backupBusy.value) return
  backupBusy.value = true
  backupProgress.value = 0
  backupLabel.value = '导入中'
  backupMsg.value = ''
  backupError.value = ''
  stopPoll()

  try {
    const file = await openTextFile()
    if (!file) {
      backupMsg.value = '已取消导入'
      return
    }
    // 先本地转成快照 (顺带校验结构与版本), 避免把坏文件分块推给设备浪费一次会话
    const bytes = jsonToSnapshot(JSON.parse(file.text) as unknown)
    await importSnapshot(bytes, backupProgressHandler)
    backupMsg.value = '配置已导入并生效'
    // 设备侧已落 NVS 并重载运行态: 回读电源设置与设备信息刷新本页
    await reloadAll()
  } catch (e: unknown) {
    backupError.value = `导入失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    resetBackupState()
  }
}

// ========== 恢复出厂设置（抹除 NVS） ==========
const factoryResetBusy = ref(false)
const factoryResetDialog = ref(false)
const factoryResetMsg = ref('')
const factoryResetError = ref('')

function waitFactoryResetResponse(timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('等待设备响应超时: factory_reset_nvs'))
    }, timeoutMs)

    const handler = (obj: Record<string, unknown>) => {
      if (obj.cmd !== 'factory_reset_nvs') return
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

async function startFactoryResetNvs() {
  if (!serial.connected) {
    factoryResetError.value = '请先连接设备'
    return
  }

  factoryResetBusy.value = true
  factoryResetMsg.value = ''
  factoryResetError.value = ''

  try {
    const pending = waitFactoryResetResponse()
    await serialService.sendCommand('factory_reset_nvs')
    const resp = await pending
    if (resp.ok === true) {
      factoryResetMsg.value = '已抹除 NVS，设备正在重启，请稍后重新连接'
      factoryResetDialog.value = false
      stopPoll()
      setTimeout(async () => {
        try {
          if (serial.connected) await serial.disconnect()
        } catch {
          // ignore
        }
      }, 1300)
    } else {
      factoryResetError.value = `恢复失败: ${String(resp.error || '未知错误')}`
    }
  } catch (e: unknown) {
    factoryResetError.value = `恢复失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    factoryResetBusy.value = false
  }
}

// ========== 遥测转发端口开关 ==========
const telemError = ref('')
/** 待确认的开关操作: 开启当前连接口会失去配置通道, 需二次确认 */
const telemConfirm = ref<{ kind: 'usb' | 'bt'; usb: boolean; bt: boolean } | null>(null)
const telemActive = computed(() => configStore.telem2Usb || configStore.telem2Bt)

/** 该口是否正被上位机用于配置通讯 */
function isCurrentLink(kind: 'usb' | 'bt'): boolean {
  if (!serial.connected) return false
  return kind === 'bt' ? serial.isBluetooth : !serial.isBluetooth
}

async function toggleTelem2(kind: 'usb' | 'bt', v: boolean | null): Promise<void> {
  const on = !!v
  // 互斥: 固件拒绝 mask=0x03 (两口全占将失去全部配置通道), 开一路必关另一路
  const usb = kind === 'usb' ? on : false
  const bt = kind === 'bt' ? on : false
  if (on && isCurrentLink(kind)) {
    telemConfirm.value = { kind, usb, bt }
    return
  }
  await applyTelem2(usb, bt)
}

async function applyTelem2(usb: boolean, bt: boolean): Promise<void> {
  telemError.value = ''
  const ok = await configStore.setTelem2(usb, bt)
  if (!ok) {
    telemError.value = configStore.telem2Error ?? '设置失败'
    return
  }
  snackbarMsg.value = usb || bt ? '遥测转发已开启' : '遥测转发已关闭'
  snackbarVisible.value = true
}

async function confirmTelem2(): Promise<void> {
  const c = telemConfirm.value
  if (!c) return
  telemConfirm.value = null
  await applyTelem2(c.usb, c.bt)
}


// 同步 store → 表单
watch(() => power.cfg, (c) => {
  shutdownSec.value = c.idle_shutdown_s
  cfgDirty.value = false
}, { deep: true })

// 表单变更标记 (警告时间由关机超时推导, 无需单独比较)
watch(shutdownSec, () => {
  cfgDirty.value = shutdownSec.value !== power.cfg.idle_shutdown_s
})

/** 进入页面/连接建立后：拉取配置并启动轮询 */
function enterPage(): void {
  reloadAll()
}

// 串口状态监听
watch(() => serial.connected, (connected) => {
  if (connected) {
    enterPage()
  } else {
    stopPoll()
    power.state = null
  }
})

// OTA 对话框打开时停止轮询，关闭后恢复（避免 OTA 锁丢弃日志干扰）
watch(upgradeDialog, (open) => {
  if (open) stopPoll()
  else if (serial.connected) startPoll()
})

async function reloadAll() {
  stateError.value = ''
  try {
    await power.fetchCfg()
    await configStore.fetchDeviceInfo()
    // 回读遥测转发端口掩码 (get_config 的 0x05 项; 旧固件无此项 → 开关置灰)
    await configStore.fetchTelem2()
    telemError.value = ''
    shutdownSec.value = power.cfg.idle_shutdown_s
    cfgDirty.value = false
    startPoll()
  } catch {
    snackbarMsg.value = '配置加载失败'
    snackbarVisible.value = true
  }
}

/** 全局底栏「从设备加载」: 复用本页加载逻辑, 完成后回报 App 关闭全局按钮 loading */
async function onGlobalReload() {
  try {
    await reloadAll()
  } finally {
    window.dispatchEvent(new CustomEvent('app:reload-done'))
  }
}

async function saveSettings() {
  try {
    await power.saveCfg({
      idle_warning_s: warnSec.value,
      idle_shutdown_s: shutdownSec.value,
    })
    cfgDirty.value = false
    snackbarMsg.value = '设置已保存到设备'
    snackbarVisible.value = true
  } catch {
    snackbarMsg.value = '保存失败，请重试'
    snackbarVisible.value = true
  }
}

// ========== 工具函数 ==========
/** 秒 → 时间串 (HH:MM:SS), 供输入框展示与 picker 初始化 */
function toTimeStr(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

/**
 * 时间串 → 秒: 兼容 H:M / H:M:S / 12 小时制后缀, 越界或非法返回 null。
 * 宽松解析是刻意的: picker 的取值格式随版本变化, 严格正则会导致静默写回失败。
 */
function parseTimeStr(v: string | null): number | null {
  const m = /^\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*([ap]m)?\s*$/i.exec(v ?? '')
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3] ?? 0)
  const period = m[4]?.toLowerCase()
  if (period === 'pm' && h < 12) h += 12
  if (period === 'am' && h === 12) h = 0
  if (h > 23 || min > 59 || sec > 59) return null
  return h * 3600 + min * 60 + sec
}

/** 秒 → 人类可读时长: 0 小时与 0 分按下省略 (5分0秒 / 1小时0分30秒) */
function fmtSeconds(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}小时`)
  if (m > 0 || h > 0) parts.push(`${m}分`)
  parts.push(`${sec}秒`)
  return parts.join('')
}

// ========== 电量显示 (四段电池, 不显示百分比) ==========
/** 固件上报的电量档位 0~4; 越界夹紧, 并对旧固件 (上报 0~100 百分比) 折算成档位 */
const battLevel = computed(() => {
  const raw = power.state?.battery_level ?? 0
  const lv = raw > 4 ? Math.round(raw / 25) : raw
  return Math.min(4, Math.max(0, lv))
})

/** 档位 → 文字: 平台区电压分辨率只够分 5 档, 百分比没有意义 */
const battLabel = computed(() => ['空', '低', '中', '高', '满'][battLevel.value])
/** 档位 → 悬浮说明 */
const battTitle = computed(() => `电量${battLabel.value}：${battLevel.value} / 4 格`)
/** 档位 → 图标配色 (Vuetify 主题变量, 随明暗主题自动切换) */
const battColorVar = computed(() => {
  const lv = battLevel.value
  if (lv >= 3) return 'rgb(var(--v-theme-success))'
  if (lv >= 2) return 'rgb(var(--v-theme-warning))'
  return 'rgb(var(--v-theme-error))'
})

function stateColor(s: string): string {
  return { normal: 'success', warning: 'warning', shutdown: 'error' }[s] ?? 'grey'
}

function stateLabel(s: string): string {
  return { normal: '正常', warning: '空闲告警', shutdown: '即将关机' }[s] ?? s
}

function chargeColor(c: string): string {
  return { none: 'grey', charging: 'info', full: 'success' }[c] ?? 'grey'
}

function chargeLabel(c: string): string {
  return { none: '未充电', charging: '充电中', full: '已充满' }[c] ?? c
}

onMounted(() => {
  if (serial.connected) enterPage()
  window.addEventListener('app:reload-from-device', onGlobalReload)
  tickTimer = setInterval(() => { tick.value++ }, 1000)
})

onUnmounted(() => {
  stopPoll()
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  window.removeEventListener('app:reload-from-device', onGlobalReload)
})
</script>

<style scoped>
/* ── 页面布局 (与 config 页一致) ── */
.system-page {
  padding: 0 16px 96px;
}

/* 顶部工具栏保持原边缘对齐, 内容区仍缩进 16px */
.system-page>.v-toolbar {
  margin: 0 -16px;
}

/* 页面标题左侧主题色高亮 */
.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}

/* 单列堆叠容器 (对齐校准页 .cal-root) */
.sys-root {
  width: 100%;
}

/* 卡片外壳 (与校准页 CalWizard 一致: 纯色底 + 通栏细边框) */
.cal-card {
  background: #1e1e1e !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  transition: border-color 0.3s, background-color 0.3s;
}

.cal-card:hover {
  border-color: rgba(255, 255, 255, 0.16) !important;
}

/* 底栏次要按钮: 深色底 + 白字 (与 config 页一致) */
.btn-secondary {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: #fff !important;
}

/* 窄屏隐藏按钮文字只留图标 */
@media (max-width: 600px) {
  .btn-text {
    display: none;
  }
}

/* ── 卡片内容排版: 分组面板 + 自适应键值网格 (度量对齐校准页) ── */
.stat-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.stat-group {
  flex: 1 1 260px;
  min-width: 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 8px 10px;
}

.stat-group-title {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 5px;
}

/* ── 键值对: 标签左 / 值右, 列数随宽度自动增减 ── */
.stat-kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 5px 14px;
}

.stat-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.stat-label {
  flex: 0 0 auto;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.45);
}

.stat-value {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 长文本项: 独占整行并允许折行, 避免被省略号截断 ── */
.stat-kv-wide {
  grid-column: 1 / -1;
}

.stat-kv-wide .stat-value {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  word-break: break-word;
  line-height: 1.3;
}

/* 数值: 等宽 + 表格数字, 消除刷新时的宽度跳动 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* ── 电量: 四段电池图标 (固件上报 0~4 档, 不再显示百分比) ── */
.batt-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* 档位配色经内联 --batt-c 传入, 边框/亮格/文字统一取 currentColor */
.batt {
  display: inline-flex;
  align-items: center;
  color: var(--batt-c, rgba(255, 255, 255, 0.45));
}

/* 正极帽 */
.batt-cap {
  width: 2px;
  height: 8px;
  margin-right: 1px;
  border-radius: 0 2px 2px 0;
  background: currentColor;
  opacity: 0.7;
}

/* 壳体 */
.batt-body {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}

/* 单格: 熄灭为半透明底, 点亮为档位配色 */
.batt-cell {
  display: inline-block;
  width: 8px;
  height: 9px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.12);
}

.batt-cell-on {
  background: currentColor;
}

.batt-text {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
}

/* ── 空闲关机: 单行配置条, 整行可点, 值右对齐 ── */
.idle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.idle-row:hover,
.idle-row:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}

.idle-row-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
}

.idle-row-sub {
  margin-top: 1px;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.38);
}

.idle-row-value {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-size: 1.05rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}

/* ── 派生项说明: 由关机超时推导, 不单独配置 ── */
.idle-warn {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.42);
}

/* ── 实时空闲倒计时 ── */
.idle-count {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.idle-count-head {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.55);
}

.idle-count-val {
  font-size: 1.05rem;
  font-weight: 600;
}

.idle-count-elapsed {
  margin-left: 2px;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.35);
}

.tone-error .idle-count-val {
  color: rgb(var(--v-theme-error));
}

.tone-warning .idle-count-val {
  color: rgb(var(--v-theme-warning));
}

.tone-primary .idle-count-val {
  color: rgb(var(--v-theme-primary));
}

/* ── 倒计时附注: 说明为何到点也不会关机 ── */
.idle-count-note {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  font-size: 0.66rem;
  color: rgba(255, 255, 255, 0.45);
}

.idle-count-warn {
  color: rgb(var(--v-theme-warning));
}

.idle-count-badge {
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}

/* ── 遥测转发: 端口开关行 (布局同 idle-row, 整行不可点) ── */
.telem-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.telem-main {
  min-width: 0;
}

/* v-switch 默认外边距较大, 收紧以对齐行内文字 */
.telem-row .telem-switch {
  flex: 0 0 auto;
  margin: 0;
}

/* ── 提示条: 默认 warning 配色, 变体见 .hint-neutral / .hint-error ── */
.cal-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 179, 0, 0.5);
  background: rgba(255, 179, 0, 0.1);
  color: rgba(255, 235, 190, 0.9);
  font-size: 0.75rem;
  line-height: 1.45;
}

.hint-neutral {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.7);
}

.hint-error {
  border-color: rgba(255, 82, 82, 0.5);
  background: rgba(255, 82, 82, 0.1);
  color: rgba(255, 205, 210, 0.9);
}
</style>
