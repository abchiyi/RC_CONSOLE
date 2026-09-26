<template>
  <div class="elrs-page">
    <!-- 统一提示: 配色由 useNotice 决定 (成功=绿 / 失败=红 / 提醒=橙), tonal 变体不刺眼 -->
    <v-snackbar v-model="snackbarVisible" :color="snackbarColor" :timeout="noticeTimeout" variant="tonal">
      {{ elrsMsg }}
    </v-snackbar>

    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-antenna</v-icon>
        ELRS
      </v-toolbar-title>
    </v-toolbar>

    <!-- 未连接 -->
    <v-alert v-if="!serial.connected" class="ma-3" color="primary" border="start" border-color="primary"
      icon="mdi-information" variant="tonal">
      请先连接设备以管理 ELRS 参数
    </v-alert>

    <div v-if="serial.connected" class="elrs-root">
      <!-- 链路概览卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="primary" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-access-point-network</v-icon>
            </v-avatar>
          </template>
          <v-card-title>链路概览</v-card-title>
          <v-card-subtitle>CRSF 实时上报的上下行链路质量与 RF 模式</v-card-subtitle>
          <template #append>
            <v-chip v-if="link.moduleAlive" color="success" size="x-small" variant="tonal">
              <v-icon start size="12">mdi-circle</v-icon>
              {{ link.fieldCount }} 项参数
            </v-chip>
            <v-chip v-else color="grey" size="x-small" variant="tonal">未就绪</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div v-if="!link.valid && !link.moduleAlive" class="cal-hint hint-neutral">
            <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
            <span>ELRS 模块未响应，链路统计暂不可用</span>
          </div>

          <div v-else class="stat-groups">
            <!-- 上行链路 -->
            <div class="stat-group">
              <div class="stat-group-title">上行 UL</div>
              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">RSSI</span>
                  <span class="stat-value mono">{{ rssiText(link.ulRssi) }} dBm</span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">LQ</span>
                  <span class="stat-value">
                    <v-chip :color="ulLqColor" size="x-small" variant="tonal">{{ link.ulLq }}%</v-chip>
                  </span>
                </div>
              </div>
            </div>

            <!-- 下行链路 -->
            <div class="stat-group">
              <div class="stat-group-title">下行 DL</div>
              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">RSSI</span>
                  <span class="stat-value mono">{{ rssiText(link.dlRssi) }} dBm</span>
                </div>
                <div class="stat-kv">
                  <span class="stat-label">LQ</span>
                  <span class="stat-value">
                    <v-chip :color="dlLqColor" size="x-small" variant="tonal">{{ link.dlLq }}%</v-chip>
                  </span>
                </div>
              </div>
            </div>

            <!-- 发射功率 -->
            <div class="stat-group">
              <div class="stat-group-title">发射功率</div>
              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">TX</span>
                  <span class="stat-value mono">{{ txPowerLabel }}</span>
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- 模块参数卡片 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="primary" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-tune-variant</v-icon>
            </v-avatar>
          </template>
          <v-card-title>模块参数</v-card-title>
          <v-card-subtitle>读取并修改 ELRS 模块的运行参数</v-card-subtitle>
          <template #append>
            <v-chip color="success" size="x-small" variant="tonal">{{ link.fields.length }} 项参数</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div v-if="!link.valid && !link.moduleAlive" class="cal-hint hint-neutral">
            <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
            <span>ELRS 模块未响应，无法读取配置</span>
          </div>

          <ElrsFieldTree
            v-else
            :key="link.fieldsVersion"
            :fields="link.fields"
            :updating-id="elrsUpdatingFieldId"
            :pending-values="link.pendingValues"
            :running-commands="link.runningCommands"
            @set="applyElrsFieldValue"
          />
        </v-card-text>
      </v-card>

      <!-- 模块固件升级卡片: 外部 ELRS 模块整片镜像烧录
           按钮唤起 App.vue 的全局对话框 → 烧录过程中切页不中断 -->
      <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar color="primary" size="36" class="cal-avatar">
              <v-icon color="white" size="20">mdi-chip</v-icon>
            </v-avatar>
          </template>
          <v-card-title>模块固件升级</v-card-title>
          <v-card-subtitle>通过手柄把整片镜像写入 ELRS 外部模块</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="cal-hint hint-neutral">
            <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
            <span>烧录会擦除模块目标区域。选定镜像后请勿断电；进度与校验结果在弹窗内显示，烧录过程中切换页面不会中断。</span>
          </div>
          <v-btn block class="mt-3" color="primary" prepend-icon="mdi-upload" variant="tonal"
            @click="openModuleFlash">
            选择固件并烧录…
          </v-btn>
        </v-card-text>
      </v-card>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useLinkStatsStore, type ElrsFieldInfo } from '@/stores/linkStats'
