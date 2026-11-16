<template>
  <!-- 顶部专用区域：Xbox 360 X-Input input report 的实时 wire 数据。
       content_type=6 流式推送，随帧刷新；无数据/陈旧/未就绪时给出明确状态而不是假 0。 -->
  <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
    <v-card-item class="pb-0">
      <template #prepend>
        <v-avatar class="cal-avatar" color="primary" size="36">
          <v-icon color="white" size="20">mdi-gamepad-variant</v-icon>
        </v-avatar>
      </template>

      <v-card-title>Xbox 输出报文</v-card-title>
      <v-card-subtitle>X-Input input report · 20B · 实时流式</v-card-subtitle>

      <template #append>
        <v-chip :color="statusColor" size="small" variant="tonal">
          <v-icon size="14" start>{{ statusIcon }}</v-icon>
          {{ statusText }}
        </v-chip>
      </template>
    </v-card-item>

    <v-card-text class="pt-2 pb-3">
      <div v-if="!xbox.live" class="cal-hint mb-3">
        <v-icon size="14">mdi-information-outline</v-icon>

        <span>
          等待设备实时帧。若长时间无数据，请确认固件已支持 content_type=6
          （旧固件需升级）；配置读写功能不受影响。
        </span>
      </div>

      <!-- 20 字节 hex 视图：按 wire 字段分组着色 -->
      <div class="report-grid">
        <div
          v-for="cell in reportCells"
          :key="cell.offset"
          class="report-cell"
          :class="[`report-${cell.group}`, { 'report-on': cell.on }]"
          :title="cell.title"
        >
          <div class="report-off text-caption">{{ pad2(cell.offset) }}</div>
          <div class="report-hex text-body-2 font-weight-bold">{{ cell.hex }}</div>
          <div class="report-name text-caption">{{ cell.name }}</div>
        </div>
      </div>

      <!-- 字段实时值 -->
      <div class="field-grid mt-3">
        <div v-for="f in fields" :key="f.name" class="field-item">
          <div class="text-caption text-medium-emphasis">{{ f.name }}</div>
          <div class="text-body-2 font-weight-bold">{{ f.value }}</div>
        </div>
      </div>

      <!-- 16 位按钮位图：bit11 保留 -->
      <div class="mt-3">
        <div class="text-caption text-medium-emphasis mb-1">
          Buttons 0x{{ buttonsHex }} · 位图（bit0…bit15）
        </div>

        <div class="bit-grid">
          <div
            v-for="b in buttonBits"
            :key="b.bit"
            class="bit-cell"
            :class="{ 'bit-on': b.on, 'bit-reserved': b.reserved }"
            :title="b.title"
          >
            <div class="text-caption">{{ b.bit }}</div>
            <div class="text-caption font-weight-bold">{{ b.label }}</div>
          </div>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useXboxStore } from '@/stores/xbox'
  import { XBOX_BUTTON_KEYS, XBOX_BUTTON_LABELS } from '@/utils/commands'

  const xbox = useXboxStore()

  function pad2 (n: number): string {
    return n.toString(16).toUpperCase().padStart(2, '0')
  }

  interface ReportCell {
    offset: number
    hex: string
    name: string
    group: string
    on: boolean
    title: string
  }

  const reportCells = computed<ReportCell[]>(() => {
    const r = xbox.live?.report
    const has = !!xbox.liveActive
    const hex = (i: number): string => (has && r ? pad2(r[i] ?? 0) : '--')
    const on = (i: number): boolean => has && r?.[i] !== 0
    const cell = (offset: number, name: string, group: string, title: string): ReportCell => ({
      offset, hex: hex(offset), name, group, on: on(offset) ?? false, title,
    })
    return [
      cell(0, 'type', 'head', '报文类型，固定 0x00'),
      cell(1, 'size', 'head', '报文长度，固定 0x14 (20)'),
      cell(2, 'btn lo', 'button', 'buttons 低字节：Dpad↑↓←→ / Start / Back / L3 / R3'),
      cell(3, 'btn hi', 'button', 'buttons 高字节：LB / RB / Guide / 保留 / A / B / X / Y'),
      cell(4, 'LT', 'trigger', '左扳机 0..255'),
      cell(5, 'RT', 'trigger', '右扳机 0..255'),
      cell(6, 'LX l', 'axis', '左摇杆 X 低字节 (i16 LE)'),
      cell(7, 'LX h', 'axis', '左摇杆 X 高字节 (i16 LE)'),
      cell(8, 'LY l', 'axis', '左摇杆 Y 低字节 (i16 LE)'),
      cell(9, 'LY h', 'axis', '左摇杆 Y 高字节 (i16 LE)'),
      cell(10, 'RX l', 'axis', '右摇杆 X 低字节 (i16 LE)'),
      cell(11, 'RX h', 'axis', '右摇杆 X 高字节 (i16 LE)'),
      cell(12, 'RY l', 'axis', '右摇杆 Y 低字节 (i16 LE)'),
      cell(13, 'RY h', 'axis', '右摇杆 Y 高字节 (i16 LE)'),
      cell(14, 'res', 'reserved', '保留，恒 0'),
      cell(15, 'res', 'reserved', '保留，恒 0'),
      cell(16, 'res', 'reserved', '保留，恒 0'),
      cell(17, 'res', 'reserved', '保留，恒 0'),
      cell(18, 'res', 'reserved', '保留，恒 0'),
      cell(19, 'res', 'reserved', '保留，恒 0'),
    ]
  })

  const fields = computed(() => {
    const d = xbox.live
    const ok = xbox.liveActive
    const num = (v: number | undefined): string => (ok && v !== undefined ? String(v) : '--')
    return [
      { name: 'LX', value: num(d?.lx) },
      { name: 'LY', value: num(d?.ly) },
      { name: 'RX', value: num(d?.rx) },
      { name: 'RY', value: num(d?.ry) },
      { name: 'LT', value: num(d?.lt) },
      { name: 'RT', value: num(d?.rt) },
      { name: 'buttons', value: ok ? `0x${buttonsHex.value}` : '--' },
      { name: 'frame', value: num(d?.frameSeq) },
    ]
  })

  const buttonsHex = computed(() => (xbox.live?.buttons ?? 0)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0'))

  /** 位图：XBOX_BUTTON_KEYS 顺序对应 bit 0..10 / 12..15，bit11 保留 */
  const bitLabels = new Map<number, string>(
    XBOX_BUTTON_KEYS.map((k, i) => [i < 11 ? i : i + 1, shortLabel(k)]),
  )

  function shortLabel (key: (typeof XBOX_BUTTON_KEYS)[number]): string {
    const label = XBOX_BUTTON_LABELS[key]
    return label.replace('十字键 ', '').replace(' 左摇杆按下', '').replace(' 右摇杆按下', '').replace(' 左肩键', '').replace(' 右肩键', '')
  }

  const buttonBits = computed(() => {
    const states = xbox.live?.buttonStates
    return Array.from({ length: 16 }, (_, bit) => {
      const reserved = bit === 11
      const key = XBOX_BUTTON_KEYS[bit < 11 ? bit : bit - 1] as (typeof XBOX_BUTTON_KEYS)[number] | undefined
      return {
        bit,
        label: reserved ? '—' : (bitLabels.get(bit) ?? '?'),
        on: !reserved && !!states && !!key && states[key],
        reserved,
        title: reserved ? 'bit11 保留' : `bit${bit} ${key ? XBOX_BUTTON_LABELS[key] : ''}`,
      }
    })
  })

  const statusColor = computed(() => {
    if (!xbox.streamAlive) return 'warning'
    if (!xbox.liveActive) return 'warning'
    return 'success'
  })

  const statusIcon = computed(() => {
    if (!xbox.streamAlive) return 'mdi-alert-outline'
    if (!xbox.liveActive) return 'mdi-information-outline'
    return xbox.live?.usbActive ? 'mdi-usb' : 'mdi-bluetooth'
  })

  const statusText = computed(() => {
    if (!xbox.streamAlive) return xbox.live ? '数据陈旧' : '等待数据'
    if (!xbox.liveActive) return '采样未运行'
    return xbox.live?.usbActive ? '手柄输出中' : '实时预览（未发送）'
  })
</script>

<style scoped>
/* 卡片外壳：与 system.vue / CalWizard.vue 同一套 */
.cal-card {
  background: rgb(var(--v-theme-surface)) !important;
  border-color: rgba(var(--v-theme-on-surface), 0.08) !important;
  transition: border-color 0.3s, background-color 0.3s;
}

.cal-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.16) !important;
}

