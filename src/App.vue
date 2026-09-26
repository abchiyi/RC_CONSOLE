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
      <div class="content-wrap">
        <router-view />
      </div>
    </v-main>

    <!-- 全局底栏: 左状态右操作双槽, 容器常驻 DOM (Teleport 目标), 未连接时隐藏 -->
    <v-app-bar v-show="serial.connected" location="bottom" color="surface" density="comfortable" elevation="0"
      class="px-3 global-footer">
      <!-- 左槽: 仅承载各页 Teleport 进来的按钮 (如传感器页的「校准」); 常驻按钮已迁至对应页面 -->
      <div id="global-footer-left" class="global-footer-slot"></div>

      <v-spacer />

      <!-- 全局默认操作: 从设备加载 (始终最右侧, 点击广播事件, 当前页面监听执行自己的加载逻辑) -->
      <div id="global-footer-right" class="global-footer-slot">
        <v-btn class="footer-btn-secondary footer-reload-btn" prepend-icon="mdi-download" size="small"
          :loading="reloading" @click="triggerReload">
          <span class="btn-text">从设备加载</span>
        </v-btn>
      </div>
    </v-app-bar>

    <!-- 模块固件烧录对话框: 挂在全局, 烧录过程中切换页面也不会中断 -->
    <ElrsFlashDialog v-model="moduleFwDialog" />
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import AppBar from '@/components/AppBar.vue'
import ElrsFlashDialog from '@/components/elrs/ElrsFlashDialog.vue'
import { useSerialStore } from '@/stores/serial'

const drawer = ref(true)
const serial = useSerialStore()
/** 模块固件烧录对话框开关 (入口: ELRS 页「模块固件升级」卡片; 对话框挂全局 → 烧录中切页不中断) */
const moduleFwDialog = ref(false)

/** ELRS 页「模块固件升级」卡片 → 打开全局烧录对话框 (广播事件, 与「从设备加载」同一套约定) */
function onFlashElrs() {
  moduleFwDialog.value = true
}

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
  window.addEventListener('app:flash-elrs', onFlashElrs)
})

onUnmounted(() => {
  window.removeEventListener('app:reload-done', onReloadDone)
  window.removeEventListener('app:flash-elrs', onFlashElrs)
})
</script>

<style scoped>
/* 正文内容限宽居中 */
.content-wrap {
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

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

/* 「从设备加载」始终排在右侧槽最末尾 (Teleport 注入内容在前) */
.footer-reload-btn {
  order: 9999;
}

/* 窄屏隐藏按钮文字只留图标 */
@media (max-width: 600px) {
  .global-footer .btn-text {
    display: none;
  }
}
</style>
