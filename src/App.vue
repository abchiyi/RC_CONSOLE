<template>
  <v-app>
    <AppBar @toggle-drawer="drawer = !drawer" />

    <!-- 侧边导航 (未连接时无页面可去, 直接隐藏) -->
    <v-navigation-drawer v-if="serial.connected" v-model="drawer" width="240">
      <v-list density="compact" nav>
        <v-list-item prepend-icon="mdi-cog" title="通道配置" to="/config" />
        <v-list-item prepend-icon="mdi-chip" title="传感器" to="/calibration" />
        <v-list-item prepend-icon="mdi-antenna" title="ELRS" to="/elrs" />
        <v-list-item prepend-icon="mdi-access-point-network" title="遥测" to="/telemetry" />
        <v-list-item prepend-icon="mdi-monitor-dashboard" title="系统" to="/system" />
      </v-list>

      <template #append>
        <div class="pa-4">
          <v-divider class="mb-2" />

          <div class="text-caption text-medium-emphasis">
            {{ configStore.deviceInfo?.device ?? 'ESP_GamePad2RC' }} · {{ configStore.deviceInfo?.fw_version ?? '--' }}
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
    <v-app-bar
      v-show="serial.connected"
      color="surface"
      density="comfortable"
      class="px-3 global-footer"
      elevation="0"
      location="bottom"
    >
      <!-- 左槽: 仅承载各页 Teleport 进来的按钮 (如传感器页的「校准」); 常驻按钮已迁至对应页面 -->
      <div id="global-footer-left" class="global-footer-slot" />

      <v-spacer />

      <!-- 全局默认操作: 从设备加载 (始终最右侧, 点击广播事件, 当前页面监听执行自己的加载逻辑) -->
      <div id="global-footer-right" class="global-footer-slot">
        <v-btn
          class="footer-btn-secondary footer-reload-btn"
          :loading="reloading"
          prepend-icon="mdi-download"
          size="small"
          @click="triggerReload"
        >
          <span class="btn-text">从设备加载</span>
        </v-btn>
      </div>
    </v-app-bar>

    <!-- 模块固件烧录对话框: 挂在全局, 烧录过程中切换页面也不会中断 -->
    <ElrsFlashDialog v-model="moduleFwDialog" />
  </v-app>
</template>

<script setup lang="ts">
  import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import AppBar from '@/components/AppBar.vue'
  import ElrsFlashDialog from '@/components/elrs/ElrsFlashDialog.vue'
  import { useConfigStore } from '@/stores/config'
  import { resetAllStores } from '@/stores/resetAll'
  import { useSerialStore } from '@/stores/serial'

  const router = useRouter()
  const route = useRoute()
  const drawer = ref(true)
  const serial = useSerialStore()
  const configStore = useConfigStore()
  /** 模块固件烧录对话框开关 (入口: ELRS 页「模块固件升级」卡片; 对话框挂全局 → 烧录中切页不中断) */
  const moduleFwDialog = ref(false)
  /** 断开前停留的页面: 重连后原样回去 (/disconnected 本身不算) */
  let lastPath: string | null = null

  /** ELRS 页「模块固件升级」卡片 → 打开全局烧录对话框 (广播事件, 与「从设备加载」同一套约定) */
  function onFlashElrs () {
    moduleFwDialog.value = true
  }

  // ---- 全局「从设备加载」: 点击广播事件, 当前页面监听并执行自己的加载逻辑, 完成后回报 ----
  const reloading = ref(false)
  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  function triggerReload () {
    reloading.value = true
    if (reloadTimer) clearTimeout(reloadTimer)
    // 30s 保险超时: 任何页面 handler 异常也不会让按钮永久转圈
    reloadTimer = setTimeout(() => {
      reloading.value = false
    }, 30_000)
    window.dispatchEvent(new CustomEvent('app:reload-from-device'))
  }

  function onReloadDone () {
    reloading.value = false
  }

  /**
   * 连接状态 → 页面生命周期 / 数据生命周期
   *
   * 断开: 先跳 /disconnected —— 路由切换会卸载旧页面组件, 各页 onUnmounted 停轮询、
   *       撤流请求、清定时器; 再 nextTick 后清空全部 store, 于是下次连接是干净的。
   *       (顺序不能反: 先清数据会让仍挂载的页面 watch 到空值, 可能触发无意义重算。)
   * 连接: 不在未连接页就无事发生; 在未连接页则回到断开前的页面 (首次连接回 /config)。
   */
  watch(() => serial.connected, async (connected, prev) => {
    if (connected) {
      if (route.path === '/disconnected') await router.replace(lastPath ?? '/config')
      return
    }
    if (!prev) return // 启动即未连接: 没有需要收尾的页面
    if (route.path !== '/disconnected') lastPath = route.path
    moduleFwDialog.value = false // 全局烧录对话框一并收掉, 避免重连后仍挂在半途
    onReloadDone()
    await router.replace('/disconnected')
    await nextTick()
    resetAllStores()
  })

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
