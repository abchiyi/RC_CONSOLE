import {
  ESPLoader,
  Transport,
  type FlashOptions,
  type FlashModeValues,
  type FlashFreqValues,
  type FlashSizeValues,
} from 'esptool-js'

export type { FlashModeValues, FlashSizeValues, FlashFreqValues } from 'esptool-js'

export interface FlashProgress {
  /** 已写入字节数 */
  written: number
  /** 总字节数 */
  total: number
  /** 百分比 0~100 */
  percent: number
}

/** 目标设备校验结果 */
export interface FlashTargetInfo {
  chipName: string
  flashSize: string
}

/** 烧录配置（高级选项），未提供的字段用默认值 */
export interface FlashConfig {
  /** 期望芯片型号，如 "ESP32-S3"；留空则不校验型号 */
  chipName?: string
  /** 闪存大小；具体值（如 "8MB"）时校验实际 ≥ 该值，"detect" 则自动检测 */
  flashSize?: FlashSizeValues
  /** 闪存模式 */
  flashMode?: FlashModeValues
  /** 闪存频率 */
  flashFreq?: FlashFreqValues
  /** 下载模式波特率 */
  baudrate?: number
  /** ROM 波特率 */
  romBaudrate?: number
  /** 整片擦除 */
  eraseAll?: boolean
}

const DEFAULT_CONFIG: Required<FlashConfig> = {
  chipName: 'ESP32-S3',
  flashSize: '8MB',
  flashMode: 'dio',
  flashFreq: '80m',
  baudrate: 921600,
  romBaudrate: 115200,
  eraseAll: false,
}

/** 把 esptool 的 Flash 大小字符串（如 "8MB" / "256KB"）转为字节数；无法解析返回 null */
function flashSizeToBytes(size: string | undefined): number | null {
  if (!size) return null
  const m = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$/i.exec(size.trim())
  if (!m || !m[1] || !m[2]) return null
  const n = Number(m[1])
  const unit = m[2].toUpperCase()
  if (unit === 'KB') return n * 1024
  if (unit === 'MB') return n * 1024 * 1024
  if (unit === 'GB') return n * 1024 * 1024 * 1024
  return null
}

/**
 * Web 端 esptool 烧录服务（首次烧录）
 *
 * 走 esptool-js（基于 Web Serial API），与 SerialService 的配置 / OTA 命令通道完全独立。
 * 用于首次烧录（空片 / 尚无固件的设备），因此不依赖 serial.connected，是独立的一条连接链路。
 *
 * 前置：设备必须处于 ROM 下载模式（空片/新板点连接后 ROM 会自动进入下载模式）。
 */
class FlashService {
  private transport: Transport | null = null
  private loader: ESPLoader | null = null
  private port: SerialPort | null = null
  private deviceLostCallback: (() => void) | null = null
  private serialDisconnectHandler: ((e: Event) => void) | null = null
  private config: Required<FlashConfig> = { ...DEFAULT_CONFIG }

  /** 是否已连接下载模式设备 */
  get connected(): boolean {
    return this.loader !== null
  }

  /** 连接下载模式设备，返回芯片名称；config 覆盖默认配置 */
  async connect(config?: Partial<FlashConfig>): Promise<string> {
    this.config = { ...DEFAULT_CONFIG, ...config }
    await this.disconnect()

    if (!navigator.serial) {
      throw new Error('当前浏览器不支持 Web Serial，请使用 Chrome / Edge')
    }

    const port = await navigator.serial.requestPort()
    this.port = port
    const transport = new Transport(port, false)
    const loader = new ESPLoader({
      transport,
      baudrate: this.config.baudrate,
      romBaudrate: this.config.romBaudrate,
    })

    this.transport = transport
    this.loader = loader
    this.attachDisconnectListener()

    try {
      // main() 内部完成 transport.connect + 芯片检测；设备未进下载模式会抛错
      await loader.main('default_reset')
      const { chipName } = await this.verifyTarget()
      return chipName
    } catch (e) {
      await this.disconnect()
      throw e
    }
  }

