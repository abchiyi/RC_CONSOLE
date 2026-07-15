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

    <v-row dense class="pa-4">
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

      <!-- 恢复出厂设置卡片 -->
      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined" color="error">
          <v-card-item>
            <template #prepend>
              <v-icon color="error">mdi-alert-octagram</v-icon>
            </template>
            <v-card-title class="text-body-1">恢复出厂设置</v-card-title>
          </v-card-item>

          <v-card-text>
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
          </v-card-text>

          <v-card-actions class="pa-4 pt-0">
            <v-btn
              color="error"
              size="small"
              variant="tonal"
              prepend-icon="mdi-delete-alert"
              :disabled="!serial.connected || factoryResetBusy"
              :loading="factoryResetBusy"
              @click="factoryResetDialog = true"
            >
              抹除 NVS 并重启
            </v-btn>
          </v-card-actions>
        </v-card>
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
          <v-btn
            color="error"
            variant="tonal"
            :loading="factoryResetBusy"
            @click="startFactoryResetNvs"
          >
            确认抹除
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { usePowerStore } from '@/stores/power'
import { serialService } from '@/services/SerialService'

const serial = useSerialStore()
const power = usePowerStore()

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

    const handler = (line: string) => {
      try {
        const json = JSON.parse(line) as Record<string, unknown>
        if (json.cmd !== 'factory_reset_nvs') return
        cleanup()
        resolve(json)
      } catch {
        // ignore non JSON lines
      }
    }

    const cleanup = () => {
      clearTimeout(timer)
      serialService.removeLineListener(handler)
    }

    serialService.addLineListener(handler)
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

onUnmounted(() => {
  stopPoll()
})
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
