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
        prepend-icon="mdi-refresh"
        size="small"
        variant="tonal"
        :loading="link.dynPwrLoading"
        @click="refreshElrsFields"
      >
        刷新字段列表
      </v-btn>
    </v-toolbar>

    <v-alert v-if="!serial.connected" class="ma-4" color="info" icon="mdi-information" variant="tonal">
      请先连接设备以管理 ELRS 参数
    </v-alert>

    <v-row dense class="pa-4">
      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon color="primary">mdi-view-dashboard</v-icon>
            </template>
            <v-card-title class="text-body-1">链路概览</v-card-title>
            <template #append>
              <v-chip v-if="link.moduleAlive" color="success" size="x-small" variant="tonal">
                {{ link.fieldCount }} 字段
              </v-chip>
              <v-chip v-else color="grey" size="x-small" variant="tonal">未就绪</v-chip>
            </template>
          </v-card-item>

          <v-card-text>
            <div v-if="!serial.connected || (!link.valid && !link.moduleAlive)" class="d-flex align-center ga-2">
              <v-icon size="20" color="grey">mdi-information</v-icon>
              <span class="text-caption text-medium-emphasis">
                {{ !serial.connected ? '请先连接设备' : 'ELRS 模块未响应，无法读取配置' }}
              </span>
            </div>

            <template v-else>
              <div class="d-flex align-center mb-4">
                <v-icon size="18" class="mr-2" :color="txPwrColor">mdi-broadcast</v-icon>
                <span class="text-caption text-medium-emphasis">当前 TX 功率：</span>
                <v-chip class="ml-2" :color="txPwrColor" size="x-small" variant="tonal">
                  {{ txPowerLabel }}
                </v-chip>
              </div>

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

          <v-card-actions v-if="serial.connected" class="pa-4 pt-0">
            <v-btn
              color="info"
              size="small"
              variant="tonal"
              :loading="wifiStarting"
              prepend-icon="mdi-wifi"
              @click="startWiFi"
            >
              启动 WiFi 控制台
            </v-btn>
            <v-btn
              color="warning"
              size="small"
              variant="tonal"
              :loading="wifiStopping"
              prepend-icon="mdi-wifi-off"
              @click="stopWiFi"
            >
              关闭 WiFi
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card rounded="lg" variant="outlined">
          <v-card-item>
            <template #prepend>
              <v-icon color="primary">mdi-file-tree</v-icon>
            </template>
            <v-card-title class="text-body-1">字段树</v-card-title>
          </v-card-item>

          <v-card-text>
            <div v-if="!serial.connected || (!link.valid && !link.moduleAlive)" class="d-flex align-center ga-2">
              <v-icon size="20" color="grey">mdi-information</v-icon>
              <span class="text-caption text-medium-emphasis">
                {{ !serial.connected ? '请先连接设备' : 'ELRS 模块未响应，无法读取配置' }}
              </span>
            </div>

            <template v-else>
              <div class="d-flex flex-wrap align-center justify-space-between ga-2 mb-3">
                <div class="d-flex flex-wrap align-center ga-2">
                  <v-chip color="success" size="small" variant="tonal">{{ link.fields.length }} 个字段</v-chip>
                  <v-switch
                    v-model="elrsShowHidden"
                    density="compact"
                    hide-details
                    inset
                    color="info"
                    class="ml-1"
                  >
                    <template #label>
                      <span class="text-caption">显示隐藏字段</span>
                    </template>
                  </v-switch>
                </div>
              </div>

              <div class="d-flex flex-wrap align-center ga-2 mb-3">
                <v-btn size="small" variant="text" prepend-icon="mdi-home" @click="elrsGoRoot">根目录</v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-arrow-up"
                  :disabled="currentFolderId === null"
                  @click="elrsGoUp"
                >
                  上一级
                </v-btn>

                <div class="d-flex flex-wrap align-center ga-1">
                  <v-chip
                    v-for="folder in elrsBreadcrumbs"
                    :key="folder.id"
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    class="cursor-pointer"
                    @click="currentFolderId = folder.id"
                  >
                    {{ folder.name }}
                  </v-chip>
                  <v-chip v-if="elrsBreadcrumbs.length === 0" size="x-small" variant="tonal" color="grey">
                    根目录
                  </v-chip>
                </div>
              </div>

              <v-alert v-if="currentFolderFields.length === 0" color="info" variant="tonal" density="compact">
                当前目录没有可显示字段。
              </v-alert>

              <template v-else>
                <v-sheet
                  v-for="field in currentFolderFields"
                  :key="field.id"
                  rounded="lg"
                  border
                  class="pa-3 mb-2"
                >
                  <div class="d-flex align-start justify-space-between ga-3">
                    <div class="flex-grow-1">
                      <div class="d-flex flex-wrap align-center ga-2">
                        <v-icon size="18" :color="elrsFieldIconColor(field)">{{ elrsFieldIcon(field) }}</v-icon>
                        <span class="text-body-2 font-weight-medium">{{ field.name }}</span>
                        <v-chip size="x-small" variant="tonal">{{ elrsFieldTypeLabel(field) }}</v-chip>
                        <v-chip v-if="field.hidden" size="x-small" color="grey" variant="tonal">隐藏</v-chip>
                      </div>
                      <div class="text-caption text-medium-emphasis mt-1">
                        ID {{ field.id }}
                        <template v-if="field.parent">· Parent {{ field.parent }}</template>
                        <template v-if="field.unit">· {{ field.unit }}</template>
                        <template v-if="field.value_valid && field.text">· {{ field.text }}</template>
                      </div>
                    </div>

                    <div v-if="field.type === 11">
                      <v-btn size="small" variant="text" icon="mdi-chevron-right" @click.stop="elrsEnterFolder(field.id)" />
                    </div>
                  </div>

                  <div class="mt-3">
                    <template v-if="field.type === 11">
                      <div class="d-flex align-center ga-2">
                        <v-btn size="small" variant="tonal" prepend-icon="mdi-folder-open" @click="elrsEnterFolder(field.id)">
                          进入文件夹
                        </v-btn>
                        <span class="text-caption text-medium-emphasis">文件夹节点仅用于分组，不会写回设备。</span>
                      </div>
                    </template>

                    <template v-else-if="field.type === 12">
                      <div class="text-body-2">{{ field.text || '--' }}</div>
                    </template>

                    <template v-else-if="field.type === 13">
                      <div class="d-flex flex-wrap align-center ga-2">
                        <v-chip v-if="field.value_valid" size="small" color="info" variant="tonal">
                          状态：{{ field.text || field.value }}
                        </v-chip>
                        <v-btn
                          size="small"
                          color="primary"
                          variant="tonal"
                          :loading="elrsUpdatingFieldId === field.id"
                          @click="applyElrsFieldValue(field, 1)"
                        >
                          {{ elrsCommandStartLabel(field) }}
                        </v-btn>
                        <v-btn
                          size="small"
                          color="success"
                          variant="tonal"
                          :loading="elrsUpdatingFieldId === field.id"
                          @click="applyElrsFieldValue(field, 4)"
                        >
                          确认
                        </v-btn>
                        <v-btn
                          size="small"
                          color="warning"
                          variant="tonal"
                          :loading="elrsUpdatingFieldId === field.id"
                          @click="applyElrsFieldValue(field, 5)"
                        >
                          取消
                        </v-btn>
                        <v-btn
                          size="small"
                          color="info"
                          variant="tonal"
                          :loading="elrsUpdatingFieldId === field.id"
                          @click="applyElrsFieldValue(field, 6)"
                        >
                          查询
                        </v-btn>
                      </div>
                    </template>

                    <template v-else-if="field.type === 9">
                      <div class="d-flex flex-wrap align-center ga-2">
                        <v-select
                          v-if="elrsSelectItems(field).length > 0"
                          :model-value="field.value ?? 0"
                          :items="elrsSelectItems(field)"
                          density="compact"
                          variant="outlined"
                          hide-details
                          style="min-width: 220px; max-width: 320px;"
                          @update:model-value="(v) => applyElrsFieldValue(field, Number(v))"
                        />
                        <v-text-field
                          v-else
                          :model-value="field.value ?? 0"
                          type="number"
                          density="compact"
                          variant="outlined"
                          hide-details
                          style="max-width: 160px;"
                          :min="field.min"
                          :max="field.max"
                          :step="field.step ?? 1"
                          @update:model-value="(v: string) => applyElrsFieldValue(field, Number(v))"
                        />
                        <v-chip v-if="field.text" size="small" variant="tonal">{{ field.text }}</v-chip>
                      </div>
                    </template>

                    <template v-else>
                      <div class="d-flex flex-wrap align-center ga-2">
                        <v-text-field
                          :model-value="field.value ?? 0"
                          type="number"
                          density="compact"
                          variant="outlined"
                          hide-details
                          style="max-width: 180px;"
                          :min="field.min"
                          :max="field.max"
                          :step="field.step ?? 1"
                          @update:model-value="(v: string) => applyElrsFieldValue(field, Number(v))"
                        />
                        <v-chip v-if="field.value_valid && field.text" size="small" variant="tonal">{{ field.text }}</v-chip>
                        <v-btn
                          size="small"
                          color="primary"
                          variant="tonal"
                          :loading="elrsUpdatingFieldId === field.id"
                          @click="applyElrsFieldValue(field, Number(field.value ?? 0))"
                        >
                          写入
                        </v-btn>
                      </div>
                    </template>
                  </div>
                </v-sheet>
              </template>

              <div v-if="elrsMsg" class="mt-3">
                <v-chip :color="elrsMsgOk ? 'success' : 'error'" size="x-small" variant="tonal">
                  {{ elrsMsg }}
                </v-chip>
              </div>
            </template>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useSerialStore } from '@/stores/serial'
