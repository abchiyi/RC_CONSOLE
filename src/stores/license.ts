/**
 * 许可证 Store（付费版特性门控）
 *
 *   设备侧三条命令（固件 S3）：license_challenge / license_activate / license_status
 *
 *   ★ 状态**如实上报**，不做任何欺瞒 —— 付费项是离散量（通道数 / 槽位数），
 *     没有"参数错"的落脚点，伪装成已激活只会让破解者一测就发现。
 *
 *   三种设备形态要分清，UI 文案各不相同：
 *     · 免费版固件：三条命令回 S_NOT_SUPPORTED → hasGate=false，无激活入口
 *     · 付费版未激活：hasGate=true 且 activeMask=0 → 受限运行 + 给购买入口
 *     · 付费版已激活：hasGate=true 且 activeMask≠0 → 完整功能
 *
 *   响应配对用 **seq 精确匹配**（同 FirmwareUpgradeDialog 的做法），不走 rr.wait
 *   的按名分槽：许可证交互是一次性的，无需与轮询共享槽位，也免去在 main.ts 的
 *   routeObject 里新增派发分支（改那里会影响所有后端）。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { serialService } from '@/services/SerialService'
import { b64UrlToBytes } from '@/utils/protocol'

/** 挑战串长度：salt(16) ‖ mac(6) ‖ chip_rev(1) */
export const CHALLENGE_LEN = 23
/** 许可证长度：feat_id(1) ‖ secret(32) ‖ sig(64) */
export const LICENSE_LEN = 97
/** 固件侧 S_NOT_SUPPORTED */
const STATUS_NOT_SUPPORTED = 8

/** 付费特性位（与固件 License feat_id 对齐）。
 *  2026-11-03 起固件收敛为单一许可证：一张许可证 = 全部付费功能，
 *  active_mask 只有 bit0 有意义；FEAT 保留只为 wire 兼容。 */
export const FEAT = {
  PRO_BASE: 0,
  CONFIG_SNAPSHOT: 1,
  ADVANCED_TUNING: 2,
} as const

