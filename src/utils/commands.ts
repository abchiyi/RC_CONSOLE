/**
 * commands.ts — 固件二进制协议命令层
 *
 * 请求：payload = u16 cmd_id + 参数（与固件 dispatch_binary 对齐）
 * 响应：payload = u8 status + u16 cmd_id + data（data 由本层解码为旧 JSON 同字段名对象，Store 接口不变）
 * 事件：payload = u16 event_id + u8 content_type + data
 *
 * 实时 raw+IMU 已并入 STREAM content_type=1（§5.7/§5.11），字段顺序：trigger, joy_x, joy_y, roll, pitch, yaw。
 */

import {
  CMD,
  FRAME_REQUEST,
  FRAME_FRAGMENT,
  FLAG_FRAGMENTED,
  STATUS_OK,
  STREAM_CHANNELS,
  STREAM_RAW_IMU,
  STREAM_POWER,
  STREAM_LINK,
  EVENT_STREAM_DATA,
  Writer,
  Reader,
  buildFrame,
  parseTlvList,
  cmdNameToId,
  cmdIdToName,
} from './protocol'
import type { ModelChannel, ModelConfig } from '@/stores/config'

// ── 枚举名称表（对齐固件 protocol.h） ──

const INPUT_SOURCE_NAMES = [
  'NONE', 'BUTTON_LOCK', 'BUTTON_MH', 'BUTTON_EC11_BTN', 'BUTTON_SHOT',
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'KNOB_EC11', 'MIX',
]

const TRIGGER_NAMES = ['SINGLE_CLICK', 'DOUBLE_CLICK', 'LONG_PRESS', 'LONG_PRESS_UP', 'PRESS', 'RELEASE']

const CAL_TYPE_NAMES = ['none', 'trigger', 'joy_x', 'joy_y', 'imu']

function sourceToId(s: string): number {
  const idx = INPUT_SOURCE_NAMES.indexOf(s)
  return idx > 0 ? idx : 0
}

function sourceFromId(id: number): string {
  return INPUT_SOURCE_NAMES[id] ?? 'NONE'
}

function triggerToId(t: string): number {
  const idx = TRIGGER_NAMES.indexOf(t)
  return idx >= 0 ? idx : 0
}

function triggerFromId(id: number): string {
  return TRIGGER_NAMES[id] ?? 'SINGLE_CLICK'
}

function calTypeToId(t: string): number {
  const idx = CAL_TYPE_NAMES.indexOf(t)
  return idx > 0 ? idx : 0
}

function calTypeFromId(id: number): string {
  return CAL_TYPE_NAMES[id] ?? 'none'
}

/** 单帧最大 payload：超过则拆成 FRAGMENT 帧 */
const SINGLE_FRAME_MAX = 1000
const FRAGMENT_CHUNK = 512

// ── 请求编码 ──

/** 编码请求，返回帧数组（大 payload 自动分片为 FRAGMENT 帧） */
export function encodeRequest(cmd: string, params?: Record<string, unknown>): Uint8Array[] {
  const id = cmdNameToId(cmd)
  if (id === null) throw new Error(`未知命令: ${cmd}`)
  const w = new Writer().u16(id)
  if (params) encodeParams(id, w, params)
  const payload = w.toBytes()
  if (payload.length <= SINGLE_FRAME_MAX) {
    return [buildFrame(FRAME_REQUEST, payload)]
  }
  return buildFragmented(payload)
}

function encodeParams(id: number, w: Writer, params: Record<string, unknown>): void {
  switch (id) {
    case CMD.GET_MODEL:
    case CMD.SET_ACTIVE:
    case CMD.SET_RUNTIME_MODEL:
      w.u8(Number(params.slot ?? 0))
      break
    case CMD.SET_MODEL:
      w.u8(Number(params.slot ?? 0))
      if (params.data) w.bytes(encodeModelTlv(params.data as ModelConfig))
      break
    case CMD.CAL_START:
      w.u8(calTypeToId(String(params.type ?? 'none')))
      break
    case CMD.CAL_SET_DEADZONE:
      w.u8(calTypeToId(String(params.type ?? 'trigger')))
      w.u16(Number(params.deadzone ?? 0))
      break
    case CMD.CAL_SET_LPF_ALPHA:
      w.u16(Number(params.alpha ?? 500))
      break
    case CMD.SET_POWER_CFG:
      w.u16(Number(params.idle_warning_s ?? 0))
      w.u16(Number(params.idle_shutdown_s ?? 0))
      break
    case CMD.SET_DEBUG_MODE:
      w.u8(params.enable ? 1 : 0)
      break
    case CMD.ELRS_SET_PARAM:
      w.u8(Number(params.field_id ?? 0))
      w.i32(Number(params.value ?? 0))
      break
    case CMD.STREAM_START:
      w.u8(Number(params.content_type ?? 0))
      w.u16(Number(params.interval_ms ?? 20))
      w.u8(Number(params.flags ?? 0))
      break
    case CMD.OTA_BEGIN:
      w.u32(Number(params.size ?? 0))
      break
    case CMD.OTA_CHUNK:
      if (params.data instanceof Uint8Array) w.bytes(params.data)
      break
    default:
      break
  }
}

