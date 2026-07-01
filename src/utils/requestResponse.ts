/**
 * 串口请求-响应 Promise 管理工具
 * 消除 config.ts / power.ts 中重复的 _waitForResponse 模式
 */
export class RequestResponseHandler {
  private resolve: (() => void) | null = null
  private cmd: string | null = null

  /** 发起等待，返回在 tryResolve() 被调用时 resolve 的 Promise */
  wait(cmd: string, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cmd = cmd
      this.resolve = resolve
      setTimeout(() => {
        if (this.cmd === cmd) {
          this.resolve = null
          this.cmd = null
          reject(new Error(`设备响应超时: ${cmd}`))
        }
      }, timeoutMs)
    })
  }

  /** 尝试 resolve 当前等待的 Promise。匹配成功返回 true */
  tryResolve(cmd: string): boolean {
    if (this.cmd === cmd && this.resolve) {
      this.resolve()
      this.resolve = null
      this.cmd = null
      return true
    }
    return false
  }

  get pendingCmd(): string | null {
    return this.cmd
  }
}
