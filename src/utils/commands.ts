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
import { RAW_MIN, RAW_CENTER, RAW_MAX } from './crsf'

// ── 枚举名称表（对齐固件 protocol.h） ──

const INPUT_SOURCE_NAMES = [
  'NONE', 'BUTTON_LOCK', 'BUTTON_MH', 'BUTTON_EC11_BTN', 'BUTTON_SHOT',
  'ANALOG_TRIGGER', 'ANALOG_JOYSTICK_X', 'ANALOG_JOYSTICK_Y',
  'IMU_ROLL', 'IMU_PITCH', 'KNOB_EC11', 'MIX', 'IMU_YAW',
]

const TRIGGER_NAMES = ['SINGLE_CLICK', 'DOUBLE_CLICK', 'LONG_PRESS', 'LONG_PRESS_UP', 'PRESS', 'RELEASE']

/** 通道触发动作 (与固件 ChannelAction 一致) */
const CHANNEL_ACTION_NAMES = ['NONE', 'BEEP']

/** 触发动作名 → 枚举 id */
export function actionToId(a: string): number {
  const i = CHANNEL_ACTION_NAMES.indexOf(a)
  return i > 0 ? i : 0
}

/** 触发动作枚举 id → 名 */
export function actionFromId(id: number): string {
  return CHANNEL_ACTION_NAMES[id] ?? 'NONE'
}

const CAL_TYPE_NAMES = ['none', 'trigger', 'joy_x', 'joy_y', 'imu', 'joy_xy']

/** 输出响应曲线类型 (cubic-bezier): 与固件 CMD_CAL_SET_CURVE type 一致 */
const CURVE_TYPE_NAMES = ['none', 'trigger', 'joy_x', 'joy_y', 'imu_roll', 'imu_pitch', 'imu_yaw']

function sourceToId(s: string): number {
  const idx = INPUT_SOURCE_NAMES.indexOf(s)
  return idx > 0 ? idx : 0
}

function sourceFromId(id: number): string {
  return INPUT_SOURCE_NAMES[id] ?? 'NONE'
}

function triggerToId(t: string): number {
  if (t === 'NONE') return 0xFF
  const idx = TRIGGER_NAMES.indexOf(t)
  return idx >= 0 ? idx : 0
}

function triggerFromId(id: number): string {
  if (id === 0xFF) return 'NONE'
  return TRIGGER_NAMES[id] ?? 'SINGLE_CLICK'
}

function calTypeToId(t: string): number {
  const idx = CAL_TYPE_NAMES.indexOf(t)
  return idx > 0 ? idx : 0
}

function calTypeFromId(id: number): string {
  return CAL_TYPE_NAMES[id] ?? 'none'
}

function curveTypeToId(t: string): number {
  const idx = CURVE_TYPE_NAMES.indexOf(t)
  return idx > 0 ? idx : 0
}