import { useLinkStatsStore } from '@/stores/linkStats'
import { serialService } from '@/services/SerialService'

const serial = useSerialStore()
const link = useLinkStatsStore()

const dynPwrSwitch = ref(link.dynPowerOn ?? false)
const dynPwrToggling = ref(false)
const elrsMsg = ref('')
const elrsMsgOk = ref(true)
const elrsUpdatingFieldId = ref<number | null>(null)
const elrsShowHidden = ref(false)
const currentFolderId = ref<number | null>(null)

const elrsFieldMap = computed(() => new Map(link.fields.map(field => [field.id, field])))
const currentFolderFields = computed(() =>
  link.fields.filter(field => {
    const parent = field.parent ?? 0
    const inFolder = currentFolderId.value === null ? parent === 0 : parent === currentFolderId.value
    return inFolder && (elrsShowHidden.value || !field.hidden)
  }),
)
const elrsBreadcrumbs = computed(() => {
  const path: Array<{ id: number; name: string }> = []
  let cursor = currentFolderId.value
  const visited = new Set<number>()

  while (cursor !== null && cursor > 0 && !visited.has(cursor)) {
    visited.add(cursor)
    const folder = elrsFieldById(cursor)
    if (!folder) break
    path.unshift({ id: folder.id, name: folder.name })
    cursor = (folder.parent ?? 0) > 0 ? (folder.parent ?? 0) : null
  }

  return path
})

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