import { useChannelStore } from '@/stores/channels'
import ElrsFieldTree from '@/components/elrs/ElrsFieldTree.vue'
import { useNotice } from '@/composables/useNotice'

const serial = useSerialStore()
const link = useLinkStatsStore()
const chStore = useChannelStore()

// ---- 链路概览 / 模块参数 ----
/** 统一提示: 配色由 type 决定 (成功=绿 / 失败=红 / 提醒=橙 / 其余=蓝) */
const {
  text: elrsMsg, color: snackbarColor, visible: snackbarVisible, show: notify, timeoutMs: noticeTimeout,
} = useNotice(2000)
const elrsUpdatingFieldId = ref<number | null>(null)

/** 打开模块固件烧录对话框 (对话框挂在 App.vue → 烧录过程中切换页面不中断) */
function openModuleFlash(): void {
  window.dispatchEvent(new CustomEvent('app:flash-elrs'))
}

/** RSSI 带符号显示: 正值补 '+', 负值保留 '-', 0 不补符号 */
function rssiText(v: number): string {
  return v > 0 ? `+${v}` : `${v}`
}

// LQ 颜色：>80 绿色，>50 黄色，<=50 红色（与 AppBar 一致）
const ulLqColor = computed(() => link.ulLq > 80 ? 'success' : link.ulLq > 50 ? 'warning' : 'error')
const dlLqColor = computed(() => link.dlLq > 80 ? 'success' : link.dlLq > 50 ? 'warning' : 'error')

// CRSF 上报的 uplink_TX_Power 是"功率代号"而非 dBm，代号是乱序的。
// 对应 ELRS 的 powerToCrsfPower():
//   10mW=1, 25mW=2, 50mW=8, 100mW=3, 250mW=7, 500mW=4, 1000mW=5, 2000mW=6
// 各档位 dBm: 10/14/17/20/24/27/30/33
const crsfPowerToDbm: Record<number, number> = {
  1: 10,
  2: 14,
  8: 17,
  3: 20,
  7: 24,
  4: 27,
  5: 30,
  6: 33,
}

/** 发射功率: 代号换算为 dBm, 未上报或未知代号显示 -- */
const txPowerLabel = computed(() => {
  const dbm = link.txPower > 0 ? crsfPowerToDbm[link.txPower] ?? 0 : 0
  return dbm > 0 ? `${dbm} dBm` : '--'
})

async function applyElrsFieldValue(payload: { field: ElrsFieldInfo; value: number }) {
  const { field, value } = payload
  elrsUpdatingFieldId.value = field.id
  try {
    const ok = await link.setParam(field.id, value)
    if (!ok) showElrsMsg(`写入失败: ${field.name}`, 'error')
    else showElrsMsg(field.type === 13 ? `已发送 ${field.name}` : `已写入 ${field.name}`)
  } catch {
    showElrsMsg(`写入失败: ${field.name}`, 'error')
  }
  elrsUpdatingFieldId.value = null
}

/** ELRS 页提示: 默认按"成功"提示, 失败/提醒显式传 type */
function showElrsMsg(msg: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  notify(msg, type)
}

