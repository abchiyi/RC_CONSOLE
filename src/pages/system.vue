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

    <v-row v-if="serial.connected" dense>
      <!-- 实时状态卡片 -->
      <v-col cols="12" md="6">
        <v-sheet rounded="lg" class="pa-3 mb-3">
          <div class="card-head">
            <div class="card-title-row">
              <v-icon color="primary" class="me-2">mdi-monitor-dashboard</v-icon>
              <span class="text-subtitle-1 font-weight-bold">系统状态</span>
            </div>
            <div class="card-badges">
              <v-chip v-if="stateError" color="error" size="x-small" variant="tonal">
                {{ stateError }}
              </v-chip>
              <v-chip v-else-if="power.state" :color="pollActive ? 'success' : 'grey'" size="x-small" variant="tonal">
                <v-icon start size="12">mdi-circle</v-icon>
                监控中
              </v-chip>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-row mt-2">
            <!-- 设备型号 -->
            <div class="stat-item" style="flex: 1 1 100%;">
              <span class="text-caption text-medium-emphasis">设备型号</span>
              <div class="text-body-2 font-weight-medium">{{ configStore.deviceInfo?.device ?? '--' }}</div>
            </div>

            <!-- 硬件版本 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">硬件版本</span>
              <div class="text-body-2 font-weight-medium">{{ configStore.deviceInfo?.hw_version ?? '--' }}</div>
            </div>

            <!-- 软件版本 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">软件版本</span>
              <div class="text-body-2 font-weight-medium">{{ configStore.deviceInfo?.fw_version ?? '--' }}</div>
            </div>

            <!-- 电量 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">电量</span>
              <div class="d-flex align-center ga-2 mt-1">
                <span class="text-body-2 font-weight-medium">
                  {{ power.state ? battPct(power.state.battery_pct) + '%' : '--' }}
                </span>
                <v-progress-linear v-if="power.state" :model-value="battPct(power.state.battery_pct)"
                  :color="battColor(power.state.battery_pct)" height="6" rounded style="max-width: 100px;" />
              </div>
            </div>

            <!-- 电池电压 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">电池电压</span>
              <div class="text-body-2 font-weight-medium">
                {{ power.state ? (power.state.battery_mv / 1000).toFixed(2) + ' V' : '--' }}
              </div>
            </div>

            <!-- 系统电压 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">系统电压</span>
              <div class="text-body-2 font-weight-medium">
                {{ power.state ? (power.state.sys_mv / 1000).toFixed(2) + ' V' : '--' }}
              </div>
            </div>

            <!-- 充电状态 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">充电状态</span>
              <v-chip v-if="power.state" :color="chargeColor(power.state.charge)" size="small" variant="tonal"
                class="mt-1">
                {{ chargeLabel(power.state.charge) }}
              </v-chip>
              <span v-else class="text-caption text-grey">--</span>
            </div>

            <!-- 充电电流 -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">充电电流</span>
              <div class="text-body-2 font-weight-medium">
                {{ power.state ? power.state.charge_current_ma + ' mA' : '--' }}
              </div>
            </div>

            <!-- 电流上限 (输入电流限制, 单位 A) -->
            <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
              <span class="text-caption text-medium-emphasis">电流上限</span>
              <div class="text-body-2 font-weight-medium">
                {{ power.state ? (power.state.idpm_limit_ma / 1000).toFixed(2) + ' A' : '--' }}
              </div>
            </div>
          </div>
        </v-sheet>
      </v-col>

      <!-- 空闲关机设置卡片 -->
      <v-col cols="12" md="6">
        <v-sheet rounded="lg" class="pa-3 mb-3">
          <div class="card-head">
            <div class="card-title-row">
              <v-icon color="primary" class="me-2">mdi-timer-cog</v-icon>
              <span class="text-subtitle-1 font-weight-bold">空闲关机设置</span>
            </div>
            <div class="card-badges">
              <v-chip v-if="cfgDirty" color="warning" size="x-small" variant="tonal">已修改</v-chip>
            </div>
          </div>

          <div class="d-flex flex-column ga-4 mt-2">
            <!-- 空闲警告时间 -->
            <div>
              <label class="text-caption text-medium-emphasis d-flex align-center ga-1 mb-1">
                <v-icon size="16">mdi-bell</v-icon>
                空闲警告时间 (秒)
              </label>
              <div class="d-flex align-center ga-2">
                <v-text-field v-model.number="warnSec" type="number" :min="10" :max="shutdownSec - 10" density="compact"
                  variant="outlined" hide-details style="max-width: 120px;" />
                <span class="text-caption text-medium-emphasis">≈ {{ fmtSeconds(warnSec) }}</span>
              </div>
              <div class="text-caption text-disabled mt-1">LED 慢闪 + 蜂鸣器提醒</div>
            </div>

            <!-- 关机超时时间 -->
            <div>
              <label class="text-caption text-medium-emphasis d-flex align-center ga-1 mb-1">
                <v-icon size="16">mdi-power</v-icon>
                关机超时时间 (秒)
              </label>
              <div class="d-flex align-center ga-2">
                <v-text-field v-model.number="shutdownSec" type="number" :min="warnSec + 10" :max="3600"
                  density="compact" variant="outlined" hide-details style="max-width: 120px;" />
                <span class="text-caption text-medium-emphasis">≈ {{ fmtSeconds(shutdownSec) }}</span>
              </div>
              <div class="text-caption text-disabled mt-1">LED 倒计时后 Deep Sleep 关机</div>
            </div>
          </div>
        </v-sheet>
      </v-col>

      <!-- 调试模式卡片 -->
      <v-col cols="12" md="6">
        <v-sheet rounded="lg" class="pa-3 mb-3" :color="power.debugMode ? 'warning' : undefined">
          <div class="card-head">
            <div class="card-title-row">
              <v-icon :color="power.debugMode ? 'warning' : 'grey'" class="me-2">mdi-bug</v-icon>
              <span class="text-subtitle-1 font-weight-bold">调试模式</span>
            </div>
            <div class="card-badges">
              <v-switch v-model="debugSwitch" :color="power.debugMode ? 'warning' : undefined" :loading="debugLoading"
                density="compact" hide-details inset @update:model-value="toggleDebugMode" />
            </div>
          </div>

          <div class="mt-2">
            <v-alert v-if="power.debugMode" color="warning" variant="tonal" density="compact" icon="mdi-alert"
              class="mb-2">
              调试模式已开启：USB 供电和串口通讯不再阻止空闲关机计时。
              调试完成后请关闭此开关。
            </v-alert>
            <p v-else class="text-caption text-medium-emphasis mb-0">
              开启后，USB 供电和串口通讯将不阻止空闲关机，
              方便调试验证超时关机功能。
            </p>
          </div>
        </v-sheet>
      </v-col>

      <!-- 恢复出厂设置卡片 -->
      <v-col cols="12" md="6">
        <v-sheet rounded="lg" class="pa-3 mb-3">
          <div class="card-head">
            <div class="card-title-row">
              <v-icon color="error" class="me-2">mdi-alert-octagram</v-icon>
              <span class="text-subtitle-1 font-weight-bold">恢复出厂设置</span>
            </div>
          </div>

          <div class="mt-2">
            <v-alert color="error" variant="tonal" density="compact" class="mb-2">
              此操作会直接抹除 NVS 分区全部数据（模型配置、校准、电源设置等），且不可恢复。
            </v-alert>
            <p class="text-caption text-medium-emphasis mb-0">
              执行后设备将自动重启，你需要重新连接并重新配置设备。
            </p>

            <v-alert v-if="factoryResetError" color="error" variant="tonal" density="compact" class="mt-3">
              {{ factoryResetError }}
            </v-alert>
            <v-alert v-else-if="factoryResetMsg" color="success" variant="tonal" density="compact" class="mt-3">
              {{ factoryResetMsg }}
            </v-alert>

            <div class="mt-3">
              <v-btn color="error" size="small" variant="tonal" prepend-icon="mdi-delete-alert"
                :disabled="!serial.connected || factoryResetBusy" :loading="factoryResetBusy"
                @click="factoryResetDialog = true">
                抹除 NVS 并重启
              </v-btn>
            </div>
          </div>
        </v-sheet>
      </v-col>
    </v-row>

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
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { usePowerStore } from '@/stores/power'
import { useConfigStore } from '@/stores/config'
import { serialService } from '@/services/SerialService'
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
const warnSec = ref(power.cfg.idle_warning_s)
const shutdownSec = ref(power.cfg.idle_shutdown_s)
const cfgDirty = ref(false)
const stateError = ref('')

