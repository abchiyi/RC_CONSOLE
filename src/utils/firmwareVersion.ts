/**
 * 固件版本解析 / 比较 / 在线发布清单获取
 *
 * 设计要点:
 *  1) 不内置任何"最新版本"常量 —— 唯一来源是 RC_CONSOLE 的 public/latest-fw.json
 *     (由固件仓库打 tag 时的 Action 推送)。内置常量从写下那一刻起就会失效。
 *  2) 拿不到在线清单 (离线 / 超时 / 格式错) 一律返回 null, 由 UI 决定"不提示": 不猜、不误报。
 *  3) 兼容固件 CMake 归一化产物: 3.1 / 2.2.2 / 2.0.1-2 / 2.0.1-2-dirty / 2.0.1-2-g3f9a21c
 */

/**
 * 发布清单直链。
 *
 * 注意: Electron 生产版是 loadFile() → file:// 页面, 相对路径取不到, 必须用绝对 URL。
 *       raw.githubusercontent.com 返回 Access-Control-Allow-Origin: *, file:// 也能取到。
 *       若实测被拦, 兜底是照 file:openText 的模式加一个 fw:checkUpdate IPC 走主进程请求。
 */
export const LATEST_FW_URL =
  'https://raw.githubusercontent.com/abchiyi/RC_CONSOLE/master/public/latest-fw.json'

export interface FirmwareRelease {
  fw_version: string
  commit?: string
  released_at?: string
  notes?: string
}

export interface ParsedFwVersion {
  major: number
  minor: number
  patch: number
  /** tag 之后的提交数 (2.0.1-2 的 2) */
  commits: number
  dirty: boolean
}

const FW_VERSION_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(\d+))?(?:-g[0-9a-f]{4,40})?(?:-dirty)?$/i

/** 解析失败 (unknown / 裸短哈希 / 空值) 返回 null —— 调用方据此放弃比较 */
export function parseFwVersion(raw?: string | null): ParsedFwVersion | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  const m = FW_VERSION_RE.exec(s)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: m[2] ? Number(m[2]) : 0,
    patch: m[3] ? Number(m[3]) : 0,
    commits: m[4] ? Number(m[4]) : 0,
    dirty: /-dirty$/i.test(s),
  }
}

/** >0: a 更新; <0: a 更旧; 0: 同级; null: 任一无法解析 */
export function compareFwVersion(a?: string | null, b?: string | null): number | null {
  const pa = parseFwVersion(a)
  const pb = parseFwVersion(b)
  if (!pa || !pb) return null
  // 逐项比较: 版本三段 → tag 后提交数 → dirty(本地改动视为比同 tag 的纯净构建略新)
  const pairs: Array<[number, number]> = [
    [pa.major, pb.major],
    [pa.minor, pb.minor],
    [pa.patch, pb.patch],
    [pa.commits, pb.commits],
    [pa.dirty ? 1 : 0, pb.dirty ? 1 : 0],
  ]
  for (const [x, y] of pairs) {
    if (x !== y) return x - y
  }
  return 0
}

/** 拉取发布清单: 超时 / 离线 / 非 2xx / 字段缺失, 一律返回 null (静默) */
export async function fetchLatestRelease(timeoutMs = 4000): Promise<FirmwareRelease | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(LATEST_FW_URL, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<FirmwareRelease>
    return typeof data.fw_version === 'string' && data.fw_version ? (data as FirmwareRelease) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
