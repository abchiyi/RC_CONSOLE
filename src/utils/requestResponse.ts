/**
 * 串口请求-响应 Promise 管理工具
 * 消除 config.ts / power.ts 中重复的 _waitForResponse 模式
 *
 * 必须支持「多个命令同时等待」：历史实现是单槽（一个 cmd + 一个 resolve），
 * 一次长请求（如烧录 BEGIN 最长 60s）期间只要有别的请求调用 wait()，槽位就被顶掉，
 * 20s 超时回调发现 cmd 不匹配便既不会 resolve 也不会 reject → 该 Promise 永不落定，
 * 前端按钮永久卡 loading。故改为按命令名分槽（Map）。
 */
export class RequestResponseHandler {
  private pending = new Map<string, {
    resolve: (data?: unknown) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  /** 发起等待，返回在 tryResolve() 被调用时 resolve 的 Promise（可附带数据） */
  wait(cmd: string, timeoutMs = 3000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // 同一命令重复发起：让旧等待立刻失败，避免留下永不落定的 Promise
      this.cancel(cmd, true)
      const timer = setTimeout(() => {
        this.pending.delete(cmd)
        reject(new Error(`设备响应超时: ${cmd}`))
      }, timeoutMs)
      this.pending.set(cmd, { resolve, reject, timer })
    })
  }

  /** 尝试 resolve 等待中的 Promise，可附带任意数据给 awaiter。匹配成功返回 true */
  tryResolve(cmd: string, data?: unknown): boolean {
    const p = this.pending.get(cmd)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(cmd)
    p.resolve(data)
    return true
  }

  /** 释放某个命令的等待（supersede=true 时以错误拒绝它，否则静默取消） */
  cancel(cmd: string, supersede = false): void {
    const p = this.pending.get(cmd)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(cmd)
    if (supersede) p.reject(new Error(`同类请求被新请求取代: ${cmd}`))
  }

  /** 仍在等待的命令（兼容旧接口：任取一个；无等待返回 null） */
  get pendingCmd(): string | null {
    const first = this.pending.keys().next()
    return first.done ? null : first.value
  }
}
