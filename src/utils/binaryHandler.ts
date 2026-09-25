/**
 * binaryHandler.ts — 二进制帧统一分发
 * 三个后端（Web Serial / Electron 串口 / BLE）共用：
 * 字节流 → StreamDecoder → 帧 → (RESPONSE→decodeResponse / EVENT→decodeEvent / FRAGMENT→重组) → 对象回调
 */

import { decodeEvent, decodeResponse } from './commands'
import {
  type DecodedFrame,
  FragmentAssembler,
  FRAME_EVENT,
  FRAME_FRAGMENT,
  FRAME_RESPONSE,
  Reader,
  StreamDecoder,
} from './protocol'

export class BinaryHandler {
  readonly decoder = new StreamDecoder()
  private assembler = new FragmentAssembler()
  private objListeners = new Set<(obj: Record<string, unknown>) => void>()
  private logListeners = new Set<(line: string) => void>()
  private _streamFlags = 0

  constructor () {
    this.decoder.onFrame(f => this.handleFrame(f))
  }

  /** 最近一次 STREAM_START 的 flags（影响通道事件解包） */
  get streamFlags (): number {
    return this._streamFlags
  }

  setStreamFlags (f: number): void {
    this._streamFlags = f
  }

  /** 注册对象回调，返回取消函数 */
  onObject (cb: (obj: Record<string, unknown>) => void): () => void {
    this.objListeners.add(cb)
    return () => this.objListeners.delete(cb)
  }

  /** 注册 crash 日志回调（ESP_LOG 文本行） */
  onLog (cb: (line: string) => void): () => void {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
  }

  feed (bytes: Uint8Array): void {
    this.decoder.feed(bytes)
  }

  /**
   * 重置解码器 / 分片重组器 / 流标志（断开或重连时调用，FE-04）：
   * 丢片产生的「半包」不会再随连接残留，_streamFlags 也不会跨会话沿用旧值。
   */
  reset (): void {
    this.decoder.reset()
    this.assembler.reset()
    this._streamFlags = 0
  }

  private handleFrame (frame: DecodedFrame): void {
    try {
      if (frame.type === FRAME_FRAGMENT) {
        const result = this.assembler.push(frame)
        // 重组后 seq 取最后一片的: 多分片场景下它不再等于原始请求的 seq
        if (result) {
          this.handleAssembled(result.origType, result.payload, frame.seq)
        }
        return
      }
      this.handleAssembled(frame.type, frame.payload, frame.seq)
    } catch {
      // 单帧解析失败不中断流
    }
  }

  /**
   * @param seq 帧头 seq。RESPONSE 帧的 seq 由固件原样回显请求帧（command_center.cpp
   *   dispatch_binary 构建响应时传入的正是请求帧的 seq），因此同一命令的连续多次响应
   *   （例如一轮烧录里上千次 elrs_flash_chunk）可以靠它精确区分。
   *   没有它，调用方只能按 cmd 匹配，丢帧后"迟到的旧响应"会被误当作下一次请求的应答。
   */
  private handleAssembled (type: number, payload: Uint8Array, seq: number): void {
    if (type === FRAME_RESPONSE) {
      const r = new Reader(payload)
      const status = r.u8()
      const cmdId = r.u16()
      const data = payload.subarray(r.offset)
      const obj = decodeResponse(cmdId, status, data)
      if (obj) {
        this.emit({ ...obj, seq })
      }
    } else if (type === FRAME_EVENT) {
      const obj = decodeEvent(payload, this._streamFlags)
      if (obj) {
        this.emit(obj)
      }
    }
  }

  private emit (obj: Record<string, unknown>): void {
    for (const cb of this.objListeners) {
      try {
        cb(obj)
      } catch { /* ignore */ }
    }
  }
}
