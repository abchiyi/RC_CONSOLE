/**
 * crsfTelemetry.ts — CRSF 遥测帧解析（上位机侧）
 *
 * 遥测链路的定位：固件**不做翻译**，把飞控下行的 CRSF 遥测帧原样经流式通道搬上来
 * （`STREAM_CT_CRSF_TELEM`），解析全部在本模块完成 —— 新增/修正一种遥测的量纲，
 * 改这里即可，不用重新烧固件。
 *
 * 实现依据 CRSF 协议的公开帧结构自行编写，未复制任何第三方仓库源码：
 *   帧格式  [sync][len][type][payload…][crc8]
 *     · sync : 0xC8 飞控 / 0xEA 接收机 / 0xEE 发射机 / 0xEC 同步字节
 *     · len  : 从 type 起算的字节数（= payload 长度 + 2），故整帧长度 = len + 2
 *     · crc8 : 多项式 0xD5（初值 0），覆盖 [type … payload 末尾]，即 frame[2 .. len+1]
 *
 * ⚠ 量纲说明（CRSF 未对下列系数作强制规定，各家飞控存在两种解释）：
 *   本文件把它们集中放在 `SCALE` 常量里，若与飞控/电台自带显示对不上，
 *   优先核对这里的系数，而不是怀疑链路。
 *
 * 注：与 `crsf.ts`（通道 raw ↔ μs 换算）是两件事，故分文件存放。
 */

/** CRSF 遥测帧类型（只收录遥测相关，其余按十六进制显示） */
export const CRSF_TYPE = {
  GPS: 0x02,
  VARIO: 0x07,
  BATTERY: 0x08,
  BARO_ALT: 0x09,
  AIRSPEED: 0x0A,
  LINK_STATS: 0x14,
  ATTITUDE: 0x1E,
  FLIGHT_MODE: 0x21,
} as const

/** 常见 sync 字节（仅用于展示，解析时不校验：飞控/接收机都可能作为源地址） */
export const CRSF_SYNC = {
  RADIO: 0xC8,
  RX: 0xEA,
  TX: 0xEE,
  SYNC_BYTE: 0xEC,
} as const

export const CRSF_TYPE_NAMES: Record<number, string> = {
  [CRSF_TYPE.GPS]: 'GPS',
  [CRSF_TYPE.VARIO]: 'VARIO',
  [CRSF_TYPE.BATTERY]: 'BATTERY',
  [CRSF_TYPE.BARO_ALT]: 'BARO_ALT',
  [CRSF_TYPE.AIRSPEED]: 'AIRSPEED',
  [CRSF_TYPE.LINK_STATS]: 'LINK_STATS',
  [CRSF_TYPE.ATTITUDE]: 'ATTITUDE',
  [CRSF_TYPE.FLIGHT_MODE]: 'FLIGHT_MODE',
}

/** 量纲系数集中处：与飞控显示不符时先调这里 */
const SCALE = {
  /** VARIO: int16 → m/s（CRSF 主流实现为 cm/s，少数为 0.1 m/s） */
  VARIO_CM_PER_LSB: 1, // 1 LSB = 1 cm/s
  /** BATTERY: uint16 → V（主流为 0.1 V/LSB） */
  BATTERY_V_PER_LSB: 0.1,
  /** BATTERY: uint16 → A（主流为 0.1 A/LSB，带符号） */
  BATTERY_A_PER_LSB: 0.1,
  /** AIRSPEED: uint16 → km/h（主流为 0.1 km/h/LSB） */
  AIRSPEED_KMH_PER_LSB: 0.1,
  /**
   * BARO_ALT: uint16 → m。单位 dm，偏置值各家不一致（1000 / 10000 dm 都见过），
   *   若气压高与飞控显示相差一个固定 900 m，改 BARO_OFFSET_DM 即可（此处待实测校准）。
   */
  BARO_DM_PER_LSB: 1,
  BARO_OFFSET_DM: 1000,
  /** GPS 高度: uint16 → m（主流为 m/LSB，带 1000 m 偏置） */
  GPS_ALT_OFFSET_M: 1000,
  /** ATTITUDE: int16 → rad（1e-4 rad/LSB） */
  ATTITUDE_RAD_PER_LSB: 1e-4,
} as const

const RAD2DEG = 180 / Math.PI

/** CRC8 (poly 0xD5) 查表：程序化生成，避免硬编码 256 字节常量 */
function buildCrc8Table (poly: number): Uint8Array {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ poly) & 0xFF : (crc << 1) & 0xFF
    }
    table[i] = crc
  }
  return table
}

const CRC8_TABLE = buildCrc8Table(0xD5)

