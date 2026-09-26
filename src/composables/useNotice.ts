/**
 * useNotice — 页面级提示 (snackbar) 的统一出口
 *
 * 全站统一同一套配色，各页配合 `<v-snackbar :color="color" :timeout="timeoutMs" variant="tonal">`：
 *   success = 绿 / error = 红 / warning = 橙 / info = 蓝（默认）
 *
 * 为什么用 `variant="tonal"` 而不是默认实色填充：本项目深色主题下纯实色（尤其主色/亮绿）
 * 在大面积提示上偏刺眼，tonal 只染淡底 + 用语义色写文字/图标，观感统一且不抢视线。
 */
import { ref } from 'vue'

export type NoticeType = 'success' | 'error' | 'warning' | 'info'

export function useNotice(timeoutMs = 2500) {
  const text = ref('')
  const color = ref<NoticeType>('info')
  const visible = ref(false)

  /** 显示一条提示；type 决定配色（默认 info） */
  function show(msg: string, type: NoticeType = 'info'): void {
    text.value = msg
    color.value = type
    visible.value = true
  }

  return { text, color, visible, show, timeoutMs }
}
