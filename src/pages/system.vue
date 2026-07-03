<template>
  <div>
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6">
        <v-icon class="mr-2">mdi-cog</v-icon>
        系统
      </v-toolbar-title>

      <v-spacer />

      <v-btn v-if="serial.connected" class="mr-2" color="primary" prepend-icon="mdi-reload"
        size="small" variant="tonal" @click="reloadAll" :loading="power.loading">
        重新加载
      </v-btn>
      <v-btn v-if="serial.connected && cfgDirty" color="success" prepend-icon="mdi-content-save"
        size="small" variant="tonal" @click="saveSettings" :loading="power.loading">
        保存到设备
      </v-btn>
    </v-toolbar>

    <!-- 未连接提示 -->
    <v-alert v-if="!serial.connected" class="ma-4" color="info" icon="mdi-information" variant="tonal">
      请先连接设备以管理系统设置
    </v-alert>

    <v-row v-if="serial.connected" dense class="pa-4">
      <!-- 实时状态卡片 -->
      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon color="primary">mdi-monitor-dashboard</v-icon>
            </template>
            <v-card-title class="text-body-1">系统状态</v-card-title>
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

          <v-card-text>
            <div class="d-flex flex-wrap gap-row">
              <!-- 运行状态 -->
              <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
                <span class="text-caption text-medium-emphasis">运行状态</span>
                <v-chip
                  v-if="power.state"
                  :color="stateColor(power.state.state)"
                  size="small" variant="tonal" class="mt-1"
                >
                  {{ stateLabel(power.state.state) }}
                </v-chip>
                <span v-else class="text-caption text-grey">--</span>
              </div>

              <!-- 充电状态 -->
              <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
                <span class="text-caption text-medium-emphasis">充电状态</span>
                <v-chip
                  v-if="power.state"
                  :color="chargeColor(power.state.charge)"
                  size="small" variant="tonal" class="mt-1"
                >
                  {{ chargeLabel(power.state.charge) }}
                </v-chip>
                <span v-else class="text-caption text-grey">--</span>
              </div>

              <!-- 电池电压 -->
              <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
                <span class="text-caption text-medium-emphasis">电池电压</span>
                <div class="text-body-2 font-weight-medium">
                  {{ power.state ? (power.state.battery_mv / 1000).toFixed(2) + ' V' : '--' }}
                </div>
              </div>

              <!-- 电量 -->
              <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
                <span class="text-caption text-medium-emphasis">电量</span>
                <div class="d-flex align-center ga-2 mt-1">
                  <span class="text-body-2 font-weight-medium">
                    {{ power.state ? battPct(power.state.battery_pct) + '%' : '--' }}
                  </span>
                  <v-progress-linear
                    v-if="power.state"
                    :model-value="battPct(power.state.battery_pct)"
                    :color="battColor(power.state.battery_pct)"
                    height="6" rounded
                    style="max-width: 100px;"
                  />
                </div>
              </div>

              <!-- 空闲时长 -->
              <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
                <span class="text-caption text-medium-emphasis">空闲时长</span>
                <div class="text-body-2 font-weight-medium">
                  {{ power.state ? fmtSeconds(power.state.idle_s) : '--' }}
                </div>
              </div>

              <!-- 距关机 -->
              <div class="stat-item" style="flex: 1 1 45%; min-width: 140px;">
                <span class="text-caption text-medium-emphasis">距关机</span>
                <div class="text-body-2 font-weight-medium" :class="power.state && power.state.state !== 'normal' ? 'text-warning' : 'text-grey'">
                  {{ power.state && power.state.state !== 'normal'
                    ? fmtSeconds(power.cfg.idle_shutdown_s - power.state.idle_s)
                    : '--' }}
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- 空闲关机设置卡片 -->
      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon color="primary">mdi-timer-cog</v-icon>
            </template>
            <v-card-title class="text-body-1">空闲关机设置</v-card-title>
            <template #append>
              <v-chip v-if="cfgDirty" color="warning" size="x-small" variant="tonal">已修改</v-chip>
              <v-chip v-if="cfgOk" color="success" size="x-small" variant="tonal">{{ cfgOk }}</v-chip>
              <v-chip v-if="cfgErr" color="error" size="x-small" variant="tonal">{{ cfgErr }}</v-chip>
            </template>
          </v-card-item>

          <v-card-text>
            <div class="d-flex flex-column ga-4">
              <!-- 空闲警告时间 -->
              <div>
                <label class="text-caption text-medium-emphasis d-flex align-center ga-1 mb-1">
                  <v-icon size="16">mdi-bell</v-icon>
                  空闲警告时间 (秒)
                </label>
                <div class="d-flex align-center ga-2">
                  <v-text-field
                    v-model.number="warnSec"
                    type="number"
                    :min="10"
                    :max="shutdownSec - 10"
                    density="compact"
                    variant="outlined"
                    hide-details
                    style="max-width: 120px;"
                  />
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
                  <v-text-field
                    v-model.number="shutdownSec"
                    type="number"
                    :min="warnSec + 10"
                    :max="3600"
                    density="compact"
                    variant="outlined"
                    hide-details
                    style="max-width: 120px;"
                  />
                  <span class="text-caption text-medium-emphasis">≈ {{ fmtSeconds(shutdownSec) }}</span>
                </div>
                <div class="text-caption text-disabled mt-1">LED 倒计时后 Deep Sleep 关机</div>
              </div>
            </div>
          </v-card-text>

          <v-card-actions class="pa-4 pt-0">
            <v-btn
              color="success" size="small" variant="tonal"
              :disabled="!cfgDirty"
              :loading="power.loading"
              prepend-icon="mdi-content-save"
              @click="saveSettings"
            >
              保存到设备
            </v-btn>
            <v-btn
              color="primary" size="small" variant="text"
              :loading="power.loading"
              prepend-icon="mdi-reload"
              @click="reloadSettings"
            >
              重新加载
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- 调试模式卡片 -->
      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined" :color="power.debugMode ? 'warning' : undefined">
          <v-card-item>
            <template #prepend>
              <v-icon :color="power.debugMode ? 'warning' : 'grey'">mdi-bug</v-icon>
            </template>
            <v-card-title class="text-body-1">调试模式</v-card-title>
            <template #append>
              <v-switch
                v-model="debugSwitch"
                :color="power.debugMode ? 'warning' : undefined"
                :loading="debugLoading"
                density="compact"
                hide-details
                inset
                @update:model-value="toggleDebugMode"
              />
            </template>
          </v-card-item>

          <v-card-text>
            <v-alert
              v-if="power.debugMode"
              color="warning"
              variant="tonal"
              density="compact"
              icon="mdi-alert"
              class="mb-2"
            >
              调试模式已开启：USB 供电和串口通讯不再阻止空闲关机计时。
              调试完成后请关闭此开关。
            </v-alert>
            <p v-else class="text-caption text-medium-emphasis mb-0">
              开启后，USB 供电和串口通讯将不阻止空闲关机，
              方便调试验证超时关机功能。
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- ELRS 射频配置卡片 -->
      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon color="primary">mdi-antenna</v-icon>
            </template>
            <v-card-title class="text-body-1">ELRS 射频配置</v-card-title>
            <template #append>
              <v-chip v-if="link.moduleAlive" color="success" size="x-small" variant="tonal">
                {{ link.fieldCount }} 字段
              </v-chip>
              <v-chip v-else color="grey" size="x-small" variant="tonal">
                未就绪
              </v-chip>
            </template>
          </v-card-item>

          <v-card-text>
            <!-- 未连接或模块未就绪 -->
            <div v-if="!serial.connected || !link.moduleAlive" class="d-flex align-center ga-2">
              <v-icon size="20" color="grey">mdi-information</v-icon>
              <span class="text-caption text-medium-emphasis">
                {{ !serial.connected ? '请先连接设备' : 'ELRS 模块未响应，无法读取配置' }}
              </span>
            </div>

            <template v-else>
              <!-- TX 功率当前档位 -->
              <div class="d-flex align-center mb-4">
                <v-icon size="18" class="mr-2" :color="txPwrColor">mdi-broadcast</v-icon>
                <span class="text-caption text-medium-emphasis">当前 TX 功率：</span>
                <v-chip
                  class="ml-2"
                  :color="txPwrColor"
                  size="x-small" variant="tonal"
                >
                  {{ txPowerLabel }}
                </v-chip>
              </div>

              <!-- 动态功率开关 -->
              <div v-if="link.dynPowerOn !== null" class="d-flex align-center">
                <v-icon size="18" class="mr-2" :color="link.dynPowerOn ? 'warning' : 'success'">
                  mdi-shimmer
                </v-icon>
                <span class="text-caption text-medium-emphasis">动态功率：</span>
                <v-switch
                  class="ml-2"
                  v-model="dynPwrSwitch"
                  :color="dynPwrSwitch ? 'warning' : 'success'"
                  :loading="dynPwrToggling"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="toggleDynPower"
                />
                <v-chip
                  class="ml-2"
                  :color="link.dynPowerOn ? 'warning' : 'success'"
                  size="x-small" variant="tonal"
                >
                  {{ link.dynPowerOn ? '开' : '关' }}
                </v-chip>
              </div>
              <div v-else class="d-flex align-center ga-2">
                <v-icon size="20" color="amber">mdi-help-circle</v-icon>
                <span class="text-caption text-medium-emphasis">
                  未找到动态功率字段，请刷新字段列表
                </span>
              </div>

              <!-- 字段名 (调试用) -->
              <div v-if="link.dynPowerField" class="mt-2">
                <span class="text-caption text-disabled">字段名: {{ link.dynPowerField }}</span>
              </div>

              <!-- 操作反馈 -->
              <div v-if="elrsMsg" class="mt-2">
                <v-chip :color="elrsMsgOk ? 'success' : 'error'" size="x-small" variant="tonal">
                  {{ elrsMsg }}
                </v-chip>
              </div>
            </template>
          </v-card-text>

          <v-card-actions v-if="serial.connected" class="pa-4 pt-0">
            <v-btn
              color="primary" size="small" variant="tonal"
              :loading="link.dynPwrLoading"
              prepend-icon="mdi-refresh"
              @click="refreshElrsFields"
            >
              刷新字段列表
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { usePowerStore } from '@/stores/power'
import { useLinkStatsStore } from '@/stores/linkStats'