export function crsfCrc8 (bytes: Uint8Array, start: number, length: number): number {
  let crc = 0
  const end = Math.min(bytes.length, start + length)
  for (let i = start; i < end; i++) {
    crc = CRC8_TABLE[crc ^ (bytes[i] ?? 0)] ?? 0
  }
  return crc
}

/** 大端读取（CRSF 全部数值字段为大端） */
function be16 (b: Uint8Array, off: number): number {
  if (off + 2 > b.length) return 0
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(off, false)
}

/** 有符号单字节：CRSF 的 RSSI / SNR 都是 int8（负值 dBm / dB），不能按 uint8 读 */
function i8 (b: Uint8Array, off: number): number {
  if (off >= b.length) return 0
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getInt8(off)
}

/** 有符号大端 16/32 */
function i16be (b: Uint8Array, off: number): number {
  if (off + 2 > b.length) return 0
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getInt16(off, false)
}

function i32be (b: Uint8Array, off: number): number {
  if (off + 4 > b.length) return 0
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(off, false)
}

export function toHex (b: Uint8Array, limit = 24): string {
  let s = ''
  const n = Math.min(b.length, limit)
  for (let i = 0; i < n; i++) {
    s += (b[i] ?? 0).toString(16).padStart(2, '0').toUpperCase()
    if (i < n - 1) s += ' '
  }
  return b.length > limit ? `${s} …` : s
}

/** 帧类型名（未知类型回落为十六进制，便于发现新遥测） */
export function crsfTypeName (type: number): string {
  return CRSF_TYPE_NAMES[type] ?? `0x${type.toString(16).padStart(2, '0').toUpperCase()}`
}

// ── 解析结果类型 ──

export interface CrsfGps {
  lat: number
  lon: number
  groundSpeedKmh: number
  headingDeg: number
  altM: number
  satellites: number
}

export interface CrsfBattery {
  voltageV: number
  currentA: number
  capacityMah: number
  remainingPct: number
}

export interface CrsfAttitude {
  pitchDeg: number
  rollDeg: number
  yawDeg: number
}

export interface CrsfLinkStats {
  /** 上行 RSSI (dBm)。帧内已是补码负值，**直接按 int8 读，不要再取负** */
  uplinkRssiDbm: number
  /** 第二条天线的上行 RSSI (dBm)。仅双天线接收机有意义 */
  uplinkRssi2Dbm: number
  /** 上行链路质量 (%) */
  uplinkLq: number
  /** 上行 SNR (dB)，int8 */
  uplinkSnrDb: number
  /** 活跃天线编号 */
  activeAntenna: number
  /** RF 模式索引（非 Hz，是速率档位） */
  rfMode: number
  /** 上行发射功率**档位索引**（不是 dBm） */
  uplinkTxPower: number
  /** 下行 RSSI (dBm)，int8 负值 */
  downlinkRssiDbm: number
  /** 下行链路质量 (%) */
  downlinkLq: number
  /** 下行 SNR (dB)，int8 */
  downlinkSnrDb: number
}

/** LINK_STATS 线上负载长度：p[0..9] */
export const CRSF_LINK_STATS_PAYLOAD_LEN = 10

export interface CrsfFrame {
  /** 整帧字节（sync … crc），原样保留以便排查 */
  raw: Uint8Array
  sync: number
  type: number
  name: string
  /** payload：不含 sync / len / type / crc */
  payload: Uint8Array
  crcOk: boolean
  size: number
}

/** 解析一帧完整 CRSF 帧。帧长不自洽时返回 null。 */
export function parseCrsfFrame (bytes: Uint8Array): CrsfFrame | null {
  if (bytes.length < 4) return null
  const sync = bytes[0] ?? 0
  const len = bytes[1] ?? 0
  const total = len + 2
  if (total > bytes.length) return null // 帧不完整（分片/残缺）
  const frame = bytes.subarray(0, total)
  const type = bytes[2] ?? 0
  const crcReceived = frame[total - 1] ?? 0
  // CRC 覆盖 [type .. payload 末尾] = frame[2 .. len+1]
  const crcOk = crsfCrc8(frame, 2, len - 1) === crcReceived
  return {
    raw: frame,
    sync,
    type,
    name: crsfTypeName(type),
    payload: frame.subarray(3, total - 1),
    crcOk,
    size: total,
  }
}

// ── 各遥测帧解码 ──

export function decodeGps (p: Uint8Array): CrsfGps {
  return {
    lat: i32be(p, 0) / 1e7,
    lon: i32be(p, 4) / 1e7,
    groundSpeedKmh: be16(p, 8) / 10,
    headingDeg: be16(p, 10) / 100,
    altM: be16(p, 12) - SCALE.GPS_ALT_OFFSET_M,
    satellites: p[14] ?? 0,
  }
}