export const useLicenseStore = defineStore('license', () => {
  /** null = 未查询；false = 免费版（无门控）；true = 付费版（有门控） */
  const hasGate = ref<boolean | null>(null)
  /** 已激活特性位图：bit n = FEAT n */
  const activeMask = ref(0)
  /** 最近一次取到的挑战串（base64url，供离线签发工具食用） */
  const challenge = ref('')
  /** 挑战串里的设备 MAC，用于核对「签的是不是这台机器」 */
  const mac = ref('')
  const chipRev = ref(0)
  const busy = ref(false)
  const error = ref<string | null>(null)

  /** 已激活（仅付费版可能为真） */
  const activated = computed(() => hasGate.value === true && activeMask.value !== 0)
  /** 付费版但尚未激活 → 受限运行 */
  const restricted = computed(() => hasGate.value === true && activeMask.value === 0)
  /** 免费版：物理不含付费能力 */
  const isFreeTier = computed(() => hasGate.value === false)
  /** PRO_BASE 是否已激活（当前唯一的付费特性） */
  const proActive = computed(() => (activeMask.value & (1 << FEAT.PRO_BASE)) !== 0)

  /**
   * 发一条命令并等它的响应（按 seq 匹配，避免与其它命令的响应串槽）。
   * @returns 解码后的响应对象；ok===false 时带 status / error
   */
  async function sendCommandAndWait (
    cmd: string,
    params?: Record<string, unknown>,
    timeoutMs = 8000,
  ): Promise<Record<string, unknown>> {
    const buffered: Record<string, unknown>[] = []
    let notify: (() => void) | null = null
    const handler = (obj: Record<string, unknown>) => {
      if (obj.cmd !== cmd) return
      buffered.push(obj)
      notify?.()
    }

    serialService.onObject(handler)
    try {
      const seq = await serialService.sendCommand(cmd, params)
      if (seq === undefined) throw new Error(`命令未发送: ${cmd}`)

      const deadline = Date.now() + timeoutMs
      for (;;) {
        const index = buffered.findIndex(obj => Number(obj.seq) === seq)
        if (index >= 0) {
          const matched = buffered[index]
          if (matched) {
            buffered.splice(index, 1)
            return matched
          }
        }

        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error(`等待设备响应超时: ${cmd}`)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            notify = null
            reject(new Error(`等待设备响应超时: ${cmd}`))
          }, remaining)
          notify = () => {
            clearTimeout(timer)
            notify = null
            resolve()
          }
        })
      }
    } finally {
      notify = null
      serialService.removeObjectListener(handler)
    }
  }

  /** 取响应里的状态码（成功时返回 null） */
  function statusOf (obj: Record<string, unknown>): number | null {
    if (obj.ok !== false) return null
    const s = Number(obj.status)
    return Number.isFinite(s) ? s : 0
  }

  function fail (obj: Record<string, unknown>, fallback: string): boolean {
    error.value = typeof obj.error === 'string' && obj.error ? obj.error : fallback
    return false
  }

  /** 查询许可证状态（免费版会得到 S_NOT_SUPPORTED → hasGate=false） */
  async function refresh (): Promise<boolean> {
    busy.value = true
    error.value = null
    try {
      const obj = await sendCommandAndWait('license_status')
      const st = statusOf(obj)
      if (st !== null) {
        // 免费版固件不认识这三条命令 —— 这是**预期结果**，不是错误
        if (st === STATUS_NOT_SUPPORTED) {
          hasGate.value = false
          activeMask.value = 0
          challenge.value = ''
          mac.value = ''
          return true
        }
        return fail(obj, '查询许可证状态失败')
      }
      hasGate.value = obj.has_gate === true
      activeMask.value = Number(obj.active_mask ?? 0)
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    } finally {
      busy.value = false
    }
  }

  /** 取挑战串（salt‖mac‖chip_rev），交给离线签发工具 */
  async function requestChallenge (): Promise<boolean> {
    busy.value = true
    error.value = null
    try {
      const obj = await sendCommandAndWait('license_challenge')
      const st = statusOf(obj)
      if (st !== null) {
        if (st === STATUS_NOT_SUPPORTED) {
          hasGate.value = false
          error.value = '当前是免费版固件，无许可证功能'
          return false
        }
        return fail(obj, '获取挑战串失败')
      }
      challenge.value = String(obj.challenge ?? '')
      mac.value = String(obj.mac ?? '')
      chipRev.value = Number(obj.chip_rev ?? 0)
      if (!challenge.value) {
        error.value = '设备未返回挑战串'
        return false
      }
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * 写入许可证（base64url 串）。
   *   ★ 先在前端校验格式：长度不对就没必要打扰设备，
   *     也让"粘贴不全"这类高频失误有准确提示，而不是笼统的「参数错误」。
   */
  async function activate (licenseText: string): Promise<boolean> {
    const bytes = b64UrlToBytes(licenseText)
    if (!bytes) {
      error.value = '许可证格式不对（应为 base64url 串）'
      return false
    }
    if (bytes.length !== LICENSE_LEN) {
      error.value = `许可证长度应为 ${LICENSE_LEN} 字节，实际 ${bytes.length} 字节`
      return false
    }

    busy.value = true
    error.value = null
    try {
      const obj = await sendCommandAndWait('license_activate', { data: bytes }, 15000)
      const st = statusOf(obj)
      if (st !== null) return fail(obj, '激活失败')
      // 激活成功后重新拉一次状态：让 UI 显示的位图来自设备而非本地推断
      await refresh()
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    } finally {
      busy.value = false
    }
  }

  /** 断开连接后清空，避免下次连上看到上一台设备的状态 */
  function reset (): void {
    hasGate.value = null
    activeMask.value = 0
    challenge.value = ''
    mac.value = ''
    chipRev.value = 0
    error.value = null
    busy.value = false
  }

  return {
    hasGate, activeMask, challenge, mac, chipRev, busy, error,
    activated, restricted, isFreeTier, proActive,
    refresh, requestChallenge, activate, reset,
  }
})
