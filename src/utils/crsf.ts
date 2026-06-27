/**
 * CRSF 原始值 ↔ μs 脉冲宽度 双向转换
 *
 * 固件使用 ELRS CRSF 协议范围 186-1796，Web UI 使用标准舵机脉冲 1000-2000μs
 */
export const RAW_MIN = 186
export const RAW_CENTER = 991
export const RAW_MAX = 1796

export const US_MIN = 1000
export const US_CENTER = 1500
export const US_MAX = 2000

/** CRSF raw → μs */
export function rawToUs(raw: number): number {
  return Math.round(US_MIN + (raw - RAW_MIN) * (US_MAX - US_MIN) / (RAW_MAX - RAW_MIN))
}

/** μs → CRSF raw */
export function usToRaw(us: number): number {
  return Math.round(RAW_MIN + (us - US_MIN) * (RAW_MAX - RAW_MIN) / (US_MAX - US_MIN))
}

/** μs → -100% ~ +100% (居中映射) */
export function usToPercent(us: number): number {
  if (us >= US_CENTER) {
    return ((us - US_CENTER) / (US_MAX - US_CENTER)) * 100
  }
  return ((us - US_CENTER) / (US_CENTER - US_MIN)) * 100
}