export function decodeBattery (p: Uint8Array): CrsfBattery {
  return {
    voltageV: be16(p, 0) * SCALE.BATTERY_V_PER_LSB,
    currentA: i16be(p, 2) * SCALE.BATTERY_A_PER_LSB,
    // 后 3 字节为 24bit 无符号 mAh（大端）
    capacityMah: ((p[4] ?? 0) << 16) | ((p[5] ?? 0) << 8) | (p[6] ?? 0),
    remainingPct: p[7] ?? 0,
  }
}

export function decodeAttitude (p: Uint8Array): CrsfAttitude {
  return {
    pitchDeg: i16be(p, 0) * SCALE.ATTITUDE_RAD_PER_LSB * RAD2DEG,
    rollDeg: i16be(p, 2) * SCALE.ATTITUDE_RAD_PER_LSB * RAD2DEG,
    yawDeg: i16be(p, 4) * SCALE.ATTITUDE_RAD_PER_LSB * RAD2DEG,
  }
}

/**
 * LINK_STATS (0x14) 解码 —— 线上布局与手柄固件 `elrs_v3.cpp` 的
 * `handleLinkStatisticsFrame()` 逐字节一致（同一帧、同一约定，两端必须同口径）：
 *
 *   p[0] 上行 RSSI1  int8 (dBm，补码负值)   p[1] 上行 RSSI2 int8
 *   p[2] 上行 LQ     uint8 (%)             p[3] 上行 SNR   int8 (dB)
 *   p[4] 活跃天线   uint8                  p[5] RF 模式   uint8（档位索引）
 *   p[6] 上行发射功率 uint8（**档位索引**，不是 dBm）
 *   p[7] 下行 RSSI   int8 (dBm)            p[8] 下行 LQ    uint8 (%)
 *   p[9] 下行 SNR    int8 (dB)
 *
 * ⚠ 两个曾踩过的坑，改动时别退回去：
 *   1. RSSI 是 **int8 负值**（ELRS TX 侧已做取负还原）—— 按 uint8 读会得到
 *      195 这类的数，再取负就是 -195 dBm；
 *   2. SNR 是 **int8**，不是 int16 —— 按 i16be 读会把下一个字段一起吞进来
 *      （上行 SNR 会读出 332.8 dB，同时后面所有字段整体错位一格）。
 */
export function decodeLinkStats (p: Uint8Array): CrsfLinkStats {
  return {
    uplinkRssiDbm: i8(p, 0),
    uplinkRssi2Dbm: i8(p, 1),
    uplinkLq: p[2] ?? 0,
    uplinkSnrDb: i8(p, 3),
    activeAntenna: p[4] ?? 0,
    rfMode: p[5] ?? 0,
    uplinkTxPower: p[6] ?? 0,
    downlinkRssiDbm: i8(p, 7),
    downlinkLq: p[8] ?? 0,
    downlinkSnrDb: i8(p, 9),
  }
}

/** VARIO：返回 m/s（正 = 爬升） */
export function decodeVario (p: Uint8Array): number {
  return i16be(p, 0) * SCALE.VARIO_CM_PER_LSB / 100
}

/** BARO_ALT：返回 m */
export function decodeBaroAlt (p: Uint8Array): number {
  return (be16(p, 0) - SCALE.BARO_OFFSET_DM) * SCALE.BARO_DM_PER_LSB / 10
}

/** AIRSPEED：返回 km/h */
export function decodeAirspeed (p: Uint8Array): number {
  return be16(p, 0) * SCALE.AIRSPEED_KMH_PER_LSB
}

export function decodeFlightMode (p: Uint8Array): string {
  // 以 '\0' 结尾的字符串；无终止符时取到负载末尾
  let end = p.length
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) {
      end = i
      break
    }
  }
  return new TextDecoder().decode(p.subarray(0, end)).trim()
}

/**
 * 解码一包流式推送负载：
 *   payload = u8 count + count × (u8 frame_size + frame[frame_size])
 * 返回解析出的帧（含 CRC 校验结果）与统计。
 */
export function decodeCrsfStream (payload: Uint8Array): { frames: CrsfFrame[], badFrames: number } {
  const frames: CrsfFrame[] = []
  let badFrames = 0
  if (payload.length < 1) return { frames, badFrames }
  let off = 0
  const count = payload[off++] ?? 0
  for (let i = 0; i < count; i++) {
    if (off + 1 > payload.length) break
    const size = payload[off++] ?? 0
    if (size < 4 || off + size > payload.length) {
      badFrames++
      break
    }
    const raw = payload.subarray(off, off + size)
    off += size
    const frame = parseCrsfFrame(raw)
    if (!frame) {
      badFrames++
      continue
    }
    frames.push(frame)
  }
  return { frames, badFrames }
}
