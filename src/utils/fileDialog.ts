/**
 * fileDialog.ts — 配置备份文件的保存 / 读取
 *
 * Electron 环境走系统对话框（可自选路径），非 Electron（浏览器）降级为
 * Blob 下载 + <input type="file">，两种壳都能完成备份与还原。
 */

const JSON_FILTERS = [{ name: 'JSON 配置', extensions: ['json'] }]

/** Electron 文件对话框是否可用 */
export function hasFileDialog (): boolean {
  return !!window.electronSerialAPI?.saveTextFile
}

/** 保存文本文件；返回是否实际写入（用户取消返回 false） */
export async function saveTextFile (defaultName: string, text: string): Promise<boolean> {
  const api = window.electronSerialAPI
  if (api?.saveTextFile) {
    const res = await api.saveTextFile({ defaultName, text, filters: JSON_FILTERS })
    if (!res.success && !res.canceled) {
      throw new Error(res.error ?? '保存失败')
    }
    return !!res.success
  }
  // 浏览器降级：Blob 下载
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/** 打开文本文件；返回内容与文件名，用户取消返回 null */
export async function openTextFile (): Promise<{ text: string, name: string } | null> {
  const api = window.electronSerialAPI
  if (api?.openTextFile) {
    const res = await api.openTextFile({ filters: JSON_FILTERS })
    if (!res.success) {
      if (res.canceled) {
        return null
      }
      throw new Error(res.error ?? '读取失败')
    }
    const name = res.path ? String(res.path).split(/[\\/]/).pop() || 'config.json' : 'config.json'
    return { text: res.text ?? '', name }
  }
  return await openViaInputElement()
}

function openViaInputElement (): Promise<{ text: string, name: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve({ text: String(reader.result ?? ''), name: file.name }))
      reader.addEventListener('error', () => reject(new Error('文件读取失败')))
      reader.readAsText(file, 'utf8')
    })
    input.click()
  })
}
