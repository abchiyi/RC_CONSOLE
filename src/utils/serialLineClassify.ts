/**
 * ESP32 串口行分类（JSON / ESP_LOG / crash / boot）
 *
 * 固件背景：
 * - ESP32-S3 的 USB Serial/JTAG 通道同时承载 JSON 协议数据 + ESP_LOG 输出
 *   (sdkconfig: CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG=y)
 * - JSON 由 cJSON_PrintUnformatted() 生成，始终单行、{ 开头 } 结尾
 * - ESP_LOG 格式: X (timestamp) TAG: message (X∈{E,W,I,D,V})
 */

/** 分类结果 */
export type LineClass = 'json' | 'esp_log' | 'crash' | 'boot' | 'unknown'

const ESP_LOG_RE = /^[EWIDV] \(\d+\) \w+:/
const HEX_ADDR_RE = /^0x4[0-9a-f]{7}/i
const BOOT_PREFIXES = [
  'ESP-ROM:', 'Build:', 'rst:', 'load:',
  'entry ', 'ho ', 'SPIWP:', 'mode:',
  'clk_drv:', 'waiting',
]

/**
 * 对固件串口输出的每一行进行分类
 */
export function classifyLine(line: string): LineClass {
  // 1) JSON 协议数据 —— { 开头 + } 结尾（cJSON_PrintUnformatted 保证）
  if (line.startsWith('{') && line.endsWith('}')) return 'json'

  // 2) ESP_LOG 标准格式 —— X (timestamp) TAG: message
  if (ESP_LOG_RE.test(line)) return 'esp_log'

  // 3) 崩溃/异常输出
  if (
    line.startsWith('Backtrace:')
    || line.includes('Guru Meditation')
    || line.includes('Panic')
    || line.startsWith('PC ')
    || line.startsWith('EXCVADDR:')
    || line.startsWith('AIO:')
    || line.startsWith('A1 ')
    || line.startsWith('A2 ')
    || (HEX_ADDR_RE.test(line) && line.length < 30)
  ) return 'crash'

  // 4) 启动引导信息
  if (BOOT_PREFIXES.some(p => line.startsWith(p))) return 'boot'
  if (line.includes('second stage bootloader')) return 'boot'

  // 5) 残余未知行
  return 'unknown'
}