/** 大 payload 分片：payload = u16 frag_id + u8 total + u8 index + u16 total_len + u8 orig_type + data */
function buildFragmented(payload: Uint8Array): Uint8Array[] {
  const fragId = Math.floor(Math.random() * 0xffff)
  const total = Math.ceil(payload.length / FRAGMENT_CHUNK)
  const frames: Uint8Array[] = []
  for (let i = 0; i < total; i++) {
    const data = payload.subarray(i * FRAGMENT_CHUNK, (i + 1) * FRAGMENT_CHUNK)
    const w = new Writer()
      .u16(fragId).u8(total).u8(i).u16(payload.length).u8(FRAME_REQUEST)
      .bytes(data)
    frames.push(buildFrame(FRAME_FRAGMENT, w.toBytes(), FLAG_FRAGMENTED))
  }
  return frames
}

// ── 模型 TLV 编码/解码 ──

const DEFAULT_CHANNEL: ModelChannel = {
  source: 'NONE',
  activate: { trigger: 'SINGLE_CLICK', value: 1500 },
  deactivate: { trigger: 'SINGLE_CLICK', value: 1500 },
  toggle: { trigger: 'DOUBLE_CLICK', value: 1500 },
  input_min: 0,
  input_center: 0,
  input_max: 0,
  output_min: 1000,
  output_center: 1500,
  output_max: 2000,
  deadzone: 30,
  ec11_step: 1,
  reverse: false,
  condition: {
    enabled: false, source_channel: 3, op: 0, threshold: 1500,
    switch_source: false, value: 1500, alt_source: 'NONE',
  },
  lock_enabled: false,
  lock_value: 1500,
  mix_enabled: false,
  mix_items: [],
}

/** 模型对象 TLV：0x01 name, 0x02..0x11 通道 0..15 */
export function encodeModelTlv(model: ModelConfig): Uint8Array {
  const w = new Writer()
  if (model.name) w.tlv(0x01, new Writer().str(model.name).toBytes())
  const channels = model.channels ?? []
  for (let i = 0; i < 16 && i < channels.length; i++) {
    const ch = channels[i]
    if (ch) w.tlv(0x02 + i, encodeChannelTlv(ch))
  }
  return w.toBytes()
}

function encodeChannelTlv(ch: ModelChannel): Uint8Array {
  const w = new Writer()
  w.tlv(0x01, new Writer().u8(sourceToId(ch.source ?? 'NONE')).toBytes())
  if (ch.activate) {
    w.tlv(0x02, new Writer().u8(triggerToId(ch.activate.trigger)).u16(ch.activate.value).toBytes())
  }
  if (ch.deactivate) {
    w.tlv(0x03, new Writer().u8(triggerToId(ch.deactivate.trigger)).u16(ch.deactivate.value).toBytes())
  }
  if (ch.toggle) {
    w.tlv(0x04, new Writer().u8(triggerToId(ch.toggle.trigger)).u16(ch.toggle.value).toBytes())
  }
  if (ch.input_min !== undefined) w.tlv(0x05, new Writer().i32(ch.input_min).toBytes())
  if (ch.input_center !== undefined) w.tlv(0x06, new Writer().i32(ch.input_center).toBytes())
  if (ch.input_max !== undefined) w.tlv(0x07, new Writer().i32(ch.input_max).toBytes())
  if (ch.output_min !== undefined) w.tlv(0x08, new Writer().i32(ch.output_min).toBytes())
  if (ch.output_center !== undefined) w.tlv(0x09, new Writer().i32(ch.output_center).toBytes())
  if (ch.output_max !== undefined) w.tlv(0x0a, new Writer().i32(ch.output_max).toBytes())
  if (ch.deadzone !== undefined) w.tlv(0x0b, new Writer().i32(ch.deadzone).toBytes())
  if (ch.ec11_step !== undefined) w.tlv(0x0c, new Writer().i32(ch.ec11_step).toBytes())
  if (ch.reverse !== undefined) w.tlv(0x0d, new Writer().u8(ch.reverse ? 1 : 0).toBytes())
  if (ch.condition) {
    const c = ch.condition
    w.tlv(0x0e, new Writer()
      .u8(c.enabled ? 1 : 0).u8(c.source_channel ?? 0).u8(c.op ?? 0).u16(c.threshold ?? 0)
      .u8(c.switch_source ? 1 : 0).u16(c.value ?? 0).u8(sourceToId(c.alt_source ?? 'NONE'))
      .toBytes())
  }
  if (ch.mix_enabled !== undefined || ch.mix_items) {
    const items = (ch.mix_items ?? []).slice(0, 4)
    const t = new Writer().u8(ch.mix_enabled ? 1 : 0).u8(items.length)
    for (const m of items) t.u8(sourceToId(m.src ?? 'NONE')).i8(m.w ?? 0).u8(m.reverse ? 1 : 0)
    w.tlv(0x0f, t.toBytes())
  }
  if (ch.lock_enabled !== undefined || ch.lock_value !== undefined) {
    w.tlv(0x10, new Writer().u8(ch.lock_enabled ? 1 : 0).u16(ch.lock_value ?? 0).toBytes())
  }
  return w.toBytes()
}

