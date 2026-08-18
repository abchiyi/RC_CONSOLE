<template>
  <div>
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6">
        <v-icon class="mr-2">mdi-antenna</v-icon>
        ELRS
      </v-toolbar-title>

      <v-spacer />

      <v-btn
        v-if="serial.connected"
        color="primary"
        prepend-icon="mdi-database-refresh"
        size="small"
        variant="tonal"
        :loading="link.dynPwrLoading"
        @click="refreshElrsFields"
      >
        重新扫描字段
      </v-btn>
    </v-toolbar>

    <v-alert v-if="!serial.connected" class="ma-3" color="info" icon="mdi-information" variant="tonal">
      请先连接设备以管理 ELRS 参数
    </v-alert>

    <!-- ========== 链路概览 ========== -->
    <v-card class="ma-3" variant="tonal">
      <v-card-item>
        <v-card-title class="text-subtitle-1">
          <v-icon class="mr-2" color="primary">mdi-view-dashboard</v-icon>
          链路概览
          <v-chip v-if="link.moduleAlive" class="ml-2" color="success" size="x-small" variant="tonal">
            {{ link.fieldCount }} 字段
          </v-chip>
          <v-chip v-else class="ml-2" color="grey" size="x-small" variant="tonal">未就绪</v-chip>
        </v-card-title>
      </v-card-item>

      <v-card-text>
        <div v-if="!serial.connected || (!link.valid && !link.moduleAlive)" class="d-flex align-center ga-2">
          <v-icon size="20" color="grey">mdi-information</v-icon>
          <span class="text-caption text-medium-emphasis">
            {{ !serial.connected ? '请先连接设备' : 'ELRS 模块未响应，无法读取配置' }}
          </span>
        </div>

        <template v-else>
          <div class="d-flex flex-wrap align-center mb-4">
            <v-icon size="18" class="mr-2" :color="txPwrColor">mdi-broadcast</v-icon>
            <span class="text-caption text-medium-emphasis">当前 TX 功率：</span>
            <v-chip class="ml-2" :color="txPwrColor" size="x-small" variant="tonal">
              {{ txPowerLabel }}
            </v-chip>
          </div>

          <!-- 上行链路 -->
          <div class="d-flex flex-wrap align-center mb-2">
            <v-icon size="18" class="mr-2" :color="ulLqColor">mdi-arrow-up-bold</v-icon>
            <span class="text-caption text-medium-emphasis">上行 (UL)：</span>
            <v-chip class="ml-2" :color="ulLqColor" size="x-small" variant="tonal">
              RSSI {{ link.ulRssi }} dBm · LQ {{ link.ulLq }}%
            </v-chip>
          </div>

          <!-- 下行链路 -->
          <div class="d-flex flex-wrap align-center mb-2">
            <v-icon size="18" class="mr-2" :color="dlLqColor">mdi-arrow-down-bold</v-icon>
            <span class="text-caption text-medium-emphasis">下行 (DL)：</span>
            <v-chip class="ml-2" :color="dlLqColor" size="x-small" variant="tonal">
              RSSI {{ link.dlRssi }} dBm · LQ {{ link.dlLq }}%
            </v-chip>
          </div>

          <!-- RF 模式 -->
          <div v-if="link.rfMode" class="d-flex flex-wrap align-center mb-2">
            <v-icon size="18" class="mr-2" color="primary">mdi-speedometer</v-icon>
            <span class="text-caption text-medium-emphasis">RF 模式：</span>
            <v-chip class="ml-2" color="primary" size="x-small" variant="tonal">
              {{ rfModeLabel }}
            </v-chip>
          </div>

          <div v-if="link.dynPowerOn !== null" class="d-flex flex-wrap align-center">
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
            <v-chip class="ml-2" :color="link.dynPowerOn ? 'warning' : 'success'" size="x-small" variant="tonal">
              {{ link.dynPowerOn ? '开' : '关' }}
            </v-chip>
          </div>
          <div v-else class="d-flex align-center ga-2">
            <v-icon size="20" color="amber">mdi-help-circle</v-icon>
            <span class="text-caption text-medium-emphasis">未找到动态功率字段，请刷新字段列表</span>
          </div>

          <div v-if="link.dynPowerField" class="mt-2">
            <span class="text-caption text-disabled">字段名: {{ link.dynPowerField }}</span>
          </div>

          <div v-if="elrsMsg" class="mt-2">
            <v-chip :color="elrsMsgOk ? 'success' : 'error'" size="x-small" variant="tonal">
              {{ elrsMsg }}
            </v-chip>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <!-- ========== 快速控制（移动友好） ========== -->
    <v-card v-if="serial.connected" class="ma-3" variant="tonal">
      <v-card-item>
        <v-card-title class="text-subtitle-1">
          <v-icon class="mr-2" color="primary">mdi-gamepad-variant</v-icon>
          快速控制
        </v-card-title>
      </v-card-item>
      <v-card-text>
        <!-- TX WiFi -->
        <div class="d-flex align-center mb-2">
          <v-icon size="24" class="mr-3" color="primary">mdi-wifi</v-icon>
          <div class="flex-grow-1">
            <div class="text-body-2 font-weight-medium">TX WiFi 控制台</div>
          </div>
          <v-btn size="small" color="success" variant="tonal" class="mr-2"
                 :disabled="!link.moduleAlive" :loading="wifiBusy" @click="wifiStart">
            开启
          </v-btn>
          <v-btn size="small" color="error" variant="tonal"
                 :disabled="!link.moduleAlive" :loading="wifiBusy" @click="wifiStop">
            关闭
          </v-btn>
        </div>
        <!-- 蓝牙摇杆 -->
        <div class="d-flex align-center mb-2">
          <v-icon size="24" class="mr-3" color="primary">mdi-bluetooth</v-icon>
          <div class="flex-grow-1">
            <div class="text-body-2 font-weight-medium">蓝牙摇杆</div>
          </div>
          <v-btn size="small" color="success" variant="tonal" class="mr-2"
                 :disabled="!link.moduleAlive" :loading="bleBusy" @click="bleStart">
            开启
          </v-btn>
          <v-btn size="small" color="error" variant="tonal"
                 :disabled="!link.moduleAlive" :loading="bleBusy" @click="bleStop">
            关闭
          </v-btn>
        </div>
        <!-- 对频 -->
        <v-btn block size="large" color="warning" class="mt-2" prepend-icon="mdi-link-variant"
               :disabled="!link.moduleAlive" :loading="bindBusy" @click="doBind">
          对频
        </v-btn>
        <v-divider class="my-3" />
        <!-- 高级 -->
        <div class="d-flex align-center">
          <div class="flex-grow-1">
            <div class="text-body-2 font-weight-medium">高级</div>
            <div class="text-caption text-medium-emphasis">字段配置表</div>
          </div>
          <v-switch v-model="showAdvanced" color="info" hide-details inset />
        </div>
      </v-card-text>
    </v-card>

    <!-- ========== 字段配置（高级，默认隐藏） ========== -->
    <v-card v-if="serial.connected && showAdvanced" class="ma-3" variant="tonal">
      <v-card-item>
        <v-card-title class="text-subtitle-1">
          <v-icon class="mr-2" color="primary">mdi-file-tree</v-icon>
          字段配置
          <v-chip class="ml-2" color="success" size="x-small" variant="tonal">{{ link.fields.length }} 个字段</v-chip>
        </v-card-title>
      </v-card-item>
      <v-card-text>
        <div v-if="!link.valid && !link.moduleAlive" class="d-flex align-center ga-2 mb-2">
          <v-icon size="20" color="grey">mdi-information</v-icon>
          <span class="text-caption text-medium-emphasis">ELRS 模块未响应，无法读取配置</span>
        </div>
        <template v-else>
          <div class="d-flex flex-wrap align-center ga-2 mb-2">
            <v-switch
              v-model="elrsShowHidden"
              density="compact"
              hide-details
              inset
              color="info"
            >
              <template #label>
                <span class="text-caption">显示隐藏字段</span>
              </template>
            </v-switch>
          </div>

          <ElrsFieldTree
            :key="link.fieldsVersion"
            :fields="link.fields"
            :show-hidden="elrsShowHidden"
            :updating-id="elrsUpdatingFieldId"
            @set="applyElrsFieldValue"
          />
        </template>

        <div v-if="elrsMsg" class="mt-3">
          <v-chip :color="elrsMsgOk ? 'success' : 'error'" size="x-small" variant="tonal">
            {{ elrsMsg }}
          </v-chip>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useLinkStatsStore, type ElrsFieldInfo } from '@/stores/linkStats'