function curveTypeFromId(id: number): string {
  return CURVE_TYPE_NAMES[id] ?? 'none'
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
      if (params.diff) {
        // 差分同步: flags=0x01 (FLAG_PARTIAL), 固件按现有 RAM 模型合并缺失字段
        w.u8(1)
        const d = params.diff as {
          name: string | null
          channels: Map<number, ModelChannel>
          curveEnabled: boolean | null
        }
        w.bytes(encodeModelDiffTlv(d.name, d.channels, d.curveEnabled))
      } else {
        // 全量覆盖: flags=0x00 (兼容旧语义, 缺失字段恢复默认)
        w.u8(0)
        if (params.data) w.bytes(encodeModelTlv(params.data as ModelConfig))
      }
      break
    case CMD.CAL_START:
      w.u8(calTypeToId(String(params.type ?? 'none')))
      break
    case CMD.CAL_STEP:
      w.u8(calTypeToId(String(params.type ?? 'joy_x')))
      w.u8(Number(params.step ?? 0))
      break
    case CMD.CAL_SET_DEADZONE:
      w.u8(calTypeToId(String(params.type ?? 'trigger')))
      w.u16(Number(params.deadzone ?? 0))
      break
    case CMD.CAL_SET_LPF_ALPHA:
      w.u16(Number(params.alpha ?? 500))
      break
    case CMD.CAL_SET_CURVE:
      w.u8(curveTypeToId(String(params.type ?? 'trigger')))
      w.i8(Number(params.x1 ?? 50))
      w.i8(Number(params.y1 ?? 50))
      w.i8(Number(params.x2 ?? 50))
      w.i8(Number(params.y2 ?? 50))
      break
    case CMD.SET_POWER_CFG:
      w.u16(Number(params.idle_warning_s ?? 0))
      w.u16(Number(params.idle_shutdown_s ?? 0))
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
    case CMD.SET_TELEM2:
      // 遥测转发端口位掩码: bit0=USB, bit1=BLE (§5.13)
      // ⚠ 自锁风险 (FE-02): 被置位的端口会转为**纯 MAVLink 遥测口**,
      //   该口的二进制指令由固件通道层门卫**静默丢弃** —— 即"通过 USB 连接时把 bit0 置 1"
      //   会立刻失去 USB 配置通道, 且该值**落 NVS 持久化**(重启不恢复)。
      //   解除方式只有三种: 从另一个未被占用的口(BLE)改回、NVS 全分区擦除、出厂复位。
      //   → UI 侧必须提示用户, 并禁止把"当前正在使用的那个口"置位。
      w.u8(Number(params.mask ?? 0))
      break
    case CMD.SET_LOCK_ZERO:
      // 「AUX1 解锁时三轴归零」开关: 0=关, 1=开
      w.u8(Number(params.enable ?? 0) ? 1 : 0)
      break
    case CMD.OTA_BEGIN:
      w.u32(Number(params.size ?? 0))
      break
    case CMD.OTA_CHUNK:
      // F-28: u32 offset(本片首字节在镜像中的绝对偏移) + 数据(可空)
      // 负载 ≤4B(仅 offset 或无负载) = 进度探针: 固件只回读"已接受累计", 不写 flash
      w.u32(Number(params.offset ?? 0))
      if (params.data instanceof Uint8Array) w.bytes(params.data)
      break
    case CMD.ELRS_FLASH_BEGIN:
      // §5.14: u32 offset + u32 image_size + u8 flags(bit0=烧录前整片擦除)
      w.u32(Number(params.offset ?? 0))
      w.u32(Number(params.image_size ?? 0))
      w.u8(Number(params.flags ?? 0))
      break
    case CMD.ELRS_FLASH_CHUNK:
      // §5.14: u32 offset(本片首字节绝对地址) + 原始固件字节
      w.u32(Number(params.offset ?? 0))
      if (params.data instanceof Uint8Array) w.bytes(params.data)
      break
    // ── 配置备份 / 还原（§5.15）──
    case CMD.CONFIG_EXPORT_BEGIN:
      // flags: bit0 = pretty(缩进输出)
      w.u8(Number(params.flags ?? 0))
      break
    case CMD.CONFIG_EXPORT_CHUNK:
      w.u32(Number(params.offset ?? 0))
      w.u16(Number(params.want ?? 2048))
      break
    case CMD.CONFIG_IMPORT_BEGIN:
      w.u32(Number(params.total_len ?? 0))
      w.u16(Number(params.crc16 ?? 0))
      w.u8(Number(params.flags ?? 0))
      break
    case CMD.CONFIG_IMPORT_CHUNK:
      w.u32(Number(params.offset ?? 0))
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

/** 每个通道支持的按钮挡位数 (与固件 MODEL_GEAR_COUNT 一致) */
export const GEAR_COUNT = 5

/**
 * gear[n] 对应的通道级 TLV tag。
 * tag 序列不连续: 0x05..0x10 已被量程/reverse/condition/mix/lock 占用,
 * 扩到 5 挡只能追加 0x11 / 0x12 (旧固件按未知 tag 跳过, 仅保留前 3 挡)。
 */
const GEAR_TAGS = [0x02, 0x03, 0x04, 0x11, 0x12] as const

/**
 * 通道默认配置。
 *
 * 注意单位: output_min/max/center、各挡位 value、condition 阈值、lock_value 全部是 **CRSF raw** (186/991/1796)，
 * 与固件 ModelChannel 默认值 (lib/Config/config.h:63-105) 一致。
 * UI 层 (pages/config.vue) 负责 raw ↔ μs 换算，此处绝不能写 μs 值（否则经 rawToUs 二次换算会溢出量程）。
 */
const DEFAULT_CHANNEL: ModelChannel = {
  source: 'NONE',
  gears: Array.from({ length: GEAR_COUNT }, () => ({ trigger: 'NONE', value: RAW_MIN })),
  input_min: 0,
  input_center: 0,
  input_max: 0,
  output_min: RAW_MIN,
  output_center: RAW_CENTER,
  output_max: RAW_MAX,
  deadzone: 0,
  ec11_step: 50,
  reverse: false,
  condition: {
    enabled: false, source_channel: 0, low: RAW_MIN, high: RAW_MAX,
    switch_source: false, value: RAW_CENTER, alt_source: 'NONE',
  },
  lock_enabled: false,
  lock_value: RAW_CENTER,
  lock_reset_input: false,
  mix_enabled: false,
  mix_items: [],
  triggers: [],
  aux_source: 'NONE',
}

/** 深拷贝默认通道: 避免多个回退通道共享 condition / mix_items / gears 引用而被互相串改 */
function defaultChannel(): ModelChannel {
  return {
    ...DEFAULT_CHANNEL,
    gears: DEFAULT_CHANNEL.gears.map(g => ({ ...g })),
    condition: { ...DEFAULT_CHANNEL.condition },
    mix_items: [],
    triggers: [],
    lock_reset_input: false,
    aux_source: 'NONE',
  }
}

/** 模型对象 TLV：0x01 name, 0x02..0x11 通道 0..15, 0x12 curve_enabled */
export function encodeModelTlv(model: ModelConfig): Uint8Array {
  const w = new Writer()
  if (model.name) w.tlv(0x01, new Writer().str(model.name).toBytes())
  if (model.curve_enabled !== undefined) {
    w.tlv(0x12, new Writer().u8(model.curve_enabled ? 1 : 0).toBytes())
  }
  const channels = model.channels ?? []
  for (let i = 0; i < 16 && i < channels.length; i++) {
    const ch = channels[i]
    if (ch) w.tlv(0x02 + i, encodeChannelTlv(ch))
  }
  return w.toBytes()
}

/**
 * 差分模型 TLV: 仅发送变化的 name (null=未变, 不发送) 与指定的通道索引集合。
 * 固件收到 flags=FLAG_PARTIAL 时按现有 RAM 模型合并: 未提及的字段/通道保持原值。
 */
export function encodeModelDiffTlv(
  name: string | null,
  channels: Map<number, ModelChannel>,
  curveEnabled: boolean | null = null,
): Uint8Array {
  const w = new Writer()
  // name 有变化就发送 (即使空串, 用于清空模型名)
  if (name !== null) w.tlv(0x01, new Writer().str(name).toBytes())
  // 模型级曲线总开关有变化才发送
  if (curveEnabled !== null) w.tlv(0x12, new Writer().u8(curveEnabled ? 1 : 0).toBytes())
  for (const [idx, ch] of channels) {
    if (idx >= 0 && idx < 16) w.tlv(0x02 + idx, encodeChannelTlv(ch))
  }
  return w.toBytes()
}

export function encodeChannelTlv(ch: ModelChannel): Uint8Array {
  const w = new Writer()
  w.tlv(0x01, new Writer().u8(sourceToId(ch.source ?? 'NONE')).toBytes())
  const gears = (ch.gears ?? []).slice(0, GEAR_COUNT)
  for (let g = 0; g < GEAR_COUNT; g++) {
    const ge = gears[g]
    if (!ge) continue
    w.tlv(GEAR_TAGS[g]!, new Writer().u8(triggerToId(ge.trigger)).u16(ge.value).toBytes())
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
      .u8(c.enabled ? 1 : 0).u8(c.source_channel ?? 0).u16(c.low ?? 1000).u16(c.high ?? 2000)
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
  if (ch.lock_reset_input !== undefined) {
    w.tlv(0x14, new Writer().u8(ch.lock_reset_input ? 1 : 0).toBytes())
  }
  if (ch.aux_source && ch.aux_source !== 'NONE') {
    w.tlv(0x15, new Writer().u8(sourceToId(ch.aux_source)).toBytes())
  }
  if (ch.triggers?.length) {
    const items = ch.triggers.slice(0, 5)
    const t = new Writer().u8(items.length)
    for (const g of items) {
      t.u16(g.low ?? 0).u16(g.high ?? 0)
        .u8(actionToId(g.action ?? 'NONE')).u8(g.param ?? 0).u8(g.enabled === false ? 0 : 1)
    }
    w.tlv(0x13, t.toBytes())
  }
  return w.toBytes()
}

export function decodeModelTlv(data: Uint8Array): ModelConfig {
  const model: ModelConfig = { name: '', channels: [], curve_enabled: true }
  for (const { tag, value } of parseTlvList(data)) {
    if (tag === 0x01) {
      // 防御: name 字段数据异常(如长度越界)时降级为空名, 不让整个响应丢失
      try {
        model.name = new Reader(value).str()
      } catch {
        model.name = ''
      }
    } else if (tag === 0x12) {
      model.curve_enabled = !!new Reader(value).u8()
    } else if (tag >= 0x02 && tag <= 0x11) {
      const idx = tag - 0x02
      if (idx < 16) {
        try {
          model.channels[idx] = decodeChannelTlv(value)
        } catch {
          // 单个通道解析失败不致命, 保留默认通道
        }
      }
    }
  }
  const channels: ModelChannel[] = []
  for (let i = 0; i < 16; i++) channels[i] = model.channels[i] ?? defaultChannel()
  model.channels = channels
  return model
}

function decodeChannelTlv(value: Uint8Array): ModelChannel {
  const ch: Partial<ModelChannel> = {}
  for (const { tag, value: val } of parseTlvList(value)) {
    const r = new Reader(val)
    switch (tag) {
      case 0x01: ch.source = sourceFromId(r.u8()); break
      case 0x02:
      case 0x03:
      case 0x04:
      case 0x11:
      case 0x12: {
        const gi = GEAR_TAGS.indexOf(tag as typeof GEAR_TAGS[number])
        if (gi < 0) break
        if (!ch.gears) {
          ch.gears = Array.from({ length: GEAR_COUNT }, () => ({ trigger: 'NONE', value: RAW_MIN }))
        }
        ch.gears[gi] = { trigger: triggerFromId(r.u8()), value: r.u16() }
        break
      }
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
          low: r.u16(),
          high: r.u16(),
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
      case 0x14: ch.lock_reset_input = !!r.u8(); break
      case 0x15: ch.aux_source = sourceFromId(r.u8()); break
      case 0x13: {
        const cnt = Math.min(r.u8(), 5)
        ch.triggers = []
        for (let i = 0; i < cnt; i++) {
          ch.triggers.push({
            low: r.u16(), high: r.u16(),
            action: actionFromId(r.u8()), param: r.u8(), enabled: !!r.u8(),
          })
        }
        break
      }
      default: break
    }
  }
  return { ...defaultChannel(), ...ch } as ModelChannel
}

// ── 响应解码（还原为旧 JSON 字段名对象） ──

export function decodeResponse(cmdId: number, status: number, data: Uint8Array): Record<string, unknown> | null {
  const name = cmdIdToName(cmdId)
  if (status !== STATUS_OK) {
    // F-28: OTA_CHUNK 的失败响应仍带 u32「期望 offset」—— 主机据此从该处重传
    if (cmdId === CMD.OTA_CHUNK && data.length >= 4) {
      const rerr = new Reader(data)
      return { cmd: name, ok: false, error: statusText(status), status, expected_offset: rerr.u32() }
    }
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
      case CMD.GET_LINK_STATS: return decodeLinkStats(r, name)
      case CMD.ELRS_LIST_FIELDS: return decodeElrsFields(r, name)
      case CMD.OTA_BEGIN:
        return { cmd: name, ok: true, chunk_hint: r.u16(), partition_size: r.u32(), label: r.str() }
      case CMD.OTA_CHUNK:
        return { cmd: name, ok: true, total_written: r.u32(), this_chunk: r.u32() }
      case CMD.OTA_FINISH:
        return { cmd: name, ok: true, total_written: r.u32(), message: r.str() }
      // ── 外部模块烧录会话（§5.14）──
      case CMD.ELRS_FLASH_BEGIN:
        return {
          cmd: name,
          ok: true,
          chunk_hint: r.u16(),
          block_size: r.u32(),
          image_size: r.u32(),
          target_flash_size: r.u32(),
          // 尾字段: 整片擦除耗时(0=未做整片擦除)。旧固件无此字段, 缺失按 0 处理
          erase_ms: r.remaining >= 4 ? r.u32() : 0,
        }
      case CMD.ELRS_FLASH_CHUNK:
        return { cmd: name, ok: true, accepted_total: r.u32(), written_total: r.u32() }
      case CMD.ELRS_FLASH_FINISH:
        return {
          cmd: name,
          ok: true,
          total_written: r.u32(),
          chunks: r.u32(),
          elapsed_ms: r.u32(),
          md5_ok: !!r.u8(),
          error: r.remaining >= 1 ? r.str() : '',
        }
      case CMD.STREAM_START:
        return { cmd: name, content_type: r.u8(), interval_ms: r.u16(), flags: r.u8() }
      case CMD.SET_TELEM2:
        // 回显生效后的掩码 (bit0=USB, bit1=BLE)
        // 注: 非 OK 状态已在 decodeResponse() 入口提前返回, 故此处读到的一定是成功回显。
        //     固件对 mask==0x03 返回 S_BAD_PARAM (自锁保护), 前端会走错误分支而非解析出假掩码。
        return { cmd: name, ok: true, telem2_mask: r.u8() }
      case CMD.MAVLINK_LINK_STATS:
        // §5.12 桥视角链路快照：RF 字段(ul_*/dl_*) + 桥自身下行(手柄 → GCS)出口统计
        return decodeMavlinkLinkStats(r, name)
      case CMD.SET_LOCK_ZERO:
        // 回显生效后的开关值
        return { cmd: name, ok: true, lock_zero_imu: r.u8() !== 0 }
      // ── 配置备份 / 还原（§5.15）──
      case CMD.CONFIG_EXPORT_BEGIN:
        return {
          cmd: name, ok: true,
          total_len: r.u32(),
          chunk_hint: r.u16(),
          item_count: r.u8(),
        }
      case CMD.CONFIG_EXPORT_CHUNK: {
        // payload: u32 offset + 原始 JSON 字节
        const offset = r.u32()
        return { cmd: name, ok: true, offset, bytes: data.subarray(r.offset) }
      }
      case CMD.CONFIG_IMPORT_BEGIN:
        return { cmd: name, ok: true, chunk_hint: r.u16() }
      case CMD.CONFIG_IMPORT_CHUNK:
        return { cmd: name, ok: true, accepted_total: r.u32() }
      case CMD.CONFIG_IMPORT_APPLY:
        return { cmd: name, ok: true, item_count: r.u8(), message: r.str() }
      default:
        return { cmd: name, ok: true }
    }
  } catch {
    return { cmd: name, ok: false, error: '响应解析失败' }
  }
}

function statusText(status: number): string {
  switch (status) {
    case 0: return 'OK'
    case 1: return '未知命令'
    case 2: return '参数错误'
    case 3: return 'NVS 读写失败'
    case 4: return '设备忙' // 字段未就绪/未找到
    case 5: return 'CRC 错误'
    case 6: return '序号错误'
    case 7: return '大小错误'
    case 8: return '不支持'
    case 9: return '内部错误'
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
    else if (tag === 0x05) cfg.telem2_mask = rr.u8()
    else if (tag === 0x06) cfg.lock_zero_imu = rr.u8() !== 0
    else if (tag >= 0x10 && tag <= 0x17) {
      const slot = tag - 0x10
      // 固件仅回模型名 str（完整通道数据经 GET_MODEL 按需拉取）
      ;(cfg.models as ModelConfig[])[slot] = { name: new Reader(value).str(), channels: [], curve_enabled: true }
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

function readCurveData(r: Reader): Record<string, number> {
  return { x1: r.i8(), y1: r.i8(), x2: r.i8(), y2: r.i8() }
}

function decodeCalGet(r: Reader, name: string): Record<string, unknown> {
  const adc: Record<string, unknown> = {
    trigger: readCalData(r),
    joy_x: readCalData(r),
    joy_y: readCalData(r),
    trigger_curve: readCurveData(r),
    joy_x_curve: readCurveData(r),
    joy_y_curve: readCurveData(r),
    imu_roll_curve: readCurveData(r),
    imu_pitch_curve: readCurveData(r),
    imu_yaw_curve: readCurveData(r),
  }
  return {
    cmd: name,
    adc,
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
    battery_level: r.u8(), // 电量档位 0~4 (0=空 4=满, 每档约 20% 容量)
    vbus_mv: r.u16(),
    sys_mv: r.u16(),
    temp: r.i16() / 10,
    charge_current_ma: r.u16(),
    irq_count: r.u32(),
    activity_src: r.u8(), // 活动源位掩码 (复用原 debug_mode 占位字节; 必须在 irq_count 之后读, 与固件布局一致)
    idle_s: r.u16(),
    vbus_type: r.u8(),
    idpm_limit_ma: r.u16(),
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
    r.u8()  // rf_mode: 协议占位, 前端不再消费, 必须读取以保持字节对齐
    out.tx_power = r.u8()
  }
  return out
}

/**
 * §5.12 MAVLINK_LINK_STATS 响应（38 字节）。
 * 读取顺序必须严格为线上字段顺序：valid / last_update_ms / link_age_ms / ul_* / 链路属性 / dl_* / 5×u32。
 * 注意方向语义：ul_* = RF 链路上行(手柄 → 飞控)，dl_* = RF 链路下行(飞控 → 手柄)，
 * 后 5 个 u32 才是桥自身下行(手柄 → GCS)出口统计。
 */
function decodeMavlinkLinkStats (r: Reader, name: string): Record<string, unknown> {
  const valid = !!r.u8()
  const lastUpdateMs = r.u32()
  const linkAgeMs = r.u32()
  return {
    cmd: name,
    ok: true,
    valid,
    last_update_ms: lastUpdateMs,
    link_age_ms: valid ? linkAgeMs : null, // 固件在 valid=0 时回 0xFFFFFFFF
    // RF 链路上行（手柄 → 飞控）
    ul_rssi: r.i8(),
    ul_lq: r.u8(),
    ul_snr: r.i8(),
    ul_tx_power: r.u8(),
    active_antenna: r.u8(),
    rf_mode: r.u8(),
    // RF 链路下行（飞控 → 手柄）
    dl_rssi: r.i8(),
    dl_lq: r.u8(),
    dl_snr: r.i8(),
    // 桥自身下行出口（手柄 → GCS）
    radio_status_count: r.u32(),
    link_node_status_count: r.u32(),
    downlink_msg_count: r.u32(),
    downlink_bytes: r.u32(),
    tx_rate_bps: r.u32(),
  }
}

/** 清理 ELRS 字段文本：剔除非法解码残留（U+FFFD）与不可见控制字符，并去除首尾空白 */
function sanitizeFieldText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, '').trim()
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
      name: sanitizeFieldText(r.str()),
      unit: sanitizeFieldText(r.str()),
    }
    if (f.value_valid) {
      f.value = r.i32()
      f.text = sanitizeFieldText(r.str())
    }
    if (f.type === 9) {
      const optCount = r.u8()
      if (optCount > 0) {
        const opts: string[] = []
        for (let j = 0; j < optCount; j++) opts.push(sanitizeFieldText(r.str()))
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
      case STREAM_CHANNELS: {
        // 帧内首字节为 START 回显的 flags（文档 §5.11），覆盖本地缓存
        const frameFlags = dataBytes.length > 0 ? new Reader(dataBytes).u8() : streamFlags
        return { evt: eventId, contentType, data: decodeChannels(dataBytes.subarray(1), frameFlags) }
      }
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
  // 长度校验: 短帧直接判废, 避免把缺失字节静默读成 0 (source 会假性显示成 NONE)
  const valueLen = packed ? 22 : 32
  const need = valueLen + (withSources ? 16 : 0)
  if (bytes.length < need) {
    throw new Error(`通道帧长度不足: 需要 ${need}B, 实际 ${bytes.length}B`)
  }
  const channels: number[] = []
  if (packed) {
    channels.push(...unpack11bit(bytes.subarray(0, 22), 16))
  } else {
    const r = new Reader(bytes)
    for (let i = 0; i < 16; i++) channels.push(r.u16())
  }
  let sources: string[] | undefined
  if (withSources) {
    sources = []
    for (let i = 0; i < 16; i++) sources.push(sourceFromId(bytes[valueLen + i] ?? 0))
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

/** RAW+IMU 事件：u16 trigger, u16 joy_x, u16 joy_y, i16 roll/pitch/yaw, i16 acc_x/y/z, i16 rate_x/y/z（×100/×10 定点）。
 *  固件 acc/rate 为传感器原始轴，这里按 AHRS installMap {2,0,1} 重映射：新X←原Z, 新Y←原X, 新Z←原Y */
function decodeRawImu(bytes: Uint8Array): Record<string, unknown> {
  const r = new Reader(bytes)
  const raw = { trigger: r.u16(), joy_x: r.u16(), joy_y: r.u16() }
  const roll = r.i16() / 100
  const pitch = r.i16() / 100
  const yaw = r.i16() / 100
  const accX = r.i16() / 100
  const accY = r.i16() / 100
  const accZ = r.i16() / 100
  const rateX = r.i16() / 10
  const rateY = r.i16() / 10
  const rateZ = r.i16() / 10
  return {
    raw,
    imu: {
      roll,
      pitch,
      yaw,
      acc: { x: accZ, y: accX, z: accY },     // 轴映射 {2,0,1}
      rate: { x: rateZ, y: rateX, z: rateY }, // 轴映射 {2,0,1}
    },
  }
}

export const STREAM_EVENT_ID = EVENT_STREAM_DATA
