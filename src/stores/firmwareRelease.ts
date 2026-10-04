import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useConfigStore } from '@/stores/config'
import { compareFwVersion, fetchLatestRelease, type FirmwareRelease } from '@/utils/firmwareVersion'

/**
 * 固件发布版本状态
 *
 * 只有 status === 'ok' (确实拿到在线清单) 时 outdated / upToDate 才有意义,
 * 其余状态一律 false —— 没网就是没结论, 不编造答案。
 *
 * 不接入 stores/resetAll: 清单与"当前连的是哪台设备"无关, 断开后保留反而省一次请求。
 */
export const useFirmwareReleaseStore = defineStore('firmwareRelease', () => {
  const config = useConfigStore()

  const latest = ref<FirmwareRelease | null>(null)
  /** idle=未检查 / checking=检查中 / ok=已拿到 / error=拿不到 */
  const status = ref<'idle' | 'checking' | 'ok' | 'error'>('idle')

  const currentVersion = computed(() => config.deviceInfo?.fw_version ?? null)

  const outdated = computed(() => {
    if (!latest.value || !currentVersion.value) return false
    const cmp = compareFwVersion(currentVersion.value, latest.value.fw_version)
    return cmp !== null && cmp < 0
  })

  const upToDate = computed(() => {
    if (!latest.value || !currentVersion.value) return false
    const cmp = compareFwVersion(currentVersion.value, latest.value.fw_version)
    return cmp !== null && cmp >= 0
  })

  /** 返回是否成功拿到清单; 失败由调用方决定是否提示 (自动检查静默, 手动点击才提示) */
  async function check(): Promise<boolean> {
    if (status.value === 'checking') return false
    status.value = 'checking'
    const r = await fetchLatestRelease()
    latest.value = r
    status.value = r ? 'ok' : 'error'
    return !!r
  }

  return { latest, status, currentVersion, outdated, upToDate, check }
})
