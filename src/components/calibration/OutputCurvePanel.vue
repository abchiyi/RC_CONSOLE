<template>
  <v-sheet rounded="lg" class="pa-3 mb-3 curve-panel">
    <div class="panel-head mb-2">
      <span class="text-subtitle-2 font-weight-bold">
        <v-icon size="16" class="me-1">mdi-tune-variant</v-icon>
        输出响应曲线
      </span>
      <div class="head-actions">
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" variant="tonal" height="40">
              <v-icon size="16" class="me-1">mdi-shimmer</v-icon>预设
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-subheader>仅影响正向 [0,100]，负半周自动奇对称</v-list-subheader>
            <v-list-item v-for="p in PRESETS" :key="p.id" @click="applyPreset(p.curve)">
              <v-list-item-title>{{ p.label }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
        <v-btn variant="tonal" height="40" @click="copyToAll">复制到全部</v-btn>
        <v-select v-model="curveType" :items="curveTypeOptions" density="compact" variant="outlined" hide-details
          style="max-width: 150px" />
      </div>
    </div>

    <div class="text-caption text-medium-emphasis mb-2">
      对通道输出值应用 cubic-bezier 曲线（端点固定 (0,0)/(100,100)）。拖动当前曲线控制点实时调整并自动写入设备。摇杆/IMU 双向输入仅展示正向，负半周固件奇对称取反。
      <span v-if="actionMsg" class="action-msg">{{ actionMsg }}</span>
    </div>

    <!-- 多色叠加图形窗口 + 动画演示 + 参数编辑器: 宽屏左右 / 窄屏上下 -->
    <div class="curve-body">
      <div class="curve-left">
      <div class="curve-overlay-wrap">
        <svg ref="svgRef" class="curve-overlay" viewBox="-28 -118 158 146" preserveAspectRatio="xMidYMid meet"
          @pointermove="onControlMove" @pointerup="onControlUp" @pointercancel="onControlUp">
        <!-- 坐标轴 (X=0 竖 / Y=0 横) 强化为主分割线 -->
        <g stroke="rgba(255,255,255,0.25)" stroke-width="1.5">
          <line x1="0" y1="-100" x2="0" y2="0" />
          <line x1="0" y1="0" x2="100" y2="0" />
        </g>
        <!-- 参考网格 (25 步进, 仅正向象限) -->
        <g stroke="#2f2f2f" stroke-width="1">
          <line x1="0" y1="-100" x2="100" y2="-100" />
          <line x1="0" y1="-75" x2="100" y2="-75" />
          <line x1="0" y1="-50" x2="100" y2="-50" />
          <line x1="0" y1="-25" x2="100" y2="-25" />
          <line x1="25" y1="-100" x2="25" y2="0" />
          <line x1="50" y1="-100" x2="50" y2="0" />
          <line x1="75" y1="-100" x2="75" y2="0" />
          <line x1="100" y1="-100" x2="100" y2="0" />
        </g>
        <!-- 原始输入恒等直线 (仅正向段) -->
        <line x1="0" y1="0" x2="100" y2="-100" stroke="#8a8a8a" stroke-width="1.5" stroke-dasharray="4 4" />
        <!-- 各输入源曲线 (多色, 贝塞尔采样, 仅正向 [0,100]; 负半周由固件按奇对称共用) -->
        <path v-for="ln in curves" :key="ln.id" :d="pathStr(ln.points)" fill="none" :stroke="ln.color" stroke-width="1.5" />
        <!-- 当前选中曲线的控制点 (可拖动, Y 限制 0~100) -->
        <g v-if="activeCurve">
          <line :x1="0" :y1="0" :x2="controlPoints[0].x" :y2="controlPoints[0].y" stroke="#ffffff" stroke-opacity="0.35"
            stroke-width="0.75" stroke-dasharray="3 3" />
          <line :x1="100" :y1="-100" :x2="controlPoints[1].x" :y2="controlPoints[1].y" stroke="#ffffff"
            stroke-opacity="0.35" stroke-width="0.75" stroke-dasharray="3 3" />
          <circle v-for="cp in controlPoints" :key="cp.id" :cx="cp.x" :cy="cp.y" r="6" fill="rgba(255,255,255,0.15)"
            stroke="#fff" stroke-width="1" class="ctrl-dot" @pointerdown="onControlDown(cp.id, $event)" />
        </g>
        <!-- 曲线效果演示指示点 (自动往返扫描, 显示当前输入→输出映射) -->
        <g v-if="activeCurve">
          <line :x1="animX" :y1="0" :x2="animX" :y2="-animY" stroke="rgba(255,255,255,0.3)" stroke-width="0.75"
            stroke-dasharray="2 2" />
          <line :x1="0" :y1="-animY" :x2="animX" :y2="-animY" stroke="rgba(255,255,255,0.3)" stroke-width="0.75"
            stroke-dasharray="2 2" />
          <circle :cx="animX" :cy="-animY" r="3.5" fill="#fff" stroke="none" />
        </g>
        <!-- 轴名称: 位于各轴末端, 沿用全局字体 -->
        <g font-size="8" fill="rgba(255,255,255,0.5)">
          <text x="0" y="-106" text-anchor="middle">输出</text>
          <text x="115" y="8" text-anchor="middle">输入</text>
        </g>
        <!-- 刻度: Y 轴左侧数值标签 + 小刻度线 -->
        <g font-family="'Cascadia Mono', 'Consolas', monospace" font-size="8" fill="rgba(255,255,255,0.4)">
          <g v-for="t in yTicks" :key="'y' + t.value">
            <line :x1="-3" :x2="0" :y1="t.y" :y2="t.y" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
            <text :x="-5" :y="t.y + 3" text-anchor="end" :class="tickClass(t.value)">{{ t.value }}</text>
          </g>
        </g>
        <!-- 刻度: X 轴底部数值标签 + 小刻度线 -->
        <g font-family="'Cascadia Mono', 'Consolas', monospace" font-size="8" fill="rgba(255,255,255,0.4)">
          <g v-for="t in xTicks" :key="'x' + t.value">
            <line :x1="t.x" :x2="t.x" :y1="0" :y2="3" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
            <text :x="t.x" :y="13" text-anchor="middle" :class="tickClass(t.value)">{{ t.value }}</text>
          </g>
        </g>
      </svg>
      <div class="legend">
        <span v-for="ln in curves" :key="ln.id" class="legend-item">
          <span class="legend-dot" :style="{ background: ln.color }"></span>{{ ln.label }}
        </span>
      </div>
      </div>
      </div>

      <div class="curve-right">
        <div class="curve-anim-panel">
          <span class="anim-title">
            <v-icon size="15" class="me-1">mdi-axis-x-arrow</v-icon>
            曲线效果演示
          </span>
          <div class="anim-bars">
            <div class="anim-bar-row">
              <span class="bar-label">输入</span>
              <div class="bar-track">
                <div class="bar-fill input" :style="{ width: animX + '%' }"></div>
              </div>
              <b>{{ Math.round(animX) }}</b>
            </div>
            <div class="anim-bar-row">
              <span class="bar-label">输出</span>
              <div class="bar-track">
                <div class="bar-fill output" :style="{ width: animY + '%', background: activeColor }"></div>
              </div>
              <b>{{ Math.round(animY) }}</b>
            </div>
          </div>
        </div>
        <div class="curve-editor-side">
          <OutputCurveEditor :curve="activeCurve" @commit="onCommit" />
        </div>
      </div>
    </div>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import OutputCurveEditor from '@/components/config/OutputCurveEditor.vue'
import { useCalibrationStore, type CurveType, type OutputCurve } from '@/stores/calibration'

const cal = useCalibrationStore()

const curveType = ref<CurveType>('trigger')
const curveTypeOptions = [
  { title: '扳机', value: 'trigger' },
  { title: '摇杆 X', value: 'joy_x' },
  { title: '摇杆 Y', value: 'joy_y' },
  { title: 'IMU 横滚', value: 'imu_roll' },
  { title: 'IMU 俯仰', value: 'imu_pitch' },
]

const activeCurve = computed<OutputCurve>(() => {
  switch (curveType.value) {
    case 'joy_x':
      return cal.joyXCurve
    case 'joy_y':
      return cal.joyYCurve
    case 'imu_roll':
      return cal.imuRollCurve
    case 'imu_pitch':
      return cal.imuPitchCurve
    default:
      return cal.triggerCurve
  }
})

// ---- cubic-bezier (与固件算法一致): 端点固定 (0,0)->(1,1), 控制点 (x1,y1),(x2,y2) ----
function bezierX(t: number, x1: number, x2: number): number {
  const mt = 1 - t
  return 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t
}

function bezierY(t: number, y1: number, y2: number): number {
  const mt = 1 - t
  return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t
}

// x1,x2∈[0,1] ⇒ x(t) 单调 ⇒ 二分反解 t
function solveT(x: number, x1: number, x2: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const t = (lo + hi) / 2
    if (bezierX(t, x1, x2) < x) lo = t
    else hi = t
  }
  return (lo + hi) / 2
}

