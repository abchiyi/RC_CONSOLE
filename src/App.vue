<template>
  <v-app>
    <AppBar @toggle-drawer="drawer = !drawer" />

    <!-- 侧边导航 -->
    <v-navigation-drawer v-model="drawer" width="240">
      <v-list density="compact" nav>
        <v-list-item title="通道配置" prepend-icon="mdi-cog" to="/config" />
        <v-list-item title="传感器" prepend-icon="mdi-chip" to="/calibration" />
        <v-list-item title="ELRS" prepend-icon="mdi-antenna" to="/elrs" />
        <v-list-item title="系统" prepend-icon="mdi-monitor-dashboard" to="/system" />
      </v-list>

      <template #append>
        <div class="pa-4">
          <v-divider class="mb-2" />
          <div class="text-caption text-medium-emphasis">
            ESP_GamePad2RC · v0.1.0
          </div>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- 主内容区 -->
    <v-main>
      <router-view />
    </v-main>

    <!-- 全局底栏: 左状态右操作双槽, 容器常驻 DOM (Teleport 目标), 未连接时隐藏 -->
    <v-app-bar v-show="serial.connected" location="bottom" color="surface" density="comfortable" elevation="0"
      class="px-3 global-footer">
      <div id="global-footer-left" class="global-footer-slot" />

      <v-spacer />

      <!-- 全局默认操作: 从设备加载 (始终最右侧, 点击广播事件, 当前页面监听执行自己的加载逻辑) -->
      <div id="global-footer-right" class="global-footer-slot">
        <v-btn class="footer-btn-secondary" prepend-icon="mdi-download" size="small"
          :loading="reloading" @click="triggerReload">
          <span class="btn-text">从设备加载</span>
        </v-btn>
      </div>
    </v-app-bar>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import AppBar from '@/components/AppBar.vue'
import { useSerialStore } from '@/stores/serial'

const drawer = ref(true)
const serial = useSerialStore()

// ---- 全局「从设备加载」: 点击广播事件, 当前页面监听并执行自己的加载逻辑, 完成后回报 ----
const reloading = ref(false)
let reloadTimer: ReturnType<typeof setTimeout> | null = null

function triggerReload() {
  reloading.value = true
  if (reloadTimer) clearTimeout(reloadTimer)
  // 30s 保险超时: 任何页面 handler 异常也不会让按钮永久转圈
  reloadTimer = setTimeout(() => { reloading.value = false }, 30000)
  window.dispatchEvent(new CustomEvent('app:reload-from-device'))
}

function onReloadDone() {
  reloading.value = false
}

onMounted(() => {
  window.addEventListener('app:reload-done', onReloadDone)
})

onUnmounted(() => {
  window.removeEventListener('app:reload-done', onReloadDone)
})
</script>

<style scoped>
/* 全局底栏: 深色扁平, 顶部细线分隔 */
.global-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(18, 18, 18, 0.95) !important;
}

.global-footer :deep(.v-toolbar__content) {
  width: 100%;
}

/* 左/右投递槽: flex 布局 */
.global-footer-slot {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 投递进来的按钮统一胶囊圆角 */
.global-footer :deep(.v-btn) {
  border-radius: 999px;
  text-transform: none;
  letter-spacing: 0;
}

/* 全局默认「从设备加载」按钮: 深色底白字 */
.global-footer .footer-btn-secondary {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #fff !important;
}

/* 窄屏隐藏按钮文字只留图标 */
@media (max-width: 600px) {
  .global-footer .btn-text {
    display: none;
  }
}
</style>
@