const serial = useSerialStore()
const power = usePowerStore()
const link   = useLinkStatsStore()

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
const cfgOk = ref('')
const cfgErr = ref('')
const stateError = ref('')

// ========== 调试模式 ==========
const debugSwitch = ref(power.debugMode)
const debugLoading = ref(false)

async function toggleDebugMode(v: boolean) {
  debugLoading.value = true
  try {
    await power.setDebugMode(v)
  } catch {
    debugSwitch.value = !v  // 失败回滚
  }
  debugLoading.value = false
}

// ========== ELRS 射频配置 ==========
const dynPwrSwitch    = ref(link.dynPowerOn ?? false)
const dynPwrToggling  = ref(false)
const elrsMsg         = ref('')
const elrsMsgOk       = ref(true)

// TX 功率颜色 & 标签
const txPwrColor = computed(() => {
  const v = link.txPower
  if (v >= 30) return 'error'    // 1W+
  if (v >= 20) return 'warning'  // 100mW~
  if (v > 0)  return 'success'   // low power
  return 'grey'
})

const txPowerLabel = computed(() => {
  const v = link.txPower
  if (v <= 0) return '--'
  // 0-7 档位索引 → dBm 映射
  if (v <= 7) {
    const dbmMap = [10, 14, 17, 20, 24, 27, 30, 33]
    return `${dbmMap[v] ?? v} dBm`
  }
  return `${v} dBm`
})

