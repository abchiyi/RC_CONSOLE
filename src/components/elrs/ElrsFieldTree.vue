<template>
  <div class="ft-tree">
    <template v-for="field in children" :key="field.id">
      <!-- 分组：点标题折叠 -->
      <div v-if="field.type === 11" class="ft-folder">
        <button
          type="button"
          class="ft-folder-head"
          :class="{ 'is-open': isOpen(field.id) }"
          @click="toggle(field.id)"
        >
          <v-icon size="16" class="ft-folder-icon">mdi-folder-outline</v-icon>
          <span class="ft-folder-name">{{ field.name }}</span>
          <span class="ft-folder-count">{{ childCount(field) }}</span>
          <v-icon size="16" class="ft-folder-chevron">mdi-chevron-right</v-icon>
        </button>

        <div v-show="isOpen(field.id)" class="ft-folder-body">
          <ElrsFieldTree
            :fields="fields"
            :parent-id="field.id"
            :updating-id="updatingId"
            @set="emit('set', $event)"
          />
        </div>
      </div>

      <!-- 参数行 -->
      <div v-else class="ft-row" :class="{ 'is-busy': isBusy(field) }">
        <div class="ft-head">
          <v-icon size="15" :color="iconColor(field)">{{ icon(field) }}</v-icon>
          <span class="ft-name">{{ field.name }}</span>
          <span class="ft-spacer" />
          <v-progress-circular v-if="isBusy(field)" size="12" width="2" indeterminate color="primary" />
          <span v-else class="ft-value">{{ valueLabel(field) }}</span>
        </div>

        <!-- INFO：只读说明 -->
        <p v-if="field.type === 12" class="ft-text">{{ field.text || '—' }}</p>

        <!-- COMMAND：按字段能力给动作（字段不支持的状态值不再出现） -->
        <div v-else-if="field.type === 13" class="ft-actions">
          <button
            v-for="action in cmdActions(field)"
            :key="action.value"
            type="button"
            class="ft-btn"
            :class="{ 'is-primary': action.primary }"
            :disabled="isBusy(field)"
            @click="apply(field, action.value)"
          >
            {{ action.label }}
          </button>
        </div>

        <!-- SELECT：选项直接平铺，点即写入 -->
        <div v-else-if="field.type === 9 && items(field).length > 0" class="ft-options">
          <button
            v-for="op in items(field)"
            :key="op.value"
            type="button"
            class="ft-option"
            :class="{ 'is-active': op.value === (field.value ?? 0) }"
            :disabled="isBusy(field)"
            @click="apply(field, op.value)"
          >
            {{ op.title }}
          </button>
        </div>

        <!-- 数值：− / 输入 / ＋ / 写入 -->
        <div v-else class="ft-stepper">
          <button type="button" class="ft-step" :disabled="isBusy(field)" @click="nudge(field, -1)">
            <v-icon size="14">mdi-minus</v-icon>
          </button>
          <input
            class="ft-input"
            type="number"
            :value="draft(field)"
            :min="field.min"
            :max="field.max"
            :step="field.step ?? 1"
            :disabled="isBusy(field)"
            @input="onInput(field, $event)"
          />
          <button type="button" class="ft-step" :disabled="isBusy(field)" @click="nudge(field, 1)">
            <v-icon size="14">mdi-plus</v-icon>
          </button>
          <button
            type="button"
            class="ft-btn is-primary"
            :disabled="isBusy(field) || draft(field) === (field.value ?? 0)"
            @click="apply(field, draft(field))"
          >
            写入
          </button>
        </div>
      </div>
    </template>

    <div v-if="children.length === 0" class="ft-empty">此分组暂无参数</div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ElrsFieldInfo } from '@/stores/linkStats'

const props = defineProps<{
  fields: ElrsFieldInfo[]
  parentId?: number
  updatingId?: number | null
}>()

const emit = defineEmits<{ set: [payload: { field: ElrsFieldInfo; value: number }] }>()

/** 可见子项：固件标记为隐藏的直接丢弃 */
const children = computed(() =>
  props.fields.filter(field => (field.parent ?? 0) === (props.parentId ?? 0) && !field.hidden),
)

/** 分组展开状态：默认全开，仅记录被收起的分组 */
const closed = ref(new Set<number>())

function isOpen(id: number): boolean {
  return !closed.value.has(id)
}

function toggle(id: number) {
  const next = new Set(closed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  closed.value = next
}

/** 数值字段草稿：本地暂存，点「写入」才下发（避免连点反复写模块 NVS） */
const drafts = reactive<Record<number, number>>({})

function draft(field: ElrsFieldInfo): number {
  const d = drafts[field.id]
  return typeof d === 'number' ? d : (field.value ?? 0)
}

function clamp(field: ElrsFieldInfo, v: number): number {
  const min = Number.isFinite(field.min as number) ? Number(field.min) : -Infinity
  const max = Number.isFinite(field.max as number) ? Number(field.max) : Infinity
  return Math.min(max, Math.max(min, v))
}

function onInput(field: ElrsFieldInfo, e: Event) {
  const raw = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(raw)) drafts[field.id] = clamp(field, raw)
}

function nudge(field: ElrsFieldInfo, dir: number) {
  drafts[field.id] = clamp(field, draft(field) + dir * (field.step ?? 1))
}

/** 固件回读值追上草稿（写入已生效）后清掉草稿，以模块值为准 */
watch(() => props.fields, (list) => {
  for (const field of list) {
    const d = drafts[field.id]
    if (typeof d === 'number' && field.value === d) delete drafts[field.id]
  }
})

function isBusy(field: ElrsFieldInfo): boolean {
  return props.updatingId === field.id
}

function apply(field: ElrsFieldInfo, value: number) {
  emit('set', { field, value })
}