.cal-avatar {
  margin-right: 4px;
}

.cal-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.05);
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* 20 字节格：10 列 × 2 行，窄屏自动换行 */
.report-grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
}

.report-cell {
  min-width: 0;
  padding: 4px 2px;
  border-radius: 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.03);
  text-align: center;
  transition: background-color 0.15s, border-color 0.15s;
}

.report-off {
  font-size: 0.6rem;
  opacity: 0.55;
}

.report-hex {
  font-family: monospace;
  line-height: 1.3;
}

.report-name {
  font-size: 0.6rem;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.report-head {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
}

.report-button {
  border-color: rgba(var(--v-theme-secondary), 0.35);
}

.report-trigger {
  border-color: rgba(var(--v-theme-warning), 0.35);
}

.report-axis {
  border-color: rgba(var(--v-theme-primary), 0.3);
}

.report-reserved {
  opacity: 0.55;
}

.report-cell.report-on {
  background: rgba(var(--v-theme-primary), 0.16);
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
}

.field-item {
  padding: 5px 6px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  text-align: center;
  min-width: 0;
}

.field-item .text-body-2 {
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bit-grid {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 3px;
}

.bit-cell {
  min-width: 0;
  padding: 3px 1px;
  border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.03);
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
}

.bit-cell .text-caption {
  font-size: 0.58rem;
  line-height: 1.35;
}

.bit-cell.bit-on {
  background: rgba(var(--v-theme-primary), 0.28);
  border-color: rgb(var(--v-theme-primary));
}

.bit-cell.bit-reserved {
  opacity: 0.4;
}

@media (max-width: 900px) {
  .report-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .field-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .bit-grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}
</style>