import { useChannelStore } from '@/stores/channels'
import ElrsFieldTree from '@/components/elrs/ElrsFieldTree.vue'

const serial = useSerialStore()
const link = useLinkStatsStore()
const chStore = useChannelStore()

// ---- 快速控制（按钮直发命令，无状态机） ----
const showAdvanced = ref(false)
const wifiBusy = ref(false)
const bleBusy = ref(false)
const bindBusy = ref(false)

async function wifiStart() {
  wifiBusy.value = true
  const ok = await link.wifiStart()
  wifiBusy.value = false
  showElrsMsg(ok ? 'WiFi 已开启' : 'WiFi 开启失败（字段未就绪或未找到）', ok)
}

async function wifiStop() {
  wifiBusy.value = true
  const ok = await link.wifiStop()
  wifiBusy.value = false
  showElrsMsg(ok ? 'WiFi 已关闭' : 'WiFi 关闭失败（字段未就绪或未找到）', ok)
}

async function bleStart() {
  bleBusy.value = true
  const ok = await link.bleStart()
  bleBusy.value = false
  showElrsMsg(ok ? '蓝牙摇杆已开启' : '蓝牙摇杆开启失败（字段未就绪或未找到）', ok)
}

async function bleStop() {
  bleBusy.value = true
  const ok = await link.bleStop()
  bleBusy.value = false
  showElrsMsg(ok ? '蓝牙摇杆已关闭' : '蓝牙摇杆关闭失败（字段未就绪或未找到）', ok)
}