export function decodeModelTlv(data: Uint8Array): ModelConfig {
  const model: ModelConfig = { name: '', channels: [] }
  for (const { tag, value } of parseTlvList(data)) {
    if (tag === 0x01) {
      model.name = new Reader(value).str()
    } else if (tag >= 0x02 && tag <= 0x11) {
      const idx = tag - 0x02
      if (idx < 16) model.channels[idx] = decodeChannelTlv(value)
    }
  }
  const channels: ModelChannel[] = []
  for (let i = 0; i < 16; i++) channels[i] = model.channels[i] ?? { ...DEFAULT_CHANNEL }
  model.channels = channels
  return model
}

function decodeChannelTlv(value: Uint8Array): ModelChannel {
  const ch: Partial<ModelChannel> = {}
  for (const { tag, value: val } of parseTlvList(value)) {
    const r = new Reader(val)
    switch (tag) {
      case 0x01: ch.source = sourceFromId(r.u8()); break
      case 0x02: ch.activate = { trigger: triggerFromId(r.u8()), value: r.u16() }; break
      case 0x03: ch.deactivate = { trigger: triggerFromId(r.u8()), value: r.u16() }; break
      case 0x04: ch.toggle = { trigger: triggerFromId(r.u8()), value: r.u16() }; break
      case 0x05: ch.input_min = r.i32(); break
      case 0x06: ch.input_center = r.i32(); break
      case 0x07: ch.input_max = r.i32(); break
      case 0x08: ch.output_min = r.i32(); break
      case 0x09: ch.output_center = r.i32(); break
      case 0x0a: ch.output_max = r.i32(); break
      case 0x0b: ch.deadzone = r.i32(); break
      case 0x0c: ch.ec11_step = r.i32(); break
      case 0x0d: ch.reverse = !!r.u8(); break
      case 0x0e: {
        ch.condition = {
          enabled: !!r.u8(),
          source_channel: r.u8(),
          op: r.u8(),
          threshold: r.u16(),
          switch_source: !!r.u8(),
          value: r.u16(),
          alt_source: sourceFromId(r.u8()),
        }
        break
      }
      case 0x0f: {
        ch.mix_enabled = !!r.u8()
        const cnt = Math.min(r.u8(), 4)
        ch.mix_items = []
        for (let i = 0; i < cnt; i++) {
          ch.mix_items.push({ src: sourceFromId(r.u8()), w: r.i8(), reverse: !!r.u8() })
        }
        break
      }
      case 0x10: ch.lock_enabled = !!r.u8(); ch.lock_value = r.u16(); break
      default: break
    }
  }
  return { ...DEFAULT_CHANNEL, ...ch } as ModelChannel
}

// ── 响应解码（还原为旧 JSON 字段名对象） ──