// 写入帧已发出、但设备回读长期未追上：乐观值已回滚，提示用户该设置可能未生效
// 同一字段连续失败时也需触发，故侦听单调递增的 seq 而非 fieldId
watch(() => link.writeRejected?.seq, () => {
  const fieldId = link.writeRejected?.fieldId
  if (fieldId == null) return
  const name = link.fields.find(f => f.id === fieldId)?.name ?? `字段 #${fieldId}`
  showElrsMsg(`${name}：设备回读未确认，请重试`, 'warning')
})

// 写入被入口规则拒绝（如 500Hz / D500 / F500 这类切过去后模块不再上报的档位）：
// 这不是"未确认"，重试也不会成功，故文案与上面区分开
watch(() => link.writeBlocked?.seq, () => {
  const fieldId = link.writeBlocked?.fieldId
  if (fieldId == null) return
  const name = link.fields.find(f => f.id === fieldId)?.name ?? `字段 #${fieldId}`
  showElrsMsg(`${name}：该档位当前不可用（模块切换后不再上报此参数），已阻止下发`, 'warning')
})

/** 手动重扫：无条件清空固件缓存并强制重新发现参数 */
async function refreshElrsFields() {
  await link.rescanFields()
  if (link.fields.length > 0) {
    showElrsMsg(`参数缓存已重建，加载 ${link.fields.length} 项参数`)
  } else {
    showElrsMsg('重新扫描超时，可稍后重试', 'warning')
  }
}

/** 自动加载：连接/模块上线时仅拉取当前缓存（缓存为空时固件自动触发发现） */
async function autoLoadFields() {
  await link.fetchFields()
}

/** 全局底栏「从设备加载」: 重新扫描参数 (清空固件缓存强制重建), 完成后回报 App 关闭全局按钮 loading */
async function onGlobalReload() {
  try {
    await refreshElrsFields()
  } finally {
    window.dispatchEvent(new CustomEvent('app:reload-done'))
  }
}

/** 进入页面/连接建立后：登记链路流 → 拉参数
 *  不再先停通道流：固件 stream_start 自带 stop，且 stream.ts 仲裁器已按优先级去抖，
 *  先发 stream_stop 反而可能迟到并关掉本页刚启动的链路流 */
async function enterPage(): Promise<void> {
  if (!serial.connected) return
  await link.startLinkStream(100)  // 链路统计走流式（10Hz，与原轮询频率一致）
  await autoLoadFields()           // 无条件拉取：缓存为空时固件异步发现，fetchFields 内部轮询等待
}

// 直接打开/刷新本页后连接：onMounted 时未连接会跳过初始化，连接建立后补跑
watch(() => serial.connected, (connected) => {
  if (connected) enterPage()
})

onMounted(() => {
  enterPage()
  window.addEventListener('app:reload-from-device', onGlobalReload)
})

onUnmounted(async () => {
  window.removeEventListener('app:reload-from-device', onGlobalReload)
  if (!serial.connected) return
  await link.stopLinkStream()      // 离开页面停止链路流
  await chStore.startPolling()     // 恢复通道流
})
</script>

<style scoped>
/* ── 页面布局 (与 config / system 页一致) ── */
.elrs-page {
  padding: 0 16px 96px;
}

/* 顶部工具栏保持原边缘对齐, 内容区仍缩进 16px */
.elrs-page>.v-toolbar {
  margin: 0 -16px;
}

/* 页面标题左侧主题色高亮 */
.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}

/* 单列堆叠容器 */
.elrs-root {
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

/* ── 卡片内容排版: 分组面板 + 自适应键值网格 ── */
.stat-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.stat-group {
  flex: 1 1 200px;
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

.stat-kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
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

/* 数值: 等宽 + 表格数字, 消除刷新时的宽度跳动 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* ── 提示条 (与 system 页一致) ── */
/* 与上方内容保持间距: 作为容器首个元素时由容器内边距负责, 否则自动补 12px */
.cal-hint:not(:first-child) {
  margin-top: 12px;
}

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

/* 次要按钮: 深色底 + 白字 (与 config / system 页一致) */
.btn-secondary {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: #fff !important;
}

</style>