async function doBind() {
  bindBusy.value = true
  const ok = await link.bindStart()
  bindBusy.value = false
  showElrsMsg(ok ? '对频指令已发送' : '对频失败（字段未就绪或未找到）', ok)
}

// ---- 链路概览 / 字段配置 ----
const dynPwrSwitch = ref(link.dynPowerOn ?? false)
const dynPwrToggling = ref(false)
const elrsMsg = ref('')
const elrsMsgOk = ref(true)
const elrsUpdatingFieldId = ref<number | null>(null)
const elrsShowHidden = ref(false)

const txPwrColor = computed(() => {
  const v = link.txPower
  if (v >= 30) return 'error'
  if (v >= 20) return 'warning'
  if (v > 0) return 'success'
  return 'grey'
})

const txPowerLabel = computed(() => {
  const v = link.txPower
  if (v <= 0) return '--'
  if (v <= 7) {
    const dbmMap = [10, 14, 17, 20, 24, 27, 30, 33]
    return `${dbmMap[v] ?? v} dBm`
  }
  return `${v} dBm`
})

// LQ 颜色：>80 绿色，>50 黄色，<=50 红色（与 AppBar 一致）
const ulLqColor = computed(() => link.ulLq > 80 ? 'success' : link.ulLq > 50 ? 'warning' : 'error')
const dlLqColor = computed(() => link.dlLq > 80 ? 'success' : link.dlLq > 50 ? 'warning' : 'error')

// RF 模式：暂直接显示原始索引，映射问题后续再修复
const rfModeLabel = computed(() => `${link.rfMode}`)

async function applyElrsFieldValue(payload: { field: ElrsFieldInfo; value: number }) {
  const { field, value } = payload
  elrsUpdatingFieldId.value = field.id
  elrsMsg.value = ''
  try {
    const ok = await link.setParam(field.id, value)
    if (ok) {
      showElrsMsg(`已写入 ${field.name}`, true)
    } else {
      showElrsMsg(`写入失败: ${field.name}`, false)
    }
  } catch {
    showElrsMsg(`写入失败: ${field.name}`, false)
  }
  elrsUpdatingFieldId.value = null
}

function showElrsMsg(msg: string, ok: boolean) {
  elrsMsg.value = msg
  elrsMsgOk.value = ok
  setTimeout(() => {
    elrsMsg.value = ''
  }, 3000)
}

/** 手动重扫：无条件清空固件缓存并强制重新发现字段 */
async function refreshElrsFields() {
  elrsMsg.value = ''
  await link.rescanFields()
  if (link.fields.length > 0) {
    dynPwrSwitch.value = link.dynPowerOn ?? false
    showElrsMsg(`字段缓存已重建，加载 ${link.fields.length} 个字段`, true)
  } else {
    showElrsMsg('重新扫描超时，可稍后重试', false)
  }
}

/** 自动加载：连接/模块上线时仅拉取当前缓存（缓存为空时固件自动触发发现） */
async function autoLoadFields() {
  await link.fetchFields()
  dynPwrSwitch.value = link.dynPowerOn ?? false
}

async function toggleDynPower(v: boolean | null) {
  dynPwrToggling.value = true
  elrsMsg.value = ''
  try {
    const ok = await link.toggleDynPower(v ?? false)
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

watch(() => link.moduleAlive, (alive) => {
  if (alive && link.dynPowerOn === null) {
    autoLoadFields()
  }
})

/** 进入页面/连接建立后：停通道流 → 开链路流 → 拉字段 */
async function enterPage(): Promise<void> {
  if (!serial.connected) return
  await chStore.stopPolling()      // 停通道流，释放单流会话
  await link.startLinkStream(100)  // 链路统计走流式（10Hz，与原轮询频率一致）
  await autoLoadFields()           // 无条件拉取：缓存为空时固件异步发现，fetchFields 内部轮询等待
}

// 直接打开/刷新本页后连接：onMounted 时未连接会跳过初始化，连接建立后补跑
watch(() => serial.connected, (connected) => {
  if (connected) enterPage()
})

onMounted(enterPage)

onUnmounted(async () => {
  if (!serial.connected) return
  await link.stopLinkStream()      // 离开页面停止链路流
  await chStore.startPolling()     // 恢复通道流
})
</script>
