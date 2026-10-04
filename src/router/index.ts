/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import { useCalibrationStore } from '@/stores/calibration'
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
 *
 * 校准门禁（同一套模式）：校准不齐时固件会把外部 ELRS 模块的 EN 拉低，射频完全停发，
 * 此时进任何业务页都没意义。未完成时只允许停在 /setup，手改地址栏 hash 也会被弹回。
 * 注意 rfLocked === null（尚未问到 / 旧固件无此命令）不拦 —— 不能凭未知状态锁死整站。
 */
router.beforeEach(to => {
  const serial = useSerialStore()
  const cal = useCalibrationStore()
  if (!serial.connected && to.path !== '/disconnected') {
    return { path: '/disconnected' }
  }
  if (serial.connected && to.path === '/disconnected') {
    return { path: '/' }
  }
  if (serial.connected && cal.rfLocked === true && to.path !== '/setup') {
    return { path: '/setup' }
  }
  if (serial.connected && cal.rfLocked !== true && to.path === '/setup') {
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