export function decodeResponse(cmdId: number, status: number, data: Uint8Array): Record<string, unknown> | null {
  const name = cmdIdToName(cmdId)
  if (status !== STATUS_OK) {
    return { cmd: name, ok: false, error: statusText(status), status }
  }
  const r = new Reader(data)
  try {
    switch (cmdId) {
      case CMD.GET_INFO: return decodeGetInfo(r, name)
      case CMD.GET_CONFIG: return decodeGetConfig(r, name)
      case CMD.GET_MODEL: return { cmd: name, ...decodeModelTlv(data) }
      case CMD.CAL_STATUS: return decodeCalStatus(r, name)
      case CMD.CAL_GET: return decodeCalGet(r, name)
      case CMD.GET_POWER_CFG: return { cmd: name, idle_warning_s: r.u16(), idle_shutdown_s: r.u16() }
      case CMD.GET_POWER_STATE: return decodePowerState(r, name)
      case CMD.GET_DEBUG_MODE: return { cmd: name, debug_mode: !!r.u8() }
      case CMD.GET_LINK_STATS: return decodeLinkStats(r, name)
      case CMD.ELRS_LIST_FIELDS: return decodeElrsFields(r, name)
      case CMD.OTA_BEGIN:
        return { cmd: name, ok: true, chunk_hint: r.u16(), partition_size: r.u32(), label: r.str() }
      case CMD.OTA_CHUNK:
        return { cmd: name, ok: true, total_written: r.u32(), this_chunk: r.u32() }
      case CMD.OTA_FINISH:
        return { cmd: name, ok: true, total_written: r.u32(), message: r.str() }
      case CMD.STREAM_START:
        return { cmd: name, content_type: r.u8(), interval_ms: r.u16(), flags: r.u8() }
      default:
        return { cmd: name, ok: true }
    }
  } catch {
    return { cmd: name, ok: false, error: '响应解析失败' }
  }
}

function statusText(status: number): string {
  switch (status) {
    case 1: return '未知命令'
    case 2: return '参数错误'
    case 3: return '设备忙'
    case 4: return 'NVS 读写失败'
    case 5: return 'OTA 错误'
    case 6: return '不支持'
    default: return `设备错误(${status})`
  }
}

function decodeGetInfo(r: Reader, name: string): Record<string, unknown> {
  const device = r.str()
  const fw_version = r.str()
  const hw_version = r.str()
  const model_count = r.u8()
  const channel_count = r.u8()
  const input_src_count = r.u8()
  const input_sources = []
  for (let i = 0; i < input_src_count; i++) {
    input_sources.push({ id: sourceFromId(r.u8()), is_button: !!r.u8(), name: r.str() })
  }
  const btnCount = r.u8()
  const button_triggers: string[] = []
  for (let i = 0; i < btnCount; i++) button_triggers.push(r.str())
  return {
    cmd: name, device, fw_version, hw_version,
    model_count, channel_count, input_src_count,
    input_sources, button_triggers,
  }
}

function decodeGetConfig(r: Reader, name: string): Record<string, unknown> {
  const cfg: Record<string, unknown> = { cmd: name, models: [] }
  for (const { tag, value } of parseTlvList(r.rest())) {
    const rr = new Reader(value)
    if (tag === 0x01) cfg.radio_mode = rr.i32()
    else if (tag === 0x02) cfg.active_model = rr.i32()
    else if (tag === 0x03) cfg.lpf_alpha = rr.i32()
    else if (tag === 0x04) cfg.runtime_model = rr.i32()
    else if (tag >= 0x10 && tag <= 0x17) {
      const slot = tag - 0x10
      ;(cfg.models as ModelConfig[])[slot] = decodeModelTlv(value)
    }
  }
  return cfg
}

function decodeCalStatus(r: Reader, name: string): Record<string, unknown> {
  return {
    cmd: name,
    state: r.u8(),
    type: calTypeFromId(r.u8()),
    progress: r.u8(),
    message: r.str(),
  }
}

function readCalData(r: Reader): Record<string, number | boolean> {
  return {
    min: r.i32(),
    center: r.i32(),
    max: r.i32(),
    deadzone: r.i32(),
    invert: !!r.u8(),
    half_range: r.i32(),
  }
}

function decodeCalGet(r: Reader, name: string): Record<string, unknown> {
  return {
    cmd: name,
    adc: { trigger: readCalData(r), joy_x: readCalData(r), joy_y: readCalData(r) },
    imu: { cal: { gyro_bias_x: r.f32(), gyro_bias_y: r.f32(), gyro_bias_z: r.f32() } },
    cal_state: r.u8(),
    lpf_alpha: r.i32(),
  }
}

function chargeStatusMap(v: number): string {
  if (v === 0) return 'none'
  if (v <= 2) return 'charging'
  if (v === 3) return 'full'
  return 'none'
}