function childCount(folder: ElrsFieldInfo): number {
  return props.fields.filter(f => (f.parent ?? 0) === folder.id && !f.hidden).length
}

/** 行首图标：按字段类型区分（类型名不再作为文本展示） */
function icon(field: ElrsFieldInfo): string {
  if (field.type === 12) return 'mdi-information-outline'
  if (field.type === 13) return 'mdi-gesture-tap-button'
  if (field.type === 9) return 'mdi-form-select'
  return 'mdi-numeric'
}

function iconColor(field: ElrsFieldInfo): string {
  if (field.type === 12) return 'info'
  if (field.type === 13) return 'warning'
  if (field.type === 9) return 'success'
  return 'grey'
}

/** 右上角当前值：SELECT 显示选项名，数值带单位，命令显示模块回报的文本 */
function valueLabel(field: ElrsFieldInfo): string {
  if (field.type === 12) return ''
  if (field.type === 13) return field.text || ''
  if (field.type === 9) {
    const opts = items(field)
    if (opts.length > 0) return opts.find(op => op.value === (field.value ?? 0))?.title ?? '--'
  }
  const v = field.value
  if (v === undefined || v === null) return '--'
  return field.unit ? `${v} ${field.unit}` : `${v}`
}

/** SELECT 选项：优先用固件下发的 options，否则按 min~max 枚举（>32 档视为不可枚举） */
function items(field: ElrsFieldInfo) {
  if (field.options && field.options.length > 0) {
    const base = Number.isFinite(field.min as number) ? Number(field.min) : 0
    return field.options.map((label, idx) => ({ title: label, value: base + idx }))
  }

  const min = Number.isFinite(field.min as number) ? Number(field.min) : 0
  const max = Number.isFinite(field.max as number) ? Number(field.max) : min
  if (max < min || (max - min) > 32) return []

  const list: Array<{ title: string; value: number }> = []
  for (let value = min; value <= max; value++) {
    list.push({ title: field.unit ? `${value} ${field.unit}` : `${value}`, value })
  }
  return list
}

/** 命令字段的动作：value 写入 CRSF 的 state 字节（固件 elrs_v3.h：1=启动 4=确认 5=取消 6=查询；界面只用 1 / 5） */
interface CommandAction {
  value: number
  label: string
  primary?: boolean
}

/**
 * 命令字段的动作：所有指令统一成"执行 + 关闭"两个按钮，主按钮按语义命名。
 * 不出现"确认 / 查询"按钮：对频流程的"确认"由固件在收到"需要确认"状态时自动补发，
 * 命令执行后的状态刷新由固件自动重读。
 */
function cmdActions(field: ElrsFieldInfo): CommandAction[] {
  const n = field.name.toLowerCase()

  let label = '执行'
  if (n.includes('wifi')) label = '启动 WiFi'
  else if (n.includes('ble') || n.includes('bluetooth') || n.includes('joystick')) label = '启动蓝牙'
  else if (n.includes('vtx')) label = '发送到 VTX'
  else if (n.includes('bind')) label = '开始对频'

  return [
    { value: 1, label, primary: true },
    { value: 5, label: n.includes('bind') ? '取消对频' : '关闭' },
  ]
}
</script>

<style scoped>
/* ── 列表容器 ── */
.ft-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── 参数行：柔和底色 + hover 提亮 ── */
.ft-row {
  padding: 9px 11px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.028);
  transition: background-color 0.2s, border-color 0.2s;
}

.ft-row:hover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
}

.ft-row.is-busy {
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.ft-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}

.ft-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.ft-spacer {
  flex: 1 1 auto;
}

.ft-value {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}

.ft-text {
  margin: 6px 0 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.6);
}

/* ── 选项 / 按钮：胶囊 ── */
.ft-options,
.ft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ft-option,
.ft-btn {
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.74rem;
  line-height: 1.6;
  cursor: pointer;
  transition: all 0.16s;
}

.ft-option:hover:not(:disabled),
.ft-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

.ft-option.is-active {
  border-color: transparent;
  background: rgb(var(--v-theme-primary));
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(var(--v-theme-primary), 0.35);
}

.ft-btn.is-primary {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}

.ft-btn.is-primary:hover:not(:disabled) {
  border-color: transparent;
  background: rgb(var(--v-theme-primary));
  color: #fff;
}

.ft-option:disabled,
.ft-btn:disabled,
.ft-step:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── 数值步进器 ── */
.ft-stepper {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.ft-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  transition: all 0.16s;
}

.ft-step:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

.ft-input {
  width: 76px;
  height: 26px;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.92);
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
  text-align: center;
  outline: none;
  appearance: textfield;
  transition: border-color 0.16s;
}

.ft-input:focus {
  border-color: rgba(var(--v-theme-primary), 0.6);
}

.ft-input:disabled {
  opacity: 0.45;
}

.ft-input::-webkit-outer-spin-button,
.ft-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* ── 分组 ── */
.ft-folder-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.78rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s;
}

.ft-folder-head:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
}

.ft-folder-icon {
  color: rgb(var(--v-theme-primary));
}

.ft-folder-name {
  letter-spacing: 0.01em;
}

.ft-folder-count {
  margin-left: auto;
  font-size: 0.66rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
}

.ft-folder-chevron {
  color: rgba(255, 255, 255, 0.45);
  transition: transform 0.2s;
}

.ft-folder-head.is-open .ft-folder-chevron {
  transform: rotate(90deg);
}

.ft-folder-body {
  margin: 6px 0 2px 12px;
  padding-left: 10px;
  border-left: 1px dashed rgba(255, 255, 255, 0.12);
}

.ft-empty {
  padding: 6px 2px;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.45);
}
</style>
