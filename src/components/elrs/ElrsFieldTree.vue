<template>
  <v-list density="compact" class="bg-transparent rounded-lg">
    <template v-for="field in children" :key="field.id">
      <!-- 文件夹：v-list-group 就地展开/收起，递归渲染子字段 -->
      <v-list-group
        v-if="field.type === 11"
        :value="field.id"
        color="primary"
        eager
      >
        <template #activator="{ props }">
          <v-list-item
            v-bind="props"
            prepend-icon="mdi-folder"
            :title="field.name"
          >
            <template #append>
              <v-chip size="x-small" variant="tonal" color="primary">{{ childCount(field) }}</v-chip>
            </template>
          </v-list-item>
        </template>
        <ElrsFieldTree
          :fields="fields"
          :parent-id="field.id"
          :show-hidden="showHidden"
          :updating-id="updatingId"
          @set="$emit('set', $event)"
        />
      </v-list-group>

      <!-- 普通字段：编辑卡片 -->
      <v-sheet v-else rounded="lg" border class="pa-3 mb-2 mx-1">
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
        </div>

        <div class="mt-3">
          <template v-if="field.type === 12">
            <div class="text-body-2">{{ field.text || '--' }}</div>
          </template>

          <template v-else-if="field.type === 13">
            <div class="d-flex flex-wrap align-center ga-2">
              <v-chip v-if="field.value_valid" size="small" color="info" variant="tonal">
                状态：{{ field.text || field.value }}
              </v-chip>
              <v-btn size="small" color="primary" variant="tonal" :loading="updatingId === field.id" @click="apply(field, 1)">
                {{ elrsCommandStartLabel(field) }}
              </v-btn>
              <v-btn size="small" color="success" variant="tonal" :loading="updatingId === field.id" @click="apply(field, 4)">
                确认
              </v-btn>
              <v-btn size="small" color="warning" variant="tonal" :loading="updatingId === field.id" @click="apply(field, 5)">
                取消
              </v-btn>
              <v-btn size="small" color="info" variant="tonal" :loading="updatingId === field.id" @click="apply(field, 6)">
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
                style="width: 100%; max-width: 340px;"
                @update:model-value="(v) => apply(field, Number(v))"
              />
              <v-text-field
                v-else
                :model-value="field.value ?? 0"
                type="number"
                density="compact"
                variant="outlined"
                hide-details
                style="width: 100%; max-width: 180px;"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                @update:model-value="(v: string) => apply(field, Number(v))"
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
                style="width: 100%; max-width: 180px;"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                @update:model-value="(v: string) => apply(field, Number(v))"
              />
              <v-chip v-if="field.value_valid && field.text" size="small" variant="tonal">{{ field.text }}</v-chip>
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                :loading="updatingId === field.id"
                @click="apply(field, Number(field.value ?? 0))"
              >
                写入
              </v-btn>
            </div>
          </template>
        </div>
      </v-sheet>
    </template>

    <div v-if="children.length === 0" class="text-caption text-medium-emphasis pa-2">（此目录无字段）</div>
  </v-list>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ElrsFieldInfo } from '@/stores/linkStats'

const props = defineProps<{
  fields: ElrsFieldInfo[]
  parentId?: number
  showHidden?: boolean
  updatingId?: number | null
}>()

const emit = defineEmits<{ set: [payload: { field: ElrsFieldInfo; value: number }] }>()

const children = computed(() =>
  props.fields.filter(
    field =>
      (field.parent ?? 0) === (props.parentId ?? 0) &&
      (props.showHidden || !field.hidden),
  ),
)

function childCount(folder: ElrsFieldInfo): number {
  return props.fields.filter(f => (f.parent ?? 0) === folder.id && (props.showHidden || !f.hidden)).length
}

function apply(field: ElrsFieldInfo, value: number) {
  emit('set', { field, value })
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
    return field.options.map((label, idx) => ({ title: label, value: base + idx }))
  }

  const min = Number.isFinite(field.min as number) ? Number(field.min) : 0
  const max = Number.isFinite(field.max as number) ? Number(field.max) : min
  if (max < min) return []
  if ((max - min) > 32) return []

  const items: Array<{ title: string; value: number }> = []
  for (let value = min; value <= max; value++) {
    items.push({ title: field.unit ? `${value} ${field.unit}` : `${value}`, value })
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
</script>