function elrsFieldById(id: number) {
  return elrsFieldMap.value.get(id) ?? null
}

function elrsEnterFolder(id: number) {
  const folder = elrsFieldById(id)
  if (!folder || folder.type !== 11) return
  currentFolderId.value = id
}

function elrsGoRoot() {
  currentFolderId.value = null
}

function elrsGoUp() {
  if (currentFolderId.value === null) return
  const current = elrsFieldById(currentFolderId.value)
  if (!current) {
    currentFolderId.value = null
    return
  }
  const parent = current.parent ?? 0
  currentFolderId.value = parent > 0 ? parent : null
}

function elrsFieldTypeLabel(field: { type: number }): string {
  return {
    0: 'U8',
    1: 'I8',
    2: 'U16',
    3: 'I16',
    8: 'FLOAT',
    9: 'SELECT',
    11: 'FOLDER',
    12: 'INFO',
    13: 'COMMAND',
  }[field.type] ?? `TYPE ${field.type}`
}

function elrsFieldIcon(field: { type: number }): string {
  if (field.type === 11) return 'mdi-folder'
  if (field.type === 12) return 'mdi-information-outline'
  if (field.type === 13) return 'mdi-gesture-tap-button'
  if (field.type === 9) return 'mdi-form-select'
  return 'mdi-numeric'
}

