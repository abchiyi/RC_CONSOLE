<template>
  <div class="xbox-page">
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title class="text-h6 page-title">
        <v-icon class="mr-2">mdi-gamepad-variant</v-icon>
        手柄输出
      </v-toolbar-title>

      <v-spacer />
      <v-chip v-if="xbox.dirty" color="warning" size="small" variant="tonal">未保存</v-chip>
    </v-toolbar>

    <!-- 未连接（路由门禁通常已挡住，这里仍做页面内兜底） -->
    <v-alert
      v-if="!serial.connected"
      border="start"
      border-color="primary"
      class="ma-3"
      color="primary"
      icon="mdi-information"
      variant="tonal"
    >
      请先连接设备以配置手柄输出
    </v-alert>

    <template v-if="serial.connected">
      <!-- 通道约束：Xbox 模式 USB 被手柄独占，无 CDC -->
      <v-alert
        border="start"
        border-color="primary"
        class="mb-3"
        color="primary"
        density="compact"
        icon="mdi-bluetooth"
        variant="tonal"
      >
        <div class="text-body-2">
          配置会立即生效并保存到设备。手柄（Xbox）模式下 USB 口被手柄独占、没有串口，
          若要边打边调请用<strong>蓝牙</strong>连接；用 USB 串口修改则在下次以手柄模式开机时生效。
        </div>
      </v-alert>

      <!-- 旧固件：不支持该命令组 -->
      <v-alert
        v-if="xbox.supported === false"
        class="mb-3"
        color="warning"
        density="compact"
        icon="mdi-alert-outline"
        variant="tonal"
      >
        当前固件不支持手柄输出配置（缺少 0x0901/0x0902 命令），请升级固件后重试。
      </v-alert>

      <!-- ── 摇杆映射总览（两个十字图）── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-axis-arrow</v-icon>
            </v-avatar>
          </template>

          <v-card-title>摇杆映射总览</v-card-title>
          <v-card-subtitle>四端标注输入源与正/负方向，翻转后标注互换</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="cross-grid">
            <StickCross
              title="左摇杆"
              :x-invert="xbox.editCfg.axes.lx.invert"
              :x-label="xboxSourceShort(xbox.editCfg.axes.lx.source)"
              :x-range="imuRange('lx')"
              :y-invert="xbox.editCfg.axes.ly.invert"
              :y-label="xboxSourceShort(xbox.editCfg.axes.ly.source)"
              :y-range="imuRange('ly')"
            />

            <StickCross
              title="右摇杆"
              :x-invert="xbox.editCfg.axes.rx.invert"
              :x-label="xboxSourceShort(xbox.editCfg.axes.rx.source)"
              :x-range="imuRange('rx')"
              :y-invert="xbox.editCfg.axes.ry.invert"
              :y-label="xboxSourceShort(xbox.editCfg.axes.ry.source)"
              :y-range="imuRange('ry')"
            />
          </div>
        </v-card-text>
      </v-card>

      <!-- ── 模拟轴映射与灵敏度 ── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-tune-variant</v-icon>
            </v-avatar>
          </template>

          <v-card-title>模拟轴映射与灵敏度</v-card-title>
          <v-card-subtitle>6 个摇杆/扳机轴的输入源、翻转方向与姿态角度量程</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="cal-hint">
            <v-icon size="14">mdi-information-outline</v-icon>

            <span>
              姿态源的角度量程越小越灵敏（打满摇杆所需倾斜角）。IMU 只允许映射到模拟轴；
              波轮上下拨、物理按键等布尔源只能映射到按钮。双向源映射到扳机轴时负半丢弃。
            </span>
          </div>

          <div v-for="key in XBOX_AXIS_KEYS" :key="key" class="param-group axis-row">
            <span class="text-caption font-weight-bold">
              {{ XBOX_AXIS_LABELS[key] }}
              <span class="text-caption text-medium-emphasis">{{ key.toUpperCase() }}</span>
            </span>

            <span class="param-controls">
              <v-select
                v-model="xbox.editCfg.axes[key].source"
                class="param-select"
                density="compact"
                :disabled="!xbox.supported || xbox.busy"
                hide-details
                item-title="title"
                item-value="value"
                :items="XBOX_AXIS_SOURCE_OPTIONS"
                variant="outlined"
                @update:model-value="onAxisChanged(key)"
              />

              <v-number-input
                v-model="xbox.editCfg.axes[key].half_range_deg"
                class="param-val"
                control-variant="stacked"
                density="compact"
                :disabled="!xbox.supported || xbox.busy || !isImu(key)"
                hide-details
                :label="isImu(key) ? '量程 °' : '—'"
                :max="90"
                :min="5"
                :step="1"
                variant="outlined"
                @update:model-value="xbox.markDirty()"
              />

              <v-switch
                v-model="xbox.editCfg.axes[key].invert"
                class="telem-switch"
                density="compact"
                :disabled="!xbox.supported || xbox.busy"
                hide-details
                label="翻转"
                @update:model-value="xbox.markDirty()"
              />
            </span>
          </div>
        </v-card-text>
      </v-card>

      <!-- ── 按钮映射（15 个，按组折叠）── -->
      <v-card class="cal-card my-2" elevation="0" rounded="lg" variant="outlined">
        <v-card-item class="pb-0">
          <template #prepend>
            <v-avatar class="cal-avatar" color="primary" size="36">
              <v-icon color="white" size="20">mdi-gamepad-right</v-icon>
            </v-avatar>
          </template>

          <v-card-title>按钮映射</v-card-title>
          <v-card-subtitle>15 个 Xbox 按键，可选物理按钮、波轮拨动或模拟量半周触发</v-card-subtitle>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <div class="cal-hint">
            <v-icon size="14">mdi-information-outline</v-icon>

            <span>
              模拟量映射到按钮时，超过阈值即视为按下；半周可选「全周 / 正半周 / 负半周」，
              于是摇杆 X 的正半可给 A、负半给 B。波轮上拨/下拨为 80ms 脉冲按下。
              IMU 不能映射到按钮。
            </span>
          </div>

          <v-expansion-panels v-model="openGroups" class="mt-3" multiple variant="accordion">
            <v-expansion-panel
              v-for="group in XBOX_BUTTON_GROUPS"
              :key="group.title"
              elevation="0"
              rounded="lg"
            >
              <v-expansion-panel-title>
                <v-icon class="mr-2" size="18">{{ group.icon }}</v-icon>
                <span class="text-body-2 font-weight-bold">{{ group.title }}</span>
                <span class="text-caption text-medium-emphasis ml-2">{{ group.subtitle }}</span>
              </v-expansion-panel-title>

              <v-expansion-panel-text>
                <div v-for="key in group.keys" :key="key" class="param-group axis-row">
                  <span class="text-caption font-weight-bold btn-name">
                    {{ XBOX_BUTTON_LABELS[key] }}
                  </span>

                  <span class="param-controls">
                    <v-select
                      v-model="xbox.editCfg.buttons[key].source"
                      class="param-select"
                      density="compact"
                      :disabled="!xbox.supported || xbox.busy"
                      hide-details
                      item-title="title"
                      item-value="value"
                      :items="XBOX_BUTTON_SOURCE_OPTIONS"
                      variant="outlined"
                      @update:model-value="onButtonChanged(key)"
                    />

                    <v-select
                      v-model="xbox.editCfg.buttons[key].half"
                      class="param-half"
                      density="compact"
                      :disabled="!xbox.supported || xbox.busy || !isAnalogButton(key)"
                      hide-details
                      item-title="title"
                      item-value="value"
                      :items="XBOX_HALF_OPTIONS"
                      variant="outlined"
                      @update:model-value="xbox.markDirty()"
                    />

                    <v-number-input
                      v-model="xbox.editCfg.buttons[key].threshold"
                      class="param-thr"
                      control-variant="stacked"
                      density="compact"
                      :disabled="!xbox.supported || xbox.busy || !isAnalogButton(key)"
                      hide-details
                      label="阈值 %"
                      :max="100"
                      :min="1"
                      :step="5"
                      variant="outlined"
                      @update:model-value="xbox.markDirty()"
                    />
                  </span>
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card-text>
      </v-card>
    </template>

    <!-- 底栏按钮：与通道页/传感器页同一约定（Teleport 后禁用态由全局 buttons.css 管） -->
    <Teleport to="#global-footer-left">
      <v-btn
        v-if="serial.connected"
        color="primary"
        :disabled="xbox.busy || !xbox.supported"
        prepend-icon="mdi-backup-restore"
        size="small"
        variant="tonal"
        @click="onRestore"
      >
        恢复默认
      </v-btn>
    </Teleport>

    <Teleport to="#global-footer-right">
      <v-btn
        v-if="serial.connected"
        class="btn-secondary"
        :disabled="!xbox.supported"
        :loading="xbox.busy"
        prepend-icon="mdi-refresh"
        size="small"
        @click="onReload"
      >
        <span class="btn-text">重新读取</span>
      </v-btn>

      <v-btn
        v-if="serial.connected"
        class="btn-primary ml-2"
        :disabled="!xbox.dirty || !xbox.supported"
        :loading="xbox.busy"
        prepend-icon="mdi-content-save"
        size="small"
        @click="onSave"
      >
        <span class="btn-text">保存到设备</span>
      </v-btn>
    </Teleport>

    <v-snackbar v-model="msgVisible" :color="msgColor" :timeout="noticeTimeout" variant="tonal">
      {{ msgText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
  import { onMounted, onUnmounted, ref } from 'vue'
  import StickCross from '@/components/xbox/StickCross.vue'
  import { useNotice } from '@/composables/useNotice'
  import { useSerialStore } from '@/stores/serial'
  import { useXboxStore } from '@/stores/xbox'
  import {
    isXboxDigitalSource,
    isXboxImuSource,
    XBOX_AXIS_KEYS,
    XBOX_AXIS_LABELS,
    XBOX_AXIS_SOURCE_OPTIONS,
    XBOX_BUTTON_GROUPS,
    XBOX_BUTTON_LABELS,
    XBOX_BUTTON_SOURCE_OPTIONS,
    XBOX_HALF_OPTIONS,
    XBOX_SOURCE,
    type XboxAxisKey,
    type XboxButtonKey,
    xboxSourceShort,
  } from '@/utils/commands'

  const serial = useSerialStore()
  const xbox = useXboxStore()

  const {
    text: msgText, color: msgColor, visible: msgVisible, show: notify, timeoutMs: noticeTimeout,
  } = useNotice(2500)

  /** 默认展开「面部键」组 */
  const openGroups = ref<number[]>([0])

  const imuSources = new Set<number>([
    XBOX_SOURCE.IMU_ROLL, XBOX_SOURCE.IMU_PITCH, XBOX_SOURCE.IMU_YAW,
  ])

  function isImu (key: XboxAxisKey): boolean {
    return imuSources.has(xbox.editCfg.axes[key].source)
  }

  /** 十字图角标：仅 IMU 源显示角度量程 */
  function imuRange (key: XboxAxisKey): number | undefined {
    return isImu(key) ? xbox.editCfg.axes[key].half_range_deg : undefined
  }

  /** 按钮是否接模拟源（决定半周/阈值控件是否可用） */
  function isAnalogButton (key: XboxButtonKey): boolean {
    const s = xbox.editCfg.buttons[key].source
    return s !== XBOX_SOURCE.NONE && !isXboxDigitalSource(s) && !isXboxImuSource(s)
  }

  function onAxisChanged (key: XboxAxisKey): void {
    xbox.onSourceChanged(key)
  }

  function onButtonChanged (key: XboxButtonKey): void {
    xbox.onButtonSourceChanged(key)
  }

  async function onReload (): Promise<void> {
    if (xbox.dirty && !window.confirm('当前有未保存的修改，重新读取会丢弃，确定继续？')) return
    const ok = await xbox.fetch()
    notify(ok ? '已读取设备配置' : (xbox.error || '读取失败'), ok ? 'success' : 'error')
  }

  async function onSave (): Promise<void> {
    const ok = await xbox.save()
    notify(ok ? '已保存到设备（立即生效，重启后保留）' : (xbox.error || '保存失败'), ok ? 'success' : 'error')
  }

  function onRestore (): void {
    xbox.restoreDefaults()
    notify('已填入出厂默认，点「保存到设备」下发', 'info')
  }

  /** 全局「从设备加载」广播（App.vue 顶栏按钮） */
  async function onGlobalReload (): Promise<void> {
    if (!serial.connected) return
    await xbox.fetch()
  }

  onMounted(() => {
    window.addEventListener('app:reload-from-device', onGlobalReload)
    if (serial.connected) void xbox.fetch()
  })

  onUnmounted(() => {
    window.removeEventListener('app:reload-from-device', onGlobalReload)
  })
</script>

<style scoped>
.xbox-page {
  padding: 0 16px 96px;
}

.xbox-page > .v-toolbar {
  margin: 0 -16px;
}

.page-title {
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 12px;
}

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

/* 卡片内提示条 */
.cal-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.05);
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* 参数行：与 config.vue 的 .param-group + system.vue 的 .idle-row 同一风格 */
.param-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.param-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.param-select {
  min-width: 190px;
  max-width: 260px;
}

.param-half {
  min-width: 130px;
  max-width: 150px;
}

.param-thr {
  width: 116px;
}

.param-val {
  width: 116px;
}

.telem-switch {
  flex: 0 0 auto;
  margin: 0;
}

.axis-row {
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.axis-row + .axis-row {
  margin-top: 8px;
}

.btn-name {
  min-width: 108px;
}

/* 两个十字图并排，窄屏堆叠 */
.cross-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

/* 底栏按钮可用态（禁用态由全局 buttons.css 统一处理） */
.btn-primary {
  background-color: rgb(var(--v-theme-primary)) !important;
  color: #1a1a1a !important;
}

.btn-secondary {
  background-color: rgb(var(--v-theme-surface-variant)) !important;
  color: rgb(var(--v-theme-on-surface-variant)) !important;
}

@media (max-width: 860px) {
  .cross-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .param-group.axis-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .param-controls {
    flex-wrap: wrap;
    width: 100%;
  }

  .param-select {
    min-width: 100%;
  }
}
</style>
