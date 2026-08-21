/**
 * binaryHandler.ts — 二进制帧统一分发
 * 三个后端（Web Serial / Electron 串口 / BLE）共用：
 * 字节流 → StreamDecoder → 帧 → (RESPONSE→decodeResponse / EVENT→decodeEvent / FRAGMENT→重组) → 对象回调
 */

import {
  StreamDecoder,
  FragmentAssembler,
  Reader,
  FRAME_RESPONSE,
  FRAME_EVENT,
  FRAME_FRAGMENT,
  type DecodedFrame,
} from './protocol'
import { decodeResponse, decodeEvent } from './commands'

export class BinaryHandler {
  readonly decoder = new StreamDecoder()
  private assembler = new FragmentAssembler()
  private objListeners = new Set<(obj: Record<string, unknown>) => void>()
  private logListeners = new Set<(line: string) => void>()
  private _streamFlags = 0
  // 调试日志节流 + EVENT 流 seq 跳号检测 (丢帧诊断)
  private lastPktLog = 0
  private pktCount = 0
  private lastStreamSeq = -1

  constructor() {
    this.decoder.onFrame(f => this.handleFrame(f))
  }

  /** 最近一次 STREAM_START 的 flags（影响通道事件解包） */
  get streamFlags(): number { return this._streamFlags }
  setStreamFlags(f: number): void { this._streamFlags = f }

  /** 注册对象回调，返回取消函数 */
  onObject(cb: (obj: Record<string, unknown>) => void): () => void {
    this.objListeners.add(cb)
    return () => this.objListeners.delete(cb)
  }

  /** 注册 crash 日志回调（ESP_LOG 文本行） */
  onLog(cb: (line: string) => void): () => void {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
  }

  feed(bytes: Uint8Array): void {
    this.decoder.feed(bytes)
  }

  private handleFrame(frame: DecodedFrame): void {
    this.pktCount++
    // EVENT 流 seq 跳号检测: 流自 STREAM_START 起 mod 256 递增, 跳号即链路丢帧
    let seqJump = false
    if (frame.type === FRAME_EVENT) {
      if (this.lastStreamSeq >= 0 && ((frame.seq - this.lastStreamSeq) & 0xff) !== 1) {
        seqJump = true
      }
      this.lastStreamSeq = frame.seq
    }
    // 调试日志节流: 仅打印指令/配置同步 RESPONSE 帧 (1s 节流);
    // STREAM 通道推送 (EVENT) 与链路统计轮询响应 (GET_LINK_STATS, 后续迁移流式) 不打印
    const now = Date.now()
    const isLinkStatsResp =
      frame.type === FRAME_RESPONSE &&
      frame.payload.length >= 3 &&
      frame.payload[1] === 0x01 && frame.payload[2] === 0x06 // cmd_id=GET_LINK_STATS (0x0601, LE)
    if (frame.type === FRAME_RESPONSE && !isLinkStatsResp && now - this.lastPktLog >= 1000) {
      console.log(
        `[PKT] type=${frame.type} flags=${frame.flags} seq=${frame.seq} len=${frame.len} data=${Array.from(frame.payload).map(b => b.toString(16).padStart(2, '0')).join(' ')}`,
      )
      this.lastPktLog = now
    }
    try {
      if (frame.type === FRAME_FRAGMENT) {
        const result = this.assembler.push(frame)
        if (result) this.handleAssembled(result.origType, result.payload)
        return
      }
      this.handleAssembled(frame.type, frame.payload)
    } catch {
      // 单帧解析失败不中断流
    }
  }

  private handleAssembled(type: number, payload: Uint8Array): void {
    if (type === FRAME_RESPONSE) {
      const r = new Reader(payload)
      const status = r.u8()
      const cmdId = r.u16()
      const data = payload.subarray(r.offset)
      const obj = decodeResponse(cmdId, status, data)
      if (obj) this.emit(obj)
    } else if (type === FRAME_EVENT) {
      const obj = decodeEvent(payload, this._streamFlags)
      if (obj) this.emit(obj)
    }
  }

  private emit(obj: Record<string, unknown>): void {
    this.objListeners.forEach(cb => { try { cb(obj) } catch { /* ignore */ } })
  }
}
