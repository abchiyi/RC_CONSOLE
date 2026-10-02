<template>
  <div class="telem-page">
    <!-- 统一提示: 配色由 useNotice 决定 (成功=绿 / 失败=红 / 提醒=橙) -->
    <v-snackbar v-model="snackbarVisible" :color="snackbarColor" :timeout="noticeTimeout" variant="tonal">
      {{ telemMsg }}
    </v-snackbar>

    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-access-point-network</v-icon>
        遥测
      </v-toolbar-title>
    </v-toolbar>

    <!-- 未连接 -->
    <v-alert
      v-if="!serial.connected"
      border="start"
      border-color="primary"
      class="ma-3"
      color="primary"
      icon="mdi-information"
      variant="tonal"
    >
      请先连接设备以接收飞控遥测
    </v-alert>

    <div v-if="serial.connected" class="telem-root">
      <!-- ① 接收状态 -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" :color="streamColor" size="36">
              <v-icon color="white" size="20">mdi-access-point-network</v-icon>
            </v-avatar>
          </template>

          <v-card-title>接收状态</v-card-title>
          <v-card-subtitle>
            经流式通道拉取飞控 CRSF 遥测原始帧（content_type=4），本机解析
          </v-card-subtitle>

          <template #append>
            <v-chip :color="streamColor" size="x-small" variant="tonal">
              <v-icon size="12" start>mdi-circle</v-icon>
              {{ streamStatusText }}
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="stat-groups">
            <div class="stat-group">
              <div class="stat-group-title">链路</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">当前连接</span>
                  <span class="stat-value">{{ portLabel }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">推送间隔</span>
                  <span class="stat-value mono">{{ STREAM_INTERVAL_MS }} ms</span>
                </div>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-group-title">速率</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">字节率</span>
                  <span class="stat-value mono">{{ telem.bytesPerSec }} B/s</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">帧率</span>
                  <span class="stat-value mono">{{ telem.framesPerSec }} fps</span>
                </div>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-group-title">累计</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">帧数</span>
                  <span class="stat-value mono">{{ telem.totalFrames }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">字节</span>
                  <span class="stat-value mono">{{ telem.totalBytes }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">CRC 错</span>

                  <span class="stat-value mono">
                    <span :class="telem.crcErrors > 0 ? 'val-bad' : ''">{{ telem.crcErrors }}</span>
                  </span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">坏包</span>

                  <span class="stat-value mono">
                    <span :class="telem.badFrames > 0 ? 'val-bad' : ''">{{ telem.badFrames }}</span>
                  </span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">帧龄</span>
                  <span class="stat-value mono">{{ frameAgeText }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="telem-actions mt-3">
            <v-btn prepend-icon="mdi-timer-sand" size="small" variant="tonal" @click="telem.togglePause()">
              {{ telem.paused ? '继续' : '暂停' }}
            </v-btn>

            <v-btn prepend-icon="mdi-delete-outline" size="small" variant="tonal" @click="telem.clear()">
              清空
            </v-btn>

            <v-btn prepend-icon="mdi-file-export" size="small" variant="tonal" @click="exportStats">
              复制统计
            </v-btn>

            <v-spacer />

            <v-switch
              v-model="telem.captureRaw"
              class="telem-switch"
              color="primary"
              density="compact"
              hide-details
              label="采集原始帧"
            />
          </div>

          <v-alert
            v-if="telemForwarding"
            class="mt-3 py-1"
            color="info"
            density="compact"
            variant="tonal"
          >
            已开启遥测转发（{{ telemForwardPorts }}）：本页与转发口数据<b>同源</b> ——
            同一帧既写到该口、也复制一份给本页，两边同时可见。
          </v-alert>

          <div class="cal-hint hint-neutral">
            <v-icon class="mt-0.5" size="16">mdi-information-outline</v-icon>

            <span>
              固件是「单流会话」：本页与 ELRS 页的链路流互斥，切换时会互相顶掉，属预期行为。
              下方字段来自 CRSF 遥测帧原样解码，量纲系数集中在
              <code>utils/crsfTelemetry.ts</code> 的 <code>SCALE</code>，
              与飞控自带显示不一致时先核对那里。
            </span>
          </div>
        </v-card-text>
      </v-card>

      <!-- ② 飞控遥测 -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-crosshairs-gps</v-icon>
            </v-avatar>
          </template>

          <v-card-title>飞控遥测</v-card-title>
          <v-card-subtitle>GPS / BATTERY / ATTITUDE / VARIO / BARO / AIRSPEED</v-card-subtitle>

          <template #append>
            <v-chip v-if="telem.flightMode" color="primary" size="x-small" variant="tonal">
              {{ telem.flightMode }}
            </v-chip>
            <v-chip v-else color="grey" size="x-small" variant="tonal">无飞行模式</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div v-if="!telem.streamAlive" class="cal-hint hint-neutral">
            <v-icon class="mt-0.5" size="16">mdi-information-outline</v-icon>
            <span>
              尚未收到任何遥测帧 —— 先看「帧统计」里有没有帧；一帧都没有通常是飞控没开 CRSF
              遥测输出，或接收机与飞控的串口/TX 未接好。
            </span>
          </div>

          <div v-else class="stat-groups">
            <div class="stat-group">
              <div class="stat-group-title">GPS (0x02)</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">纬度</span>
                  <span class="stat-value mono">{{ fmt(telem.gps?.lat, 6) }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">经度</span>
                  <span class="stat-value mono">{{ fmt(telem.gps?.lon, 6) }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">高度</span>
                  <span class="stat-value mono">{{ fmt(telem.gps?.altM, 1, ' m') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">地速</span>
                  <span class="stat-value mono">{{ fmt(telem.gps?.groundSpeedKmh, 1, ' km/h') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">航向</span>
                  <span class="stat-value mono">{{ fmt(telem.gps?.headingDeg, 0, '°') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">星数</span>
                  <span class="stat-value mono">{{ numOrDash(telem.gps?.satellites) }}</span>
                </div>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-group-title">电池 (0x08)</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">电压</span>
                  <span class="stat-value mono">{{ fmt(telem.battery?.voltageV, 2, ' V') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">电流</span>
                  <span class="stat-value mono">{{ fmt(telem.battery?.currentA, 1, ' A') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">已用</span>
                  <span class="stat-value mono">{{ fmt(telem.battery?.capacityMah, 0, ' mAh') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">剩余</span>
                  <span class="stat-value mono">{{ fmt(telem.battery?.remainingPct, 0, '%') }}</span>
                </div>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-group-title">姿态 (0x1E)</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">Roll</span>
                  <span class="stat-value mono">{{ fmt(telem.attitude?.rollDeg, 1, '°') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">Pitch</span>
                  <span class="stat-value mono">{{ fmt(telem.attitude?.pitchDeg, 1, '°') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">Yaw</span>
                  <span class="stat-value mono">{{ fmt(telem.attitude?.yawDeg, 1, '°') }}</span>
                </div>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-group-title">高度 / 速度</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">升降率</span>
                  <span class="stat-value mono">{{ fmt(telem.vario, 2, ' m/s') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">气压高</span>
                  <span class="stat-value mono">{{ fmt(telem.baroAlt, 1, ' m') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">空速</span>
                  <span class="stat-value mono">{{ fmt(telem.airspeed, 1, ' km/h') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">飞行模式</span>
                  <span class="stat-value">{{ telem.flightMode || '--' }}</span>
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- ③ 链路 -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-swap-horizontal</v-icon>
            </v-avatar>
          </template>

          <v-card-title>链路</v-card-title>
          <v-card-subtitle>CRSF LINK_STATS (0x14)：RF 上下行质量</v-card-subtitle>

          <template #append>
            <v-chip v-if="telem.link" color="success" size="x-small" variant="tonal">有数据</v-chip>
            <v-chip v-else color="grey" size="x-small" variant="tonal">无数据</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="stat-groups">
            <div class="stat-group">
              <div class="stat-group-title">上行 (手柄 → 飞控)</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">RSSI</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.uplinkRssiDbm, 0, ' dBm') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">RSSI 天线2</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.uplinkRssi2Dbm, 0, ' dBm') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">LQ</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.uplinkLq, 0, '%') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">SNR</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.uplinkSnrDb, 0, ' dB') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">功率档位</span>
                  <span class="stat-value mono">#{{ numOrDash(telem.link?.uplinkTxPower) }}</span>
                </div>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-group-title">下行 (飞控 → 手柄)</div>

              <div class="stat-kv-grid">
                <div class="stat-kv">
                  <span class="stat-label">RSSI</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.downlinkRssiDbm, 0, ' dBm') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">LQ</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.downlinkLq, 0, '%') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">SNR</span>
                  <span class="stat-value mono">{{ fmt(telem.link?.downlinkSnrDb, 0, ' dB') }}</span>
                </div>

                <div class="stat-kv">
                  <span class="stat-label">天线 / RF</span>
                  <span class="stat-value mono">{{ antennaText }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="cal-hint hint-neutral">
            <v-icon class="mt-0.5" size="16">mdi-information-outline</v-icon>
            <span>链路质量也可在 ELRS 页看（同一份 CRSF 0x14 帧，本页是遥测帧里的原始值）。</span>
          </div>
        </v-card-text>
      </v-card>

      <!-- ④ 帧统计 -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-numeric</v-icon>
            </v-avatar>
          </template>

          <v-card-title>帧统计</v-card-title>
          <v-card-subtitle>飞控实际下发了哪些 CRSF 遥测帧（缺哪种一眼看出）</v-card-subtitle>

          <template #append>
            <v-chip color="primary" size="x-small" variant="tonal">{{ telem.frameStats.length }} 种</v-chip>
          </template>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div v-if="telem.frameStats.length === 0" class="cal-hint hint-neutral">
            <v-icon class="mt-0.5" size="16">mdi-information-outline</v-icon>
            <span>尚未收到任何遥测帧</span>
          </div>

          <div v-else class="msg-table">
            <div class="msg-row msg-head">
              <span>类型</span>
              <span>帧</span>
              <span class="ta-r">累计</span>
              <span class="ta-r">Hz</span>
              <span class="ta-r">CRC 错</span>
              <span class="ta-r">最近</span>
            </div>

            <div v-for="s in telem.frameStats" :key="s.type" class="msg-row">
              <span class="mono">0x{{ s.type.toString(16).padStart(2, '0').toUpperCase() }}</span>
              <span class="msg-name">{{ s.name }}</span>
              <span class="mono ta-r">{{ s.count }}</span>
              <span class="mono ta-r">{{ s.hz }}</span>
              <span class="mono ta-r">{{ s.crcErrors }}</span>
              <span class="mono ta-r">{{ timeText(s.lastMs) }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- ⑤ 调试: 原始帧 -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-file</v-icon>
            </v-avatar>
          </template>

          <v-card-title>调试</v-card-title>
          <v-card-subtitle>原始 CRSF 帧（需先开启「采集原始帧」）</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div v-if="!telem.captureRaw" class="hint-empty">已关闭采集，开启上方开关后开始记录</div>
          <div v-else-if="telem.rawFrames.length === 0" class="hint-empty">暂无记录</div>

          <div v-else class="hex-list">
            <div v-for="(f, i) in telem.rawFrames" :key="`${f.t}-${i}`" class="hex-row">
              <span class="hex-time mono">{{ timeText(f.t) }}</span>
              <span class="hex-name mono">{{ f.name }} ({{ f.size }}B)</span>
              <span class="hex-body mono">{{ f.hex }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, watch } from 'vue'
  import { useNotice } from '@/composables/useNotice'
  import { useConfigStore } from '@/stores/config'
  import { useSerialStore } from '@/stores/serial'
  import { useTelemetryStore } from '@/stores/telemetry'

  /** 与 stores/telemetry.ts 的推送间隔保持一致（仅用于展示） */
  const STREAM_INTERVAL_MS = 100

  const serial = useSerialStore()
  const telem = useTelemetryStore()
  const configStore = useConfigStore()

  /** 独占遥测转发开启时：同一帧既写该口、也复制一份给本页（同源，见 crsf_telem.h） */
  const telemForwarding = computed(() => configStore.telem2Usb || configStore.telem2Bt)
  const telemForwardPorts = computed(() => {
    const ports: string[] = []
    if (configStore.telem2Usb) ports.push('USB')
    if (configStore.telem2Bt) ports.push('蓝牙')
    return ports.join(' / ')
  })

  const {
    text: telemMsg, color: snackbarColor, visible: snackbarVisible, show: notify, timeoutMs: noticeTimeout,
  } = useNotice(2000)

  const portLabel = computed(() => (serial.isBluetooth ? '蓝牙' : 'USB'))

  // ---- 接收状态 ----
  const streamStatusText = computed(() => {
    if (telem.paused) return '已暂停'
    if (!telem.streamAlive) return '无数据'
    return telem.frameAgeMs > 3000 ? '数据陈旧' : '接收中'
  })
  const streamColor = computed(() => {
    if (telem.paused) return 'grey'
    if (!telem.streamAlive) return 'grey'
    return telem.frameAgeMs > 3000 ? 'warning' : 'success'
  })
  const frameAgeText = computed(() => {
    if (!telem.streamAlive) return '--'
    const ms = telem.frameAgeMs
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
  })

  const antennaText = computed(() => {
    if (!telem.link) return '--'
    return `ANT${telem.link.activeAntenna} / RF${telem.link.rfMode}`
  })

  // ---- 小工具 ----
  function fmt (v: number | null | undefined, digits = 1, suffix = ''): string {
    if (v == null || Number.isNaN(v)) return '--'
    return `${v.toFixed(digits)}${suffix}`
  }
  function numOrDash (v: number | null | undefined): string {
    return v == null ? '--' : String(v)
  }
  function timeText (ms: number): string {
    if (!ms) return '--'
    const d = new Date(ms)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  }

  /** 复制统计摘要到剪贴板（便于贴给他人排查） */
  async function exportStats (): Promise<void> {
    const lines: string[] = [
      `端口: ${portLabel.value}`,
      `速率: ${telem.bytesPerSec} B/s, ${telem.framesPerSec} fps`,
      `累计: ${telem.totalFrames} 帧 / ${telem.totalBytes} 字节, CRC 错 ${telem.crcErrors}, 坏包 ${telem.badFrames}`,
    ]
    if (telem.flightMode) lines.push(`飞行模式: ${telem.flightMode}`)
    if (telem.battery) {
      lines.push(`电池: ${fmt(telem.battery.voltageV, 2)} V / ${fmt(telem.battery.currentA, 1)} A `
        + `/ ${telem.battery.capacityMah} mAh / ${telem.battery.remainingPct}%`)
    }
    if (telem.gps) {
      lines.push(`GPS: ${fmt(telem.gps.lat, 6)}, ${fmt(telem.gps.lon, 6)} 星数 ${telem.gps.satellites}`)
    }
    if (telem.link) {
      lines.push(`链路: 上行 ${telem.link.uplinkRssiDbm} dBm / LQ ${telem.link.uplinkLq}% `
        + `| 下行 ${telem.link.downlinkRssiDbm} dBm / LQ ${telem.link.downlinkLq}%`)
    }
    lines.push('帧统计:')
    for (const s of telem.frameStats) {
      lines.push(`  0x${s.type.toString(16).padStart(2, '0').toUpperCase()} ${s.name}: `
        + `${s.count} 帧, ${s.hz} Hz, CRC 错 ${s.crcErrors}`)
    }
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      notify('统计已复制到剪贴板')
    } catch {
      console.log(text)
      notify('剪贴板不可用，已输出到控制台', 'warning')
    }
  }

  // ---- 生命周期 ----
  watch(() => serial.connected, connected => {
    if (connected) telem.start()
    else telem.stop()
  })

  onMounted(() => {
    if (serial.connected) telem.start()
  })

  onUnmounted(() => {
    telem.stop() // 撤销流请求，避免离开页面后仍占用固件单流会话
  })
</script>

<style scoped>
/* ── 页面布局 (与 config / elrs / system 页一致) ── */
.telem-page {
  padding: 0 16px 96px;
}

.telem-page>.v-toolbar {
  margin: 0 -16px;
}

.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}

.telem-root {
  width: 100%;
}

/* 卡片外壳 (与 elrs / CalWizard 一致) */
.cal-card {
  background: #1e1e1e !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  transition: border-color 0.3s, background-color 0.3s;
}

.cal-card:hover {
  border-color: rgba(255, 255, 255, 0.16) !important;
}

/* ── 分组面板 + 键值网格 (复用 elrs 页排版) ── */
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

.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* 异常值高亮 (如 CRC 错误 / 坏包) */
.val-bad {
  color: rgb(var(--v-theme-warning));
}

/* ── 操作行 ── */
.telem-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.telem-actions .telem-switch {
  margin: 0;
  flex: 0 0 auto;
}

/* ── 提示条 (与 elrs 页一致) ── */
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

.hint-empty {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
  padding: 4px 2px;
}

/* ── 帧统计表 ── */
.msg-table {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.msg-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 64px 56px 64px 84px;
  gap: 6px;
  padding: 4px 10px;
  font-size: 0.75rem;
  align-items: baseline;
}

.msg-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}

.msg-head {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.04);
}

.msg-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ta-r {
  text-align: right;
}

/* ── 原始帧 hex 列表 ── */
.hex-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}

.hex-row {
  display: flex;
  gap: 10px;
  font-size: 0.7rem;
  padding: 2px 4px;
  border-radius: 4px;
  align-items: baseline;
}

.hex-row:nth-child(odd) {
  background: rgba(255, 255, 255, 0.02);
}

.hex-time {
  flex: 0 0 74px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.7rem;
}

.hex-name {
  flex: 0 0 168px;
  color: rgba(255, 255, 255, 0.7);
}

.hex-body {
  flex: 1 1 auto;
  min-width: 0;
  color: rgba(255, 255, 255, 0.55);
  word-break: break-all;
}
</style>
