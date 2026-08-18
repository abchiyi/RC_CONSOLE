/**
 * protocol.ts — 固件二进制协议帧层（对齐 ESP_GamePad2RC/lib/CommandCenter/protocol.h）
 *
 * 帧格式 (10B 头)：
 *   [0] SOF0=0xAA  [1] SOF1=0x55  [2] VER=0x01  [3] TYPE  [4] FLAGS
 *   [5..6] LEN(u16 LE)  [7] SEQ  [8..9] CRC16(u16 LE)
 *   [10..10+LEN) PAYLOAD
 * CRC16-CCITT 覆盖 [VER..payload 末尾]（不含 SOF 与 CRC 字段），初值 0xFFFF，多项式 0x1021。
 */

import { classifyLine } from './serialLineClassify'

export const SOF0 = 0xaa
export const SOF1 = 0x55
export const PROTO_VERSION = 0x01
export const HEADER_SIZE = 10
export const MAX_PAYLOAD = 16384

/** 帧类型 */
export const FRAME_REQUEST = 0
export const FRAME_RESPONSE = 1
export const FRAME_EVENT = 2
export const FRAME_FRAGMENT = 3
export const FRAME_ACK = 4

/** FLAGS 位定义 */
export const FLAG_FRAGMENTED = 0x01
export const FLAG_NEED_ACK = 0x02
export const FLAG_RESERVED = 0x04

/** 状态码（与固件 protocol.h 的 Status 枚举一致） */
export const STATUS_OK = 0
export const STATUS_UNKNOWN_CMD = 1
export const STATUS_BAD_PARAM = 2
export const STATUS_NVS_ERR = 3
export const STATUS_BUSY = 4
export const STATUS_CRC_ERR = 5
export const STATUS_SEQ_ERR = 6
export const STATUS_SIZE_ERR = 7
export const STATUS_NOT_SUPPORTED = 8
export const STATUS_INTERNAL = 9

/** 命令表（与固件 Cmd 枚举一致） */
export const CMD = {
  GET_INFO: 0x0001,
  PING: 0x0002,
  RESET: 0x0003,
  FACTORY_RESET_NVS: 0x0004,
  GET_CONFIG: 0x0101,
  SET_MODEL: 0x0102,
  GET_MODEL: 0x0103,
  SET_ACTIVE: 0x0104,
  SET_RUNTIME_MODEL: 0x0105,
  SAVE: 0x0106,
  LOAD: 0x0107,
  STREAM_START: 0x0108,
  STREAM_STOP: 0x0109,
  OTA_BEGIN: 0x0201,
  OTA_CHUNK: 0x0202,
  OTA_FINISH: 0x0203,
  OTA_ABORT: 0x0204,
  CAL_START: 0x0301,
  CAL_STATUS: 0x0302,
  CAL_GET: 0x0303,
  CAL_SET_DEADZONE: 0x0305,
  CAL_SET_LPF_ALPHA: 0x0306,
  CAL_ZERO_IMU: 0x0307,
  GET_POWER_CFG: 0x0401,
  SET_POWER_CFG: 0x0402,
  GET_POWER_STATE: 0x0403,
  SET_DEBUG_MODE: 0x0501,
  GET_DEBUG_MODE: 0x0502,
  GET_LINK_STATS: 0x0601,
  ELRS_LIST_FIELDS: 0x0701,
  ELRS_SET_PARAM: 0x0702,
  ELRS_WIFI_START: 0x0703,
  ELRS_WIFI_STOP: 0x0704,
  ELRS_RESCAN_FIELDS: 0x0705,
  ELRS_BIND_START: 0x0708,
  ELRS_BLE_START: 0x0709,
  ELRS_BLE_STOP: 0x070A,
} as const

/** 事件 ID */
export const EVENT_STREAM_DATA = 0x0001

/** STREAM content_type */
export const STREAM_CHANNELS = 0
export const STREAM_RAW_IMU = 1
export const STREAM_POWER = 2
export const STREAM_LINK = 3

