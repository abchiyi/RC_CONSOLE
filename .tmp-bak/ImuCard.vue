<template>
  <v-card rounded="lg" variant="outlined" elevation="0" class="cal-card my-2">
    <v-card-item>
      <template #prepend>
        <v-avatar color="warning" size="36" class="cal-avatar">
          <v-icon color="white" size="20">mdi-axis-arrow</v-icon>
        </v-avatar>
      </template>
      <v-card-title>
        {{ title }}
      </v-card-title>
      <v-card-subtitle>{{ subtitle }}</v-card-subtitle>
      <template #append>
        <v-chip v-if="running" color="warning" size="small" variant="tonal">
          <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
          {{ progress }}%
        </v-chip>
      </template>
    </v-card-item>

    <v-card-text>
      <!-- IMU 姿态: 宽屏左右布局 (视窗 | 读数), 窄屏上下布局 -->
      <div class="imu-layout">
        <!-- 3D 姿态画布: 网格背景 + 手柄模型 (保持 4:3 比例尺, 不随容器拉伸) -->
        <div class="imu-canvas-wrap">
          <div class="imu-canvas-frame">
            <canvas ref="imuCanvas" class="imu-canvas" width="480" height="360" />
          </div>
        </div>

        <!-- 右侧数据面板: 分组卡片 (标题 + 数值格), 等宽字体, 无阴影扁平 -->
        <div class="imu-panel">
          <div class="imu-group">
            <div class="imu-group-title">基础角度</div>
            <div class="stat-grid">
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Roll</div>
                <div class="mono text-h6 font-weight-bold">{{ fmtDeg(imu.roll) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Pitch</div>
                <div class="mono text-h6 font-weight-bold">{{ fmtDeg(imu.pitch) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Yaw</div>
                <div class="mono text-h6 font-weight-bold">{{ fmtDeg(imu.yaw) }}</div>
              </div>
            </div>
          </div>

          <div class="imu-group">
            <div class="imu-group-title">加速度</div>
            <div class="stat-grid">
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">X</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtG(imu.acc?.x) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Y</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtG(imu.acc?.y) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Z</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtG(imu.acc?.z) }}</div>
              </div>
            </div>
          </div>

          <div class="imu-group">
            <div class="imu-group-title">角速度</div>
            <div class="stat-grid">
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">X</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtRate(imu.rate?.x) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Y</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtRate(imu.rate?.y) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Z</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtRate(imu.rate?.z) }}</div>
              </div>
            </div>
          </div>

          <!-- 零偏来自 cal_get 的校准数据: 纯观察场景（出厂测试）没有这一组 -->
          <div v-if="showBias" class="imu-group">
            <div class="imu-group-title">零偏移</div>
            <div class="stat-grid">
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">X</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtBias(imu.gyro_bias_x) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Y</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtBias(imu.gyro_bias_y) }}</div>
              </div>
              <div class="stat-col text-center">
                <div class="text-caption text-medium-emphasis mb-1">Z</div>
                <div class="mono text-subtitle-1 font-weight-bold">{{ fmtBias(imu.gyro_bias_z) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <v-progress-linear v-if="running" :model-value="progress" color="warning" class="mt-3" height="6" rounded />
      <v-alert v-if="message" class="mt-3 py-1" density="compact" :color="running ? 'warning' : 'success'"
        variant="tonal">
        {{ message }}
      </v-alert>
      <div v-if="showZeroHint" class="cal-hint">
        <v-icon size="16" class="mt-0.5">mdi-information-outline</v-icon>
        <span>IMU 三轴原点由 <b>SHOT 按钮短按</b> 临时设置：按一次即把当前姿态作为零位</span>
      </div>
    </v-card-text>

  </v-card>
</template>

<script setup lang="ts">
  import { onMounted, onUnmounted, ref } from 'vue'
  import type { ImuCal } from '@/stores/calibration'

  /**
   * IMU 姿态卡（3D 视窗 + 读数面板）—— 从 CalWizard 里抽出来，供校准页与出厂测试页共用。
   *   数据由**外部传入**（imu），组件自己不碰 store: 出厂测试页吃不到 calibration store 那条
   *   content_type=1 的流（本页只有一条流名额），它的数据来自出厂测试帧尾的扩展段。
   *   校准相关的 UI（进度条 / 提示语 / 零偏组 / 归零提示）用 props 开关，纯观察场景全部关闭。
   */
  const props = withDefaults(defineProps<{
    /** 姿态 + 加速度 + 角速度 + 零偏（字段全可选: 缺数据的位置显示 --） */
    imu: ImuCal
    title?: string
    subtitle?: string
    /** 校准进行中（仅校准页） */
    running?: boolean
    progress?: number
    message?: string | null
    /** 零偏组需要 cal_get 的校准数据，观察场景不显示 */
    showBias?: boolean
    /** SHOT 短按归零的操作提示（仅校准页） */
    showZeroHint?: boolean
  }>(), {
    title: 'IMU',
    subtitle: '将设备静置后校准陀螺仪零偏',
    running: false,
    progress: 0,
    message: null,
    showBias: true,
    showZeroHint: true,
  })

  // --- IMU 3D 姿态画布 (原生 canvas 2D 手写透视投影) ---
  const imuCanvas = ref<HTMLCanvasElement | null>(null)

  type Vec3 = [number, number, number]
  type Vec2 = { x: number, y: number }
  type Mat3 = [Vec3, Vec3, Vec3]

  /** 3×3 矩阵乘法 */
  function mul3 (a: Mat3, b: Mat3): Mat3 {
    const [a0, a1, a2] = a
    const [b0, b1, b2] = b
    return [
      [
        a0[0] * b0[0] + a0[1] * b1[0] + a0[2] * b2[0],
        a0[0] * b0[1] + a0[1] * b1[1] + a0[2] * b2[1],
        a0[0] * b0[2] + a0[1] * b1[2] + a0[2] * b2[2],
      ],
      [
        a1[0] * b0[0] + a1[1] * b1[0] + a1[2] * b2[0],
        a1[0] * b0[1] + a1[1] * b1[1] + a1[2] * b2[1],
        a1[0] * b0[2] + a1[1] * b1[2] + a1[2] * b2[2],
      ],
      [
        a2[0] * b0[0] + a2[1] * b1[0] + a2[2] * b2[0],
        a2[0] * b0[1] + a2[1] * b1[1] + a2[2] * b2[1],
        a2[0] * b0[2] + a2[1] * b1[2] + a2[2] * b2[2],
      ],
    ]
  }

  /** 单轴旋转矩阵, 弧度制 */
  function rotX (a: number): Mat3 {
    const c = Math.cos(a), s = Math.sin(a)
    return [[1, 0, 0], [0, c, -s], [0, s, c]]
  }
  function rotY (a: number): Mat3 {
    const c = Math.cos(a), s = Math.sin(a)
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
  }
  function rotZ (a: number): Mat3 {
    const c = Math.cos(a), s = Math.sin(a)
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
  }

  /**
   * 设备轴 → 屏幕轴: 固件 Mahony 输出 ZYX 欧拉角 (roll 绕设备 X, pitch 绕设备 Y, yaw 绕设备 Z)
   * roll → 屏幕 Z, pitch → 屏幕 X, yaw → 屏幕 Y
   */
  function deviceToScreen (roll: number, pitch: number, yaw: number): Mat3 {
    return mul3(mul3(rotY(yaw), rotX(pitch)), rotZ(roll))
  }

  function apply (R: Mat3, v: Vec3): Vec3 {
    return [
      R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
      R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
      R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
    ]
  }

  interface Box3 {
    verts: Vec3[]   // 8 顶点
    faces: Vec3[][] // 6 面, 每面 4 顶点(逆时针朝外)
    fill: string
    stroke: string
  }

  /** 长方体: 中心(cx,cy,cz), 半尺寸(hw,hh,hd) */
  function makeBox (cx: number, cy: number, cz: number, hw: number, hh: number, hd: number): Box3 {
    const v = (x: number, y: number, z: number): Vec3 => [x, y, z]
    const verts: Vec3[] = [
      v(cx - hw, cy - hh, cz - hd), v(cx + hw, cy - hh, cz - hd),
      v(cx + hw, cy + hh, cz - hd), v(cx - hw, cy + hh, cz - hd),
      v(cx - hw, cy - hh, cz + hd), v(cx + hw, cy - hh, cz + hd),
      v(cx + hw, cy + hh, cz + hd), v(cx - hw, cy + hh, cz + hd),
    ]
    const faces: Vec3[][] = [
      [4, 5, 6, 7].map(i => verts[i]!), // +z 前
      [1, 0, 3, 2].map(i => verts[i]!), // -z 后
      [0, 4, 7, 3].map(i => verts[i]!), // -x 左
      [5, 1, 2, 6].map(i => verts[i]!), // +x 右
      [3, 7, 6, 2].map(i => verts[i]!), // +y 上
      [0, 1, 5, 4].map(i => verts[i]!), // -y 下
    ]
    return { verts, faces, fill: '', stroke: '' }
  }

  /** 模型: 简单立方体 (中心在原点, 半边长 1.6) */
  const boxes: Box3[] = [
    makeBox(0, 0, 0, 1.6, 1.6, 1.6),
  ]

  /** 面朝向颜色: 面向相机(正面)亮 / 背对相机(背面)暗 */
  const FILL_FRONT = 'rgba(255,152,0,0.14)'
  const FILL_BACK = 'rgba(255,152,0,0.05)'
  const STROKE_FRONT = 'rgba(255,167,38,0.9)'
  const STROKE_BACK = 'rgba(255,167,38,0.35)'

  /** 三轴指示线: X红 / Y绿 / Z蓝, 长度约 40px */
  const AXES: Array<[Vec3, string]> = [
    [[1, 0, 0], '#ff5252'],
    [[0, 1, 0], '#69f0ae'],
    [[0, 0, 1], '#448aff'],
  ]
  const AXIS_LEN = 1.25

  function drawScene (): void {
    const canvas = imuCanvas.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 固定 480×360 逻辑坐标系: 位图恒定, 模型比例尺不变, 缩放由 CSS 等比完成
    const W = canvas.width
    const H = canvas.height

    // 黑底
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    // 浅灰网格 28px
    const g = 28
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    for (let y = 0; y <= H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke()

    // 中央十字 (提亮)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H)
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2)
    ctx.stroke()

    // 姿态 → 旋转矩阵 (模型先绕 Y 轴 180°: 0 位时前方由朝向屏幕外 → 朝向屏幕内)
    const deg = Math.PI / 180
    // 显示侧方向适配: 横滚/偏航的旋向与手柄实际动作相反, 取反以贴合手感
    // (仅作用于本视图的渲染, 不改变固件送出的原始姿态与通道输出)
    const roll = -(props.imu.roll ?? 0) * deg
    const pitch = (props.imu.pitch ?? 0) * deg
    const yaw = -(props.imu.yaw ?? 0) * deg
    const R0: Mat3 = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]] // Ry(180°): 0 位时前方朝屏幕内
    const R = mul3(deviceToScreen(roll, pitch, yaw), R0)

    // 透视投影: focal=200, 相机 z=6 (固定坐标系)
    const focal = 200
    const camZ = 6
    const cx = W / 2
    const cy = H / 2
    const proj = (v: Vec3): Vec2 => {
      const r = apply(R, v)
      const s = focal / (camZ - r[2])
      // canvas +y 向下 → 取反, 否则模型 +Y 被画到屏幕下方, 画面整体上下镜像且手性变左手系
      return { x: cx + r[0] * s, y: cy - r[1] * s }
    }

    // 全部面按深度从远到近绘制 (画家算法); 按朝向区分亮/暗边框
    type FaceDraw = { pts: Vec2[], avgZ: number, fill: string, stroke: string }
    const faces: FaceDraw[] = []
    for (const b of boxes) {
      for (const f of b.faces) {
        // 变换后的面顶点
        const rs = f.map(v => apply(R, v))
        let avgZ = 0
        const pts = rs.map(r => {
          avgZ += r[2]
          const s = focal / (camZ - r[2])
          return { x: cx + r[0] * s, y: cy - r[1] * s }
        })
        // 面法向量 n = (p1-p0) × (p2-p0), 屏幕系
        const r0 = rs[0]!, r1 = rs[1]!, r2 = rs[2]!
        const u: Vec3 = [r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]]
        const v2: Vec3 = [r2[0] - r0[0], r2[1] - r0[1], r2[2] - r0[2]]
        const nx = u[1] * v2[2] - u[2] * v2[1]
        const ny = u[2] * v2[0] - u[0] * v2[2]
        const nz = u[0] * v2[1] - u[1] * v2[0]
        // 面中心 (顶点均值)
        let mx = 0, my = 0, mz = 0
        for (const r of rs) { mx += r[0]; my += r[1]; mz += r[2] }
        mx /= rs.length; my /= rs.length; mz /= rs.length
        // 面向相机 = 法向量 · (相机位置 - 面中心) > 0
        const facing = nx * (0 - mx) + ny * (0 - my) + nz * (camZ - mz) > 0
        faces.push({
          pts,
          avgZ: avgZ / f.length,
          fill: facing ? FILL_FRONT : FILL_BACK,
          stroke: facing ? STROKE_FRONT : STROKE_BACK,
        })
      }
    }
    faces.sort((a, b) => a.avgZ - b.avgZ) // z 小 = 更远, 先画

    for (const f of faces) {
      ctx.beginPath()
      ctx.moveTo(f.pts[0]!.x, f.pts[0]!.y)
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i]!.x, f.pts[i]!.y)
      ctx.closePath()
      ctx.fillStyle = f.fill
      ctx.fill()
      ctx.strokeStyle = f.stroke
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // 三轴指示线
    const o = proj([0, 0, 0])
    ctx.lineWidth = 2
    for (const [dir, color] of AXES) {
      const p = proj([dir[0] * AXIS_LEN, dir[1] * AXIS_LEN, dir[2] * AXIS_LEN])
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.moveTo(o.x, o.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }

    // 正前方标记: 立方体 +Z 正面中心的白色实心三角箭头 (尖端指向模型前方投影方向, 正对时朝上兜底)
    const f = proj([0, 0, 1.6])
    const c0 = proj([0, 0, 0])
    let dx = f.x - c0.x
    let dy = f.y - c0.y
    const dlen = Math.hypot(dx, dy)
    if (dlen < 1e-3) { dx = 0; dy = -1 } // 前方垂直屏幕(投影退化)时箭头朝上
    else { dx /= dlen; dy /= dlen }
    const size = 11
    const px = -dy, py = dx // 垂直于箭头方向的单位向量
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(f.x + dx * size, f.y + dy * size)                                            // 尖端
    ctx.lineTo(f.x - dx * size * 0.6 + px * size * 0.6, f.y - dy * size * 0.6 + py * size * 0.6)
    ctx.lineTo(f.x - dx * size * 0.6 - px * size * 0.6, f.y - dy * size * 0.6 - py * size * 0.6)
    ctx.closePath()
    ctx.fill()

    // 原点标记
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  let rafId = 0
  function startRender (): void {
    cancelAnimationFrame(rafId)
    const loop = (): void => {
      drawScene()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
  }

  // --- 格式化 ---
  function fmtDeg (v?: number): string {
    if (v === undefined || v === null) return '--'
    return v.toFixed(1) + '°'
  }
  function fmtBias (v?: number): string {
    if (v === undefined || v === null) return '--'
    return v.toFixed(4)
  }
  function fmtG (v?: number): string {
    if (v === undefined || v === null) return '--'
    return v.toFixed(2) + ' g'
  }
  function fmtRate (v?: number): string {
    if (v === undefined || v === null) return '--'
    return v.toFixed(1) + ' °/s'
  }

  onMounted(() => {
    startRender()
  })

  onUnmounted(() => {
    cancelAnimationFrame(rafId)
  })
</script>

<style scoped>
.cal-card {
  background: #1e1e1e !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  transition: border-color 0.3s, background-color 0.3s;
}

.cal-card:hover {
  border-color: rgba(255, 255, 255, 0.16) !important;
}

.cal-avatar {
  margin-right: 4px;
}

/* 等宽数字字体 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.cal-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 179, 0, 0.5);
  background: rgba(255, 179, 0, 0.1);
  color: rgba(255, 235, 190, 0.9);
  font-size: 0.75rem;
  line-height: 1.45;
}

/* 状态数值列 */
.stat-col {
  border-radius: 10px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
}

/* 状态数值网格: flex + gap 产生真实间距 (不依赖 Vuetify gutter, 避免被 stat-col padding 覆盖) */
.stat-grid {
  display: flex;
  gap: 12px;
}

.stat-grid > .stat-col {
  flex: 1 1 0;
  min-width: 0;
}

/* IMU 姿态布局: 窄屏上下 (视窗在上, 读数在下), 宽屏左右 */
.imu-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.imu-canvas-wrap {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  justify-content: center;
  aspect-ratio: 4 / 3;   /* 窄屏兜底高度, 防止画布塌陷 */
}

/* 裁剪容器: 不锁比例, 宽屏由布局 stretch 决定高度 */
.imu-canvas-frame {
  position: relative;
  width: 100%;
  max-width: 640px;
  height: 100%;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* 画布: 填满父节点, cover 等比显示 + 裁剪, 比例尺恒定不失真 */
.imu-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 右侧数据面板: 简单文字排列 + 等宽字体, 无背景无阴影 */
.imu-panel {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 8px 4px;
}

/* 参数分组卡片: 浅色圆角块, 无阴影扁平 */
.imu-group {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 12px;
}

.imu-group-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 6px;
}

.imu-group .stat-col {
  border: none;
  background: transparent;
}

.imu-group .stat-col .mono {
  font-family: 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

/* 宽屏: 左右布局 */
@media (min-width: 720px) {
  .imu-layout {
    flex-direction: row;
    align-items: stretch;
  }
  .imu-canvas-wrap {
    aspect-ratio: auto;   /* 高度改由布局 stretch 决定, 与右侧面板等高 */
    max-width: 55%;
  }
}
</style>