function decodePowerState(r: Reader, name: string): Record<string, unknown> {
  return {
    cmd: name,
    state: 'normal',
    charge: chargeStatusMap(r.u8()),
    battery_mv: r.u16(),
    battery_pct: r.u8(),
    vbus_mv: r.u16(),
    sys_mv: r.u16(),
    temp: r.i16() / 10,
    charge_current_ma: r.u16(),
    irq_count: r.u32(),
    debug_mode: !!r.u8(),
    idle_s: r.u16(),
  }
}

function decodeLinkStats(r: Reader, name: string): Record<string, unknown> {
  const valid = !!r.u8()
  const field_count = r.u8()
  const out: Record<string, unknown> = { cmd: name, valid, field_count }
  if (valid) {
    out.ul_rssi = r.i8()
    out.ul_lq = r.u8()
    out.dl_rssi = r.i8()
    out.dl_lq = r.u8()
    out.rf_mode = r.u8()
    out.tx_power = r.u8()
  }
  return out
}

function decodeElrsFields(r: Reader, name: string): Record<string, unknown> {
  const count = r.u8()
  const fields: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const f: Record<string, unknown> = {
      id: r.u8(),
      parent: r.u8(),
      hidden: !!r.u8(),
      value_valid: !!r.u8(),
      type: r.u8(),
      min: r.i32(),
      max: r.i32(),
      step: r.i32(),
      name: r.str(),
      unit: r.str(),
    }
    if (f.value_valid) {
      f.value = r.i32()
      f.text = r.str()
    }
    if (f.type === 9) {
      const optCount = r.u8()
      if (optCount > 0) {
        const opts: string[] = []
        for (let j = 0; j < optCount; j++) opts.push(r.str())
        f.options = opts
      }
    }
    fields.push(f)
  }
  return { cmd: name, fields, field_count: count }
}

// ── 流式事件解码 ──

export function decodeEvent(payload: Uint8Array, streamFlags = 0): Record<string, unknown> | null {
  const r = new Reader(payload)
  if (r.remaining < 3) return null
  const eventId = r.u16()
  const contentType = r.u8()
  const dataBytes = payload.subarray(r.offset)
  try {
    switch (contentType) {
      case STREAM_CHANNELS:
        return { evt: eventId, contentType, data: decodeChannels(dataBytes, streamFlags) }
      case STREAM_RAW_IMU:
        return { evt: eventId, contentType, data: decodeRawImu(dataBytes) }
      case STREAM_POWER:
        return { evt: eventId, contentType, data: decodePowerState(new Reader(dataBytes), 'stream_power') }
      case STREAM_LINK:
        return { evt: eventId, contentType, data: decodeLinkStats(new Reader(dataBytes), 'stream_link') }
      default:
        return null
    }
  } catch {
    return null
  }
}

/** 通道事件：16 通道（u16 或 11-bit 打包）+ 可选 16×source 名称 */
function decodeChannels(bytes: Uint8Array, streamFlags: number): Record<string, unknown> {
  const packed = !!(streamFlags & 0x02)
  const withSources = !!(streamFlags & 0x01)
  const channels: number[] = []
  if (packed) {
    channels.push(...unpack11bit(bytes.subarray(0, 22), 16))
  } else {
    const r = new Reader(bytes)
    for (let i = 0; i < 16; i++) channels.push(r.u16())
  }
  let sources: string[] | undefined
  if (withSources) {
    const base = packed ? 22 : 32
    sources = []
    for (let i = 0; i < 16; i++) sources.push(sourceFromId(bytes[base + i] ?? 0))
  }
  return { channels, sources }
}

/** 11-bit 小端位流解包（固件 pack_channels_11bit 的逆过程） */
export function unpack11bit(data: Uint8Array, count: number): number[] {
  const out: number[] = []
  let bitPos = 0
  for (let i = 0; i < count; i++) {
    let val = 0
    for (let b = 0; b < 11; b++) {
      const byteIdx = bitPos >> 3
      const bitIdx = bitPos & 7
      const bit = byteIdx < data.length ? ((data[byteIdx] ?? 0) >> bitIdx) & 1 : 0
      val |= bit << b
      bitPos++
    }
    out.push(val)
  }
  return out
}

/** RAW+IMU 事件：u16 trigger, u16 joy_x, u16 joy_y, i16 roll/pitch/yaw（×100 定点） */
function decodeRawImu(bytes: Uint8Array): Record<string, unknown> {
  const r = new Reader(bytes)
  return {
    raw: { trigger: r.u16(), joy_x: r.u16(), joy_y: r.u16() },
    imu: { roll: r.i16() / 100, pitch: r.i16() / 100, yaw: r.i16() / 100 },
  }
}

export const STREAM_EVENT_ID = EVENT_STREAM_DATA