/** 命令名 → 命令 id（旧 JSON 命令名兼容） */
export const CMD_NAME_TO_ID: Record<string, number> = {
  get_info: CMD.GET_INFO,
  ping: CMD.PING,
  reset: CMD.RESET,
  factory_reset_nvs: CMD.FACTORY_RESET_NVS,
  get_config: CMD.GET_CONFIG,
  set_model: CMD.SET_MODEL,
  get_model: CMD.GET_MODEL,
  set_active: CMD.SET_ACTIVE,
  set_runtime_model: CMD.SET_RUNTIME_MODEL,
  save: CMD.SAVE,
  load: CMD.LOAD,
  stream_start: CMD.STREAM_START,
  stream_stop: CMD.STREAM_STOP,
  ota_begin: CMD.OTA_BEGIN,
  ota_chunk: CMD.OTA_CHUNK,
  ota_finish: CMD.OTA_FINISH,
  ota_abort: CMD.OTA_ABORT,
  cal_start: CMD.CAL_START,
  cal_status: CMD.CAL_STATUS,
  cal_get: CMD.CAL_GET,
  cal_set_deadzone: CMD.CAL_SET_DEADZONE,
  cal_set_lpf_alpha: CMD.CAL_SET_LPF_ALPHA,
  cal_zero_imu: CMD.CAL_ZERO_IMU,
  get_power_cfg: CMD.GET_POWER_CFG,
  set_power_cfg: CMD.SET_POWER_CFG,
  get_power_state: CMD.GET_POWER_STATE,
  set_debug_mode: CMD.SET_DEBUG_MODE,
  get_debug_mode: CMD.GET_DEBUG_MODE,
  get_link_stats: CMD.GET_LINK_STATS,
  elrs_list_fields: CMD.ELRS_LIST_FIELDS,
  elrs_set_param: CMD.ELRS_SET_PARAM,
  elrs_wifi_start: CMD.ELRS_WIFI_START,
  elrs_wifi_stop: CMD.ELRS_WIFI_STOP,
  elrs_rescan_fields: CMD.ELRS_RESCAN_FIELDS,
  elrs_bind_start: CMD.ELRS_BIND_START,
  elrs_ble_start: CMD.ELRS_BLE_START,
  elrs_ble_stop: CMD.ELRS_BLE_STOP,
}

const CMD_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(CMD_NAME_TO_ID).map(([k, v]) => [v, k]),
)

export function cmdNameToId(cmd: string): number | null {
  return CMD_NAME_TO_ID[cmd] ?? null
}

export function cmdIdToName(id: number): string {
  return CMD_ID_TO_NAME[id] ?? `0x${id.toString(16).padStart(4, '0')}`
}

export function statusMessage(status: number): string {
  switch (status) {
    case STATUS_OK: return 'OK'
    case STATUS_UNKNOWN_CMD: return '未知命令'
    case STATUS_BAD_PARAM: return '参数错误'
    case STATUS_NVS_ERR: return 'NVS 读写失败'
    case STATUS_BUSY: return '设备忙'
    case STATUS_CRC_ERR: return 'CRC 错误'
    case STATUS_SEQ_ERR: return '序号错误'
    case STATUS_SIZE_ERR: return '大小错误'
    case STATUS_NOT_SUPPORTED: return '不支持'
    case STATUS_INTERNAL: return '内部错误'
    default: return `错误(${status})`
  }
}

