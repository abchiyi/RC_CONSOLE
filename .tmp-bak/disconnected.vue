<template>
  <div class="disc-page">
    <v-card class="disc-card" elevation="0" rounded="lg" variant="outlined">
      <v-card-text class="disc-body">
        <!-- 状态图标: 未连接=mdi-usb-port -->
        <v-avatar class="disc-avatar" size="68">
          <v-icon size="32">{{ serial.statusIcon }}</v-icon>
        </v-avatar>

        <div class="text-h6 disc-title">未连接设备</div>
        <div class="disc-sub">{{ statusHint }}</div>

        <!-- 连接入口: Electron 走端口下拉, 浏览器走原生串口选择弹窗; 蓝牙入口两者通用 -->
        <div class="disc-actions">
          <template v-if="serial.isElectron">
            <v-btn
              icon="mdi-refresh"
              :loading="serial.loadingPorts"
              size="small"
              variant="text"
              @click="serial.refreshPorts()"
            />

            <v-select
              v-model="selectedPort"
              class="disc-select"
              clearable
              density="compact"
              :disabled="serial.availablePorts.length === 0"
              hide-details
              item-title="path"
              item-value="path"
              :items="serial.availablePorts"
              label="COM"
            />

            <v-btn
              color="primary"
              :disabled="!selectedPort"
              :loading="serial.connecting"
              prepend-icon="mdi-usb-port"
              size="small"
              variant="flat"
              @click="handleConnect"
            >
              连接
            </v-btn>
          </template>

          <v-btn
            v-else
            :color="serial.supported ? 'primary' : 'grey'"
            :disabled="!serial.supported"
            :loading="serial.connecting"
            prepend-icon="mdi-usb-port"
            size="small"
            variant="flat"
            @click="serial.connect()"
          >
            {{ serial.portHeld ? '重新连接' : '连接设备' }}
          </v-btn>

          <!-- 软断开后端口仍被占用: 换端口 / 拔插前需要显式释放 -->
          <v-btn
            v-if="serial.portHeld && !serial.isElectron"
            :color="confirmRelease ? 'error' : undefined"
            prepend-icon="mdi-link-off"
            size="small"
            variant="text"
            @click="handleRelease"
          >
            {{ confirmRelease ? '确认释放（设备会重启）' : '释放端口' }}
          </v-btn>

          <v-btn
            v-if="serial.bluetoothSupported"
            color="bluetooth"
            :loading="serial.connecting"
            prepend-icon="mdi-bluetooth"
            size="small"
            variant="tonal"
            @click="serial.connectBLE()"
          >
            蓝牙
          </v-btn>
        </div>

        <!-- 连接失败原因 / 环境不支持 -->
        <v-alert
          v-if="serial.error"
          class="disc-alert"
          color="error"
          density="compact"
          variant="tonal"
        >
          {{ serial.error }}
        </v-alert>

        <v-alert
          v-else-if="!serial.supported"
          class="disc-alert"
          color="warning"
          density="compact"
          variant="tonal"
        >
          当前环境不支持串口 / 蓝牙连接，请使用 Chrome / Edge 内核浏览器，或改用桌面版应用。
        </v-alert>

        <div class="disc-tips">
          <v-icon size="14">mdi-information-outline</v-icon>

          <span v-if="serial.portHeld">
            端口保持期间设备不会复位；「释放端口」会真正关闭串口并导致设备重启，仅在换端口时使用。
            刷新页面、关闭标签页同样会释放。
          </span>

          <span v-else>USB 请用数据线（不支持仅充电线）；蓝牙请在设备上电后搜索并配对。</span>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue'
  import { useSerialStore } from '@/stores/serial'

  const serial = useSerialStore()

  /** Electron 端口下拉: 默认回填上次连过的口, 省一次挑选 */
  const selectedPort = ref<string | null>(serial.lastPortPath || null)

  const statusHint = computed(() => {
    if (!serial.supported) return '当前环境无法建立连接'
    if (serial.connecting) return '正在建立连接…'
    if (serial.portHeld) return '已断开通讯，串口仍保持打开（设备不会复位），可直接重新连接'
    return '通过 USB 串口或蓝牙连接设备后，即可查看与修改配置'
  })

  // 端口列表是进入页面后才刷出来的，回填值若被清空则等列表到位再补一次
  watch(() => serial.lastPortPath, p => {
    if (p && !selectedPort.value) selectedPort.value = p
  })

  onMounted(() => {
    if (serial.isElectron) void serial.refreshPorts()
  })

  function handleConnect (): void {
    if (selectedPort.value) void serial.connect(selectedPort.value)
  }

  // 释放端口会真正 close() 串口：主机 deassert 控制信号会被 ESP32-S3 的
  // USB Serial/JTAG 当成复位信号 → 设备重启，所以要点两下
  const confirmRelease = ref(false)
  let confirmTimer: ReturnType<typeof setTimeout> | null = null

  function handleRelease (): void {
    if (confirmTimer) clearTimeout(confirmTimer)
    if (!confirmRelease.value) {
      confirmRelease.value = true
      confirmTimer = setTimeout(() => {
        confirmRelease.value = false
      }, 4000)
      return
    }
    confirmRelease.value = false
    void serial.releasePort()
  }
</script>

<style scoped>
/* 整页居中: 未连接时没有侧栏与底栏, 内容区自己找中心 */
.disc-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 24px 16px;
}

/* 卡片外壳 (对齐 system 页 .cal-card) */
.disc-card {
  width: 100%;
  max-width: 460px;
  background: #1e1e1e !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

.disc-body {
  padding: 32px 28px 24px;
  text-align: center;
}

.disc-avatar {
  margin-bottom: 14px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
}

.disc-title {
  font-weight: 600;
}

.disc-sub {
  margin-top: 4px;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.45);
}

/* 连接入口: 居中横排, 窄屏自动换行 */
.disc-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

.disc-select {
  max-width: 160px;
}

.disc-alert {
  margin-top: 16px;
  text-align: left;
}

.disc-tips {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 16px;
  font-size: 0.7rem;
  line-height: 1.45;
  text-align: left;
  color: rgba(255, 255, 255, 0.38);
}
</style>
