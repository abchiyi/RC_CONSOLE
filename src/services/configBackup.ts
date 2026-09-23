/**
 * configBackup.ts — 配置备份 / 还原会话（协议 §5.15）
 *
 * 传输的是**二进制快照**（config_snapshot），JSON 编解码在上位机
 * （utils/configSnapshot.ts）完成 —— 设备端因此不需要 cJSON，也不会
 * 因为 8×16 通道的 JSON 树耗尽堆而 abort。
 *
 * 会话式分块：BEGIN → CHUNK × N → END / APPLY，与 OTA 同一节奏
 * （逐条命令等待响应，天然限速，避免 BLE 侧分片交错）。
 */
import {
  bleService,
  electronSerialService,
  serialService,
  webSerialService,
} from '@/services/SerialService'
import { crc16 } from '@/utils/protocol'
import { RequestResponseHandler } from '@/utils/requestResponse'

/** 单块上限（固件会夹到 chunk_hint=2048，这里再留一档保险） */
const MAX_CHUNK = 2048
/** 导入快照大小上限，与固件 kImportMaxBytes 一致 */
const IMPORT_MAX_BYTES = 128 * 1024

export interface BackupProgress {
  done: number
  total: number
}

const rr = new RequestResponseHandler()

// 后端可切换（USB / Electron 串口 / BLE），对每个后端都注册，否则切换后收不到响应
let registered = false
function ensureRegistered (): void {
  if (registered) {
    return
  }
  registered = true
  const onObject = (obj: Record<string, unknown>): void => {
    const cmd = obj.cmd
    if (typeof cmd !== 'string') {
      return
    }
    if (!cmd.startsWith('config_export') && !cmd.startsWith('config_import')) {
      return
    }
    // 失败响应（ok:false）也要 resolve，由 send() 转成异常抛出
    rr.tryResolve(cmd, obj)
  }
  for (const svc of [serialService, webSerialService, electronSerialService, bleService]) {
    svc.onObject(onObject)
  }
}

/** 发一条命令并等待其响应；设备返回非 OK 时抛出 */
async function send (
  cmd: string,
  params?: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  ensureRegistered()
  const promise = rr.wait(cmd, timeoutMs)
  await serialService.sendCommand(cmd, params)
  const res = (await promise) as Record<string, unknown> | undefined
  if (!res) {
    throw new Error(`设备响应超时: ${cmd}`)
  }
  if (res.ok === false) {
    const err = res.error ?? res.message ?? `设备拒绝: ${cmd}`
    throw new Error(String(err))
  }
  return res
}

/** 从设备导出完整配置快照（二进制） */
export async function exportSnapshot (
  onProgress?: (p: BackupProgress) => void,
): Promise<Uint8Array> {
  const begin = await send('config_export_begin', { flags: 0 }, 30_000)
  const total = Number(begin.total_len ?? 0)
  const hint = Math.min(Number(begin.chunk_hint ?? MAX_CHUNK) || MAX_CHUNK, MAX_CHUNK)
  if (total <= 0) {
    throw new Error('设备返回的配置为空')
  }

  const out = new Uint8Array(total)
  let off = 0
  try {
    while (off < total) {
      const want = Math.min(hint, total - off)
      const res = await send('config_export_chunk', { offset: off, want }, 20_000)
      const bytes = res.bytes
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        throw new Error(`导出中断: offset=${off} 未收到数据`)
      }
      const gotOffset = Number(res.offset ?? off)
      if (gotOffset !== off) {
        throw new Error(`导出分片错位: 期望 ${off}, 收到 ${gotOffset}`)
      }
      out.set(bytes, off)
      off += bytes.length
      onProgress?.({ done: off, total })
    }
  } finally {
    // 无论成败都结束会话，释放设备侧缓冲
    try {
      await send('config_export_end', undefined, 5000)
    } catch { /* 已结束或超时：忽略 */ }
  }

  return out
}

/** 把快照（二进制）整体还原到设备（整体替换语义，见 §5.15） */
export async function importSnapshot (
  data: Uint8Array,
  onProgress?: (p: BackupProgress) => void,
): Promise<void> {
  if (data.length === 0) {
    throw new Error('快照为空')
  }
  if (data.length > IMPORT_MAX_BYTES) {
    throw new Error('快照过大 (>128KB)')
  }

  const begin = await send(
    'config_import_begin',
    { total_len: data.length, crc16: crc16(data), flags: 0 },
    20_000,
  )
  const hint = Math.min(Number(begin.chunk_hint ?? MAX_CHUNK) || MAX_CHUNK, MAX_CHUNK)

  for (let off = 0; off < data.length; off += hint) {
    const slice = data.subarray(off, Math.min(off + hint, data.length))
    await send('config_import_chunk', { offset: off, data: slice }, 20_000)
    onProgress?.({ done: Math.min(off + hint, data.length), total: data.length })
  }

  // 校验 + 应用 + 落 NVS，设备侧耗时较长
  await send('config_import_apply', undefined, 30_000)
}