function showElrsMsg(msg: string, ok: boolean) {
  elrsMsg.value = msg; elrsMsgOk.value = ok
  setTimeout(() => { elrsMsg.value = '' }, 3000)
}

async function refreshElrsFields() {
  elrsMsg.value = ''
  await link.fetchFields()
  if (link.fields.value.length > 0) {
    dynPwrSwitch.value = link.dynPowerOn ?? false
    showElrsMsg(`已加载 ${link.fields.value.length} 个字段`, true)
  } else {
    showElrsMsg('字段加载超时或模块未响应', false)
  }
}

async function toggleDynPower(v: boolean) {
  dynPwrToggling.value = true
  elrsMsg.value = ''
  try {
    const ok = await link.toggleDynPower(v)
    if (ok) {
      showElrsMsg(v ? '动态功率已开启' : '动态功率已关闭', true)
    } else {
      dynPwrSwitch.value = !v
      showElrsMsg('设置失败，请先刷新字段列表', false)
    }
  } catch {
    dynPwrSwitch.value = !v
    showElrsMsg('设置失败', false)
  }
  dynPwrToggling.value = false
}

// 同步 store → switch (来自 get_power_state 轮询)
watch(() => power.debugMode, (v) => {
  debugSwitch.value = v
})

// ELRS 模块就绪时自动刷新字段列表
watch(() => link.moduleAlive, (alive) => {
  if (alive && link.dynPowerOn.value === null) {
    refreshElrsFields()
  }
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
  cfgOk.value = ''
  cfgErr.value = ''
})

// 串口状态监听
watch(() => serial.connected, (connected) => {
  if (connected) {
    reloadAll()
  } else {
    stopPoll()
    power.state = null
  }
})

async function reloadAll() {
  cfgOk.value = ''; cfgErr.value = ''; stateError.value = ''
  try {
    await power.fetchCfg()
    warnSec.value = power.cfg.idle_warning_s
    shutdownSec.value = power.cfg.idle_shutdown_s
    cfgDirty.value = false
    startPoll()
    // 同时加载 ELRS 字段列表
    if (link.moduleAlive) refreshElrsFields()
  } catch {
    cfgErr.value = '加载配置失败'
  }
}

async function reloadSettings() {
  cfgOk.value = ''; cfgErr.value = ''
  try {
    await power.fetchCfg()
    warnSec.value = power.cfg.idle_warning_s
    shutdownSec.value = power.cfg.idle_shutdown_s
    cfgDirty.value = false
  } catch {
    cfgErr.value = '加载配置失败'
  }
}

async function saveSettings() {
  cfgOk.value = ''; cfgErr.value = ''
  try {
    await power.saveCfg({
      idle_warning_s: warnSec.value,
      idle_shutdown_s: shutdownSec.value,
    })
    cfgDirty.value = false
    cfgOk.value = '保存成功'
    setTimeout(() => { cfgOk.value = '' }, 3000)
  } catch {
    cfgErr.value = '保存失败'
  }
}

// ========== 工具函数 ==========
function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}分${sec}秒`
}

function battPct(raw: number): number {
  return Math.round(raw / 255 * 100)
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
  if (serial.connected) reloadAll()
})

onUnmounted(stopPoll)
</script>

<style scoped>
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