/** CRC16-CCITT (多项式 0x1021, 初值 0xFFFF, MSB-first, 对齐固件 protocol.cpp) */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] ?? 0) << 8
    for (let b = 0; b < 8; b++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff
      else crc = (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/** 续算 CRC16（初值续用，对齐固件 crc16_continue） */
export function crc16Continue(init: number, data: Uint8Array): number {
  let crc = init
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] ?? 0) << 8
    for (let b = 0; b < 8; b++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff
      else crc = (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/** 帧 CRC：覆盖 [VER..SEQ] 6B + payload，不含 CRC 字段（对齐固件 crc16Frame） */
export function crc16Frame(buf: Uint8Array, total: number): number {
  let c = crc16(buf.subarray(2, 8))
  if (total > HEADER_SIZE) c = crc16Continue(c, buf.subarray(HEADER_SIZE, total))
  return c
}

/** 小端写入器 */
export class Writer {
  private arr: number[] = []

  u8(v: number): this { this.arr.push(v & 0xff); return this }
  u16(v: number): this { this.arr.push(v & 0xff, (v >>> 8) & 0xff); return this }
  u32(v: number): this {
    this.arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
    return this
  }
  i8(v: number): this { this.arr.push(v & 0xff); return this }
  i16(v: number): this { return this.u16(v & 0xffff) }
  i32(v: number): this { return this.u32(v | 0) }
  f32(v: number): this {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setFloat32(0, v, true)
    for (const x of b) this.arr.push(x)
    return this
  }
  bytes(data: Uint8Array | number[]): this {
    for (const b of data) this.arr.push(b & 0xff)
    return this
  }
  /** 字符串：u8 长度前缀 + UTF-8 字节 */
  str(s: string): this {
    const b = new TextEncoder().encode(s)
    this.arr.push(b.length)
    for (const x of b) this.arr.push(x)
    return this
  }
  /** TLV：tag(u8) + len(u8) + value */
  tlv(tag: number, value: Uint8Array): this {
    this.arr.push(tag & 0xff, value.length & 0xff)
    for (const b of value) this.arr.push(b)
    return this
  }
  get length(): number { return this.arr.length }
  /** 当前已写入内容的副本（用于嵌套 TLV 的 value） */
  snapshot(): Uint8Array { return Uint8Array.from(this.arr) }
  toBytes(): Uint8Array { return Uint8Array.from(this.arr) }
}

/** 小端读取器 */
export class Reader {
  private view: DataView
  private off = 0
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }
  get offset(): number { return this.off }
  get remaining(): number { return this.data.length - this.off }
  skip(n: number): void { this.off += n }
  u8(): number {
    if (this.off + 1 > this.data.length) throw new Error('u8 OOB')
    return this.view.getUint8(this.off++)
  }
  u16(): number {
    if (this.off + 2 > this.data.length) throw new Error('u16 OOB')
    const v = this.view.getUint16(this.off, true)
    this.off += 2
    return v
  }
  u32(): number {
    if (this.off + 4 > this.data.length) throw new Error('u32 OOB')
    const v = this.view.getUint32(this.off, true)
    this.off += 4
    return v
  }
  i8(): number {
    if (this.off + 1 > this.data.length) throw new Error('i8 OOB')
    return this.view.getInt8(this.off++)
  }
  i16(): number {
    if (this.off + 2 > this.data.length) throw new Error('i16 OOB')
    const v = this.view.getInt16(this.off, true)
    this.off += 2
    return v
  }
  i32(): number {
    if (this.off + 4 > this.data.length) throw new Error('i32 OOB')
    const v = this.view.getInt32(this.off, true)
    this.off += 4
    return v
  }
  f32(): number {
    if (this.off + 4 > this.data.length) throw new Error('f32 OOB')
    const v = this.view.getFloat32(this.off, true)
    this.off += 4
    return v
  }
  str(): string {
    const len = this.u8()
    if (this.off + len > this.data.length) throw new Error('str OOB')
    const s = new TextDecoder().decode(this.data.subarray(this.off, this.off + len))
    this.off += len
    return s
  }
  /** 剩余字节 */
  rest(): Uint8Array { return this.data.subarray(this.off) }
}

/** 解析 TLV 列表（tag + len 各 1B） */
export function parseTlvList(data: Uint8Array): Array<{ tag: number; value: Uint8Array }> {
  const out: Array<{ tag: number; value: Uint8Array }> = []
  const r = new Reader(data)
  while (r.remaining >= 2) {
    const tag = r.u8()
    const len = r.u8()
    if (r.remaining < len) break
    const value = data.subarray(r.offset, r.offset + len)
    r.skip(len)
    out.push({ tag, value })
  }
  return out
}

export interface DecodedFrame {
  type: number
  flags: number
  len: number
  seq: number
  payload: Uint8Array
}

let seqCounter = 0

/** 构建完整帧 */
export function buildFrame(type: number, payload: Uint8Array, flags = 0): Uint8Array {
  const len = payload.length
  const buf = new Uint8Array(HEADER_SIZE + len)
  buf[0] = SOF0
  buf[1] = SOF1
  buf[2] = PROTO_VERSION
  buf[3] = type
  buf[4] = flags
  buf[5] = len & 0xff
  buf[6] = (len >>> 8) & 0xff
  buf[7] = seqCounter++ & 0xff
  buf.set(payload, HEADER_SIZE)
  const crc = crc16Frame(buf, HEADER_SIZE + len)
  buf[8] = crc & 0xff
  buf[9] = (crc >>> 8) & 0xff
  return buf
}

/**
 * 字节流解码器：从混流中同步帧头、校验 CRC 并产出完整帧。
 * 丢弃的垃圾字节按行切分，仅当 classifyLine 判定为 crash 时回调 onLog（保留 panic 日志展示）。
 */
export class StreamDecoder {
  private buf: number[] = []
  private frameListeners = new Set<(frame: DecodedFrame) => void>()
  private logListeners = new Set<(line: string) => void>()

  onFrame(cb: (frame: DecodedFrame) => void): void { this.frameListeners.add(cb) }
  onLog(cb: (line: string) => void): void { this.logListeners.add(cb) }

  feed(data: Uint8Array): void {
    for (const b of data) this.buf.push(b)
    this.drain()
  }

  private drain(): void {
    while (this.buf.length >= HEADER_SIZE) {
      const sof0 = this.buf.indexOf(SOF0)
      if (sof0 === -1) {
        this.emitLogBytes(this.buf)
        this.buf = []
        return
      }
      if (sof0 > 0) {
        this.emitLogBytes(this.buf.slice(0, sof0))
        this.buf = this.buf.slice(sof0)
      }
      if (this.buf[1] !== SOF1) {
        this.emitLogBytes(this.buf.slice(0, 1))
        this.buf = this.buf.slice(1)
        continue
      }
      if (this.buf.length < HEADER_SIZE) return
      const len = (this.buf[5] ?? 0) | ((this.buf[6] ?? 0) << 8)
      if (len > MAX_PAYLOAD) {
        this.emitLogBytes(this.buf.slice(0, 1))
        this.buf = this.buf.slice(1)
        continue
      }
      const total = HEADER_SIZE + len
      if (this.buf.length < total) return
      const frameBytes = Uint8Array.from(this.buf.slice(0, total))
      this.buf = this.buf.slice(total)
      const crc = (frameBytes[8] ?? 0) | ((frameBytes[9] ?? 0) << 8)
      const calc = crc16Frame(frameBytes, total)
      if (crc !== calc) {
        // CRC 校验失败：丢首字节重新同步（可能是 ESP_LOG 与帧交错）
        this.emitLogBytes([frameBytes[0] ?? 0])
        this.buf.unshift(...frameBytes.slice(1))
        continue
      }
      const frame: DecodedFrame = {
        type: frameBytes[3] ?? 0,
        flags: frameBytes[4] ?? 0,
        len,
        seq: frameBytes[7] ?? 0,
        payload: frameBytes.subarray(HEADER_SIZE, total),
      }
      this.frameListeners.forEach(cb => { try { cb(frame) } catch { /* ignore */ } })
    }
  }

  private emitLogBytes(bytes: number[]): void {
    if (bytes.length === 0 || this.logListeners.size === 0) return
    let line = ''
    for (const b of bytes) {
      if (b === 0x0a || b === 0x0d) {
        if (line.trim()) this.emitLogLine(line.trim())
        line = ''
      } else {
        line += String.fromCharCode(b)
      }
    }
    if (line.trim()) this.emitLogLine(line.trim())
  }

  private emitLogLine(line: string): void {
    try {
      if (classifyLine(line) !== 'crash') return
      this.logListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } })
    } catch { /* ignore */ }
  }
}