/** 输出 Y 限制在 [0,100], 旧数据的负值兜底 clamp */
function clampY(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** 仅正向 [0,100] 采样 → SVG 点 (y 翻转); 负半周由固件按同一曲线奇对称取反 */
function curvePoints(c: OutputCurve): [number, number][] {
  const pts: [number, number][] = []
  for (let x = 0; x <= 100; x += 2) {
    const t = solveT(x / 100, c.x1 / 100, c.x2 / 100)
    const y = clampY(bezierY(t, c.y1 / 100, c.y2 / 100) * 100)
    pts.push([x, -y])
  }
  return pts
}

function pathStr(p: [number, number][]): string {
  return p
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`)
    .join(' ')
}

const CURVE_COLORS: Record<CurveType, string> = {
  trigger: '#4CAF50',
  joy_x: '#2196F3',
  joy_y: '#FF9800',
  imu_roll: '#9C27B0',
  imu_pitch: '#00BCD4',
}

const curves = computed(() => [
  { id: 'trigger', label: '扳机', color: CURVE_COLORS.trigger, points: curvePoints(cal.triggerCurve) },
  { id: 'joy_x', label: '摇杆 X', color: CURVE_COLORS.joy_x, points: curvePoints(cal.joyXCurve) },
  { id: 'joy_y', label: '摇杆 Y', color: CURVE_COLORS.joy_y, points: curvePoints(cal.joyYCurve) },
  { id: 'imu_roll', label: 'IMU 横滚', color: CURVE_COLORS.imu_roll, points: curvePoints(cal.imuRollCurve) },
  { id: 'imu_pitch', label: 'IMU 俯仰', color: CURVE_COLORS.imu_pitch, points: curvePoints(cal.imuPitchCurve) },
])

/** 当前选中曲线的颜色 (动画面板输出条使用) */
const activeColor = computed(() => CURVE_COLORS[curveType.value])

// ---- 快速设置: 预设一键应用 / 复制当前曲线到全部 ----
const CURVE_TYPES: { id: CurveType; label: string }[] = [
  { id: 'trigger', label: '扳机' },
  { id: 'joy_x', label: '摇杆 X' },
  { id: 'joy_y', label: '摇杆 Y' },
  { id: 'imu_roll', label: 'IMU 横滚' },
  { id: 'imu_pitch', label: 'IMU 俯仰' },
]

const PRESETS: { id: string; label: string; curve: OutputCurve }[] = [
  { id: 'linear', label: '线性', curve: { x1: 50, y1: 50, x2: 50, y2: 50 } },
  { id: 'exp', label: '指数（缓起步）', curve: { x1: 40, y1: 10, x2: 90, y2: 70 } },
  { id: 'log', label: '对数（快起步）', curve: { x1: 10, y1: 60, x2: 50, y2: 95 } },
  { id: 's', label: 'S 曲线', curve: { x1: 25, y1: 15, x2: 75, y2: 85 } },
]

const actionMsg = ref('')
let actionTimer: ReturnType<typeof setTimeout> | null = null
function showAction(msg: string): void {
  actionMsg.value = msg
  if (actionTimer) clearTimeout(actionTimer)
  actionTimer = setTimeout(() => (actionMsg.value = ''), 2000)
}

/** 同步本地 store 中指定类型的曲线对象, 让 SVG/滑块立即刷新 */
function applyCurveToStore(type: CurveType, c: OutputCurve): void {
  const target =
    type === 'trigger' ? cal.triggerCurve
    : type === 'joy_x' ? cal.joyXCurve
    : type === 'joy_y' ? cal.joyYCurve
    : type === 'imu_roll' ? cal.imuRollCurve
    : cal.imuPitchCurve
  target.x1 = c.x1
  target.y1 = c.y1
  target.x2 = c.x2
  target.y2 = c.y2
}

/** 预设一键应用到全部 5 条曲线 */
async function applyPreset(c: OutputCurve): Promise<void> {
  for (const t of CURVE_TYPES) applyCurveToStore(t.id, c)
  for (const t of CURVE_TYPES) await cal.setCurve(t.id, { ...c })
  showAction('已应用预设到全部曲线')
}

/** 当前曲线复制到其余 4 条 */
async function copyToAll(): Promise<void> {
  const c = { ...activeCurve.value }
  for (const t of CURVE_TYPES) {
    if (t.id === curveType.value) continue
    applyCurveToStore(t.id, c)
    await cal.setCurve(t.id, c)
  }
  showAction('已复制到其余 4 条曲线')
}

// ---- 刻度定义 (仅正向 [0,100] 象限; viewBox 四周留白给刻度标签与控制点) ----
const VB = { x: -28, y: -118, w: 158, h: 146 }
const TICKS = [0, 25, 50, 75, 100]
const yTicks = TICKS.map(v => ({ value: v, y: -v }))
const xTicks = TICKS.map(v => ({ value: v, x: v }))
const tickClass = (v: number): string =>
  v === 0 ? 'tick-zero' : v === 100 ? 'tick-hl' : ''

// ---- 控制点拖动 ----
const svgRef = ref<SVGSVGElement | null>(null)
const dragging = ref<'p1' | 'p2' | null>(null)
let commitTimer: ReturnType<typeof setTimeout> | null = null

type CtrlPt = { id: 'p1' | 'p2'; x: number; y: number }
const controlPoints = computed<[CtrlPt, CtrlPt]>(() => {
  const c = activeCurve.value
  return [
    { id: 'p1', x: c.x1, y: -clampY(c.y1) },
    { id: 'p2', x: c.x2, y: -clampY(c.y2) },
  ]
})

function svgToValue(e: PointerEvent): [number, number] {
  const svg = svgRef.value
  if (!svg) return [0, 0]
  const rect = svg.getBoundingClientRect()
  const scale = Math.min(rect.width / VB.w, rect.height / VB.h)
  const offX = (rect.width - VB.w * scale) / 2
  const offY = (rect.height - VB.h * scale) / 2
  const vx = (e.clientX - rect.left - offX) / scale + VB.x
  const vy = -((e.clientY - rect.top - offY) / scale + VB.y)
  return [vx, vy]
}

function onControlDown(which: 'p1' | 'p2', e: PointerEvent): void {
  dragging.value = which
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onControlMove(e: PointerEvent): void {
  if (!dragging.value) return
  const [vx, vy] = svgToValue(e)
  const x = Math.round(Math.min(100, Math.max(0, vx)))
  const y = Math.round(Math.min(100, Math.max(0, vy)))
  const c = activeCurve.value
  if (dragging.value === 'p1') {
    c.x1 = x
    c.y1 = y
  } else {
    c.x2 = x
    c.y2 = y
  }
}

function onControlUp(): void {
  if (!dragging.value) return
  dragging.value = null
  scheduleCommit()
}

function scheduleCommit(): void {
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(() => {
    cal.setCurve(curveType.value, { ...activeCurve.value })
  }, 300)
}

function onCommit(c: OutputCurve): void {
  cal.setCurve(curveType.value, c)
}

// ---- 曲线效果演示动画 (指示点沿曲线往返扫描) ----
const ANIM_STEP = 100 / (3000 / 16) // ≈0.5333 → 单程 0→100 约 3s
const animX = ref(0)
const animDir = ref(1)
let animTimer: ReturnType<typeof setInterval> | null = null

const animY = computed(() => {
  const c = activeCurve.value
  const t = solveT(animX.value / 100, c.x1 / 100, c.x2 / 100)
  return clampY(bezierY(t, c.y1 / 100, c.y2 / 100) * 100)
})

function startAnim(): void {
  stopAnim()
  animTimer = setInterval(() => {
    animX.value += animDir.value * ANIM_STEP
    if (animX.value >= 100) {
      animX.value = 100
      animDir.value = -1
    } else if (animX.value <= 0) {
      animX.value = 0
      animDir.value = 1
    }
  }, 16)
}

function stopAnim(): void {
  if (animTimer) {
    clearInterval(animTimer)
    animTimer = null
  }
}

onMounted(() => {
  cal.fetchCalData()
  startAnim()
})

onBeforeUnmount(() => {
  if (commitTimer) clearTimeout(commitTimer)
  stopAnim()
})
</script>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.action-msg {
  margin-left: 8px;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.curve-body {
  display: flex;
  flex-direction: column; /* 窄屏: 上下布局 */
  gap: 10px;
}
.curve-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.curve-right {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.curve-overlay-wrap {
  background: #191919;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  align-items: center; /* 图形区水平居中, 不再拉伸到全宽 */
  justify-content: center; /* 宽屏 stretch 时内容垂直居中 */
}
.curve-overlay {
  width: 100%;
  max-width: 360px; /* 图形区最大宽度, 宽屏不无限膨胀 */
  height: auto; /* 高度随 viewBox 纵横比自动计算 */
  display: block;
  touch-action: none;
  cursor: crosshair;
}
/* 曲线效果演示面板 (条形图 + 数字) */
.curve-anim-panel {
  background: #191919;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.anim-title {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
.anim-bars {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.anim-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}
.anim-bar-row b {
  width: 26px;
  text-align: right;
  color: rgba(255, 255, 255, 0.9);
  flex-shrink: 0;
}
.bar-label {
  width: 30px;
  color: rgba(255, 255, 255, 0.6);
  flex-shrink: 0;
}
.bar-track {
  flex: 1;
  height: 10px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.05s linear;
}
.bar-fill.input {
  background: rgba(255, 255, 255, 0.45);
}
/* 宽屏: 左侧 SVG 独占, 右侧动画 + 编辑器上下分布 */
@media (min-width: 960px) {
  .curve-body {
    flex-direction: row;
    align-items: stretch;
  }
  .curve-left {
    flex: 1 1 auto;
    min-width: 0;
  }
  .curve-overlay-wrap {
    flex: 1 1 auto;
    min-width: 0;
  }
  .curve-right {
    flex: 0 0 400px;
  }
  .curve-editor-side {
    flex: 1; /* 编辑器填满右栏剩余空间 */
  }
}
@media (min-width: 1440px) {
  .curve-right {
    flex-basis: 440px;
  }
}
.ctrl-dot {
  cursor: grab;
  pointer-events: all;
}
.ctrl-dot:active {
  cursor: grabbing;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  width: 100%;
  max-width: 360px; /* 与图形区同宽对齐 */
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}
/* 刻度标签: 0 值主题色, 100 白色加粗 */
.curve-overlay text.tick-zero {
  fill: rgb(var(--v-theme-primary));
  font-weight: 700;
}
.curve-overlay text.tick-hl {
  fill: #fff;
  font-weight: 700;
}

</style>
