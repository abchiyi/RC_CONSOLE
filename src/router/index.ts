/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import { useSerialStore } from '@/stores/serial'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/config' },
    ...routes,
  ],
})

/**
 * 连接门禁：未连接只允许停在 /disconnected，已连接不允许停在 /disconnected。
 *
 * 业务页的数据全部来自设备，未连接时进去只会看到空壳并触发一串注定失败的请求；
 * 这里在路由层统一拦掉（含手改地址栏 hash 的情形），页面卸载由路由切换天然完成 ——
 * 旧页面的 onUnmounted 会停掉轮询 / 撤掉流请求。
 *
 * 断开瞬间的主动跳转在 App.vue（watch connected），两者互为兜底。
 */
router.beforeEach(to => {
  const serial = useSerialStore()
  if (!serial.connected && to.path !== '/disconnected') {
    return { path: '/disconnected' }
  }
  if (serial.connected && to.path === '/disconnected') {
    return { path: '/' }
  }
  return true
})

// Workaround for https://github.com/vitejs/vite/issues/11804
router.onError((err, to) => {
  if (err?.message?.includes?.('Failed to fetch dynamically imported module')) {
    if (localStorage.getItem('vuetify:dynamic-reload')) {
      console.error('Dynamic import error, reloading page did not fix it', err)
    } else {
      console.log('Reloading page to fix dynamic import error')
      localStorage.setItem('vuetify:dynamic-reload', 'true')
      location.assign(to.fullPath)
    }
  } else {
    console.error(err)
  }
})

router.isReady().then(() => {
  localStorage.removeItem('vuetify:dynamic-reload')
})

export default router