/**
 * 分片重组器：FRAGMENT 帧负载 = u16 frag_id + u8 total + u8 index + u16 total_len + u8 orig_type + data
 * 全部序号到达后返回 { origType, payload }（payload 为重组后的原始帧负载）。
 */
export interface AssembledPayload {
  origType: number
  payload: Uint8Array
}

export class FragmentAssembler {
  private map = new Map<number, { total: number; totalLen: number; origType: number; chunks: Uint8Array[] }>()

  push(frame: DecodedFrame): AssembledPayload | null {
    const p = frame.payload
    if (p.length < 7) return null
    const r = new Reader(p)
    const fragId = r.u16()
    const total = r.u8()
    const index = r.u8()
    const totalLen = r.u16()
    const origType = r.u8()
    const data = p.subarray(r.offset)
    if (total === 0 || index >= total) return null
    let entry = this.map.get(fragId)
    if (!entry) {
      entry = { total, totalLen, origType, chunks: new Array<Uint8Array>(total) }
      this.map.set(fragId, entry)
    }
    entry.chunks[index] = data
    if (entry.chunks.every(c => c !== undefined)) {
      this.map.delete(fragId)
      const out = new Uint8Array(entry.totalLen)
      let off = 0
      for (const c of entry.chunks) {
        const len = Math.min(c!.length, out.length - off)
        out.set(c!.subarray(0, len), off)
        off += len
      }
      return { origType: entry.origType, payload: out }
    }
    return null
  }
}