  /** 校验目标设备：按配置校验芯片型号与 Flash 大小，不匹配则拒绝 */
  private async verifyTarget(): Promise<FlashTargetInfo> {
    if (!this.loader) {
      throw new Error('尚未连接设备')
    }
    const chipName = this.loader.chip.CHIP_NAME
    if (this.config.chipName && chipName !== this.config.chipName) {
      throw new Error(`芯片不匹配：期望 ${this.config.chipName}，实际 ${chipName || '未知'}`)
    }
    const flashSize = await this.loader.detectFlashSize()
    const flashBytes = flashSizeToBytes(flashSize)
    const cfgFlashSize = this.config.flashSize
    const minBytes = (cfgFlashSize === 'detect' || cfgFlashSize === 'keep')
      ? null
      : flashSizeToBytes(cfgFlashSize)
    if (minBytes !== null && (flashBytes === null || flashBytes < minBytes)) {
      throw new Error(`Flash 不匹配：期望 ≥${cfgFlashSize}，实际 ${flashSize ?? '未知'}`)
    }
    return { chipName, flashSize }
  }

  /** 烧录固件到 0x0，onProgress 回报进度；config 覆盖部分烧录参数 */
  async writeFirmware(data: Uint8Array, onProgress?: (p: FlashProgress) => void, config?: Partial<FlashConfig>): Promise<void> {
    if (config) this.config = { ...this.config, ...config }
    if (!this.loader) {
      throw new Error('尚未连接设备')
    }
    // 烧录前兜底校验，防止 connect 后状态异常
    await this.verifyTarget()

    const options: FlashOptions = {
      fileArray: [{ data, address: 0x0 }],
      flashMode: this.config.flashMode,
      flashFreq: this.config.flashFreq,
      flashSize: this.config.flashSize,
      eraseAll: this.config.eraseAll,
      compress: true,
      reportProgress: (_fileIndex, written, total) => {
        onProgress?.({
          written,
          total,
          percent: total > 0 ? Math.round((written / total) * 100) : 0,
        })
      },
    }

    await this.loader.writeFlash(options)
  }

  /** 复位设备，让新固件启动 */
  async reset(): Promise<void> {
    if (!this.transport) return
    const t = this.transport
    try {
      // esptool-js 的 after('hard_reset') 对 USB Serial/JTAG 无效（其 HardReset 只做
      // setRTS(false)，而芯片已在运行态 EN 已为高，不会触发复位）。这里按 ESP32-S3
      // USB Serial/JTAG 约定手动硬复位：RTS→EN（复位）、DTR→GPIO0（下载模式选择）。
      // GPIO0 保持高（不进下载模式）+ EN 拉低再拉高 → 复位并启动新固件。
      await t.setDTR(false)
      await t.setRTS(true)
      await new Promise(resolve => setTimeout(resolve, 100))
      await t.setRTS(false)
    } catch {
      // 复位后 USB 会重枚举，setSignals 可能失败，忽略
    }
  }

  /** 注册设备拔出回调（传 null 清除） */
  onDeviceLost(cb: (() => void) | null): void {
    this.deviceLostCallback = cb
  }

  /** 监听 Web Serial 设备拔出事件 */
  private attachDisconnectListener(): void {
    const serial = navigator.serial
    if (!serial) return
    const handler = () => this.handleDeviceLost()
    this.serialDisconnectHandler = handler
    serial.addEventListener('disconnect', handler)
  }

  private removeDisconnectListener(): void {
    const serial = navigator.serial
    if (serial && this.serialDisconnectHandler) {
      serial.removeEventListener('disconnect', this.serialDisconnectHandler)
    }
    this.serialDisconnectHandler = null
  }

  /** 设备被拔出：清空内部状态并通知上层 */
  private handleDeviceLost(): void {
    const hadConnection = this.loader !== null
    this.transport = null
    this.loader = null
    this.port = null
    this.removeDisconnectListener()
    if (hadConnection) {
      this.deviceLostCallback?.()
    }
  }

  /** 断开连接并释放端口 */
  async disconnect(): Promise<void> {
    this.removeDisconnectListener()
    if (this.transport) {
      try {
        await this.transport.disconnect()
      } catch {
        // 端口已断开 / 设备被拔出，忽略
      }
    }
    this.transport = null
    this.loader = null
    this.port = null
  }
}

export const flashService = new FlashService()