function elrsFieldIconColor(field: { type: number }): string {
  if (field.type === 11) return 'primary'
  if (field.type === 12) return 'info'
  if (field.type === 13) return 'warning'
  if (field.type === 9) return 'success'
  return 'grey'
}

function elrsSelectItems(field: { min?: number; max?: number; unit?: string; options?: string[] }) {
  if (field.options && field.options.length > 0) {
    const base = Number.isFinite(field.min as number) ? Number(field.min) : 0
    return field.options.map((label, idx) => ({
      title: label,
      value: base + idx,
    }))
  }

  const min = Number.isFinite(field.min as number) ? Number(field.min) : 0
  const max = Number.isFinite(field.max as number) ? Number(field.max) : min
  if (max < min) return []
  if ((max - min) > 32) return []

  const items: Array<{ title: string; value: number }> = []
  for (let value = min; value <= max; value++) {
    items.push({
      title: field.unit ? `${value} ${field.unit}` : `${value}`,
      value,
    })
  }
  return items
}

function elrsCommandStartLabel(field: { name: string }): string {
  const n = field.name.toLowerCase()
  if (n.includes('wifi')) return '启动 WiFi'
  if (n.includes('ble') || n.includes('bluetooth') || n.includes('joystick')) return '启动蓝牙'
  if (n.includes('bind')) return '开始对频'
  if (n.includes('vtx')) return '发送到 VTX'
  return '执行'
}

async function applyElrsFieldValue(field: { id: number; name: string }, value: number) {
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

async function refreshElrsFields() {
  elrsMsg.value = ''
  await link.fetchFields()
  if (link.fields.length > 0) {
    dynPwrSwitch.value = link.dynPowerOn ?? false
    showElrsMsg(`已加载 ${link.fields.length} 个字段`, true)
  } else {
    showElrsMsg('字段加载超时或模块未响应', false)
  }
}

const wifiStarting = ref(false)
async function startWiFi() {
  wifiStarting.value = true
  try {
    await serialService.sendCommand('elrs_wifi_start')
  } catch {
    // ignore
  }
  setTimeout(() => {
    wifiStarting.value = false
  }, 2000)
}

const wifiStopping = ref(false)
async function stopWiFi() {
  wifiStopping.value = true
  try {
    await serialService.sendCommand('elrs_wifi_stop')
  } catch {
    // ignore
  }
  setTimeout(() => {
    wifiStopping.value = false
  }, 2000)
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
    refreshElrsFields()
  }
})

watch(() => link.fields, () => {
  if (currentFolderId.value !== null) {
    const folder = elrsFieldById(currentFolderId.value)
    if (!folder || folder.type !== 11) {
      currentFolderId.value = null
    }
  }
}, { deep: true })

watch(() => serial.connected, (connected) => {
  if (!connected) {
    currentFolderId.value = null
  } else if (link.moduleAlive) {
    refreshElrsFields()
  }
})

onMounted(() => {
  if (serial.connected && link.moduleAlive) {
    refreshElrsFields()
  }
})
</script>