// ========== 操作提示 (snackbar) ==========
const snackbarVisible = ref(false)
const snackbarMsg = ref('')

// ========== 调试模式 ==========
const debugSwitch = ref(power.debugMode)
const debugLoading = ref(false)

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

async function toggleDebugMode(v: boolean | null) {
  debugLoading.value = true
  try {
    await power.setDebugMode(v ?? false)
  } catch {
    debugSwitch.value = !v  // 失败回滚
  }
  debugLoading.value = false
}


// 同步 store → switch (来自 get_power_state 轮询)
watch(() => power.debugMode, (v) => {
  debugSwitch.value = v
})

// 同步 store → 表单
watch(() => power.cfg, (c) => {
  warnSec.value = c.idle_warning_s
  shutdownSec.value = c.idle_shutdown_s
  cfgDirty.value = false
}, { deep: true })

// 表单变更标记
watch([warnSec, shutdownSec], () => {
  const c = power.cfg
  cfgDirty.value = warnSec.value !== c.idle_warning_s || shutdownSec.value !== c.idle_shutdown_s
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
    warnSec.value = power.cfg.idle_warning_s
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
function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}分${sec}秒`
}

function battPct(raw: number): number {
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function battColor(raw: number): string {
  const p = battPct(raw)
  if (p > 50) return 'success'
  if (p > 20) return 'warning'
  return 'error'
}

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
})

onUnmounted(() => {
  stopPoll()
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

/* 卡片头部: 左标题 + 右状态 */
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-title-row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 8px;
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

.stat-item {
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gap-row {
  column-gap: 16px;
  row-gap: 8px;
}
</style>
