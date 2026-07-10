/**
 * ElectronSerialService - Electron 原生串口后端
 *
 * 接口与 SerialService 完全一致，通过 IPC 桥接 Electron 主进程的 serialport。
 * 固件响应的行解析（classifyLine）在主进程完成原始读行后，仍在这里做 JSON 过滤，
 * 保持与 Web Serial 模式一致的行为。
 */

import { classifyLine, type LineClass } from '@/utils/serialLineClassify';

export class ElectronSerialService {
  private lineListeners: Set<(line: string) => void> = new Set();
  private disconnectCallback: (() => void) | null = null;
  private cleanups: (() => void)[] = [];
  private _connected = false;
  private _portPath = '';

  static isSupported(): boolean {
    return !!window.electronSerialAPI;
  }

  private get api(): ElectronSerialAPI {
    if (!window.electronSerialAPI) {
      throw new Error('electronSerialAPI 不可用，请通过桌面应用启动');
    }
    return window.electronSerialAPI;
  }

  /** 列出可用串口 */
  async listPorts(): Promise<SerialPortDescriptor[]> {
    try {
      return await this.api.list();
    } catch {
      return [];
    }
  }

  /** 连接指定串口 */
  async connect(portPath: string, baudRate = 115200): Promise<boolean> {
    await this.disconnect();

    const result = await this.api.connect(portPath, baudRate);
    if (!result.success) {
      console.error('[ElectronSerial] connect failed:', result.error);
      return false;
    }

    this._connected = true;
    this._portPath = result.path || portPath;
    this.setupListeners();
    return true;
  }

  /** 断开串口 */
  async disconnect(): Promise<void> {
    this.cleanupListeners();
    if (this._connected) {
      try { await this.api.disconnect(); } catch { /* ignore */ }
    }
    this._connected = false;
    this._portPath = '';
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /** 发送 JSON 命令（自动添加换行符） */
  async sendCommand(cmd: string, params?: Record<string, unknown>): Promise<void> {
    if (!this._connected) return;
    const json = JSON.stringify(params ? { cmd, ...params } : { cmd });
    const line = json + '\n';
    const result = await this.api.send(line);
    if (!result.success) {
      console.error('[ElectronSerial] send error:', result.error);
    }
  }

  /** 注册行监听器（JSON + crash 行，过滤后的） */
  onLine(cb: (line: string) => void): void {
    this.addLineListener(cb);
  }

  addLineListener(cb: (line: string) => void): void {
    this.lineListeners.add(cb);
  }

  removeLineListener(cb: (line: string) => void): void {
    this.lineListeners.delete(cb);
  }

  /** 注册断开回调 */
  onDisconnect(cb: () => void): void {
    this.disconnectCallback = cb;
  }

  /** 通过 DTR 信号复位设备（硬件复位，适用于设备跑飞时） */
  async resetDevice(): Promise<boolean> {
    if (!this._connected) return false;
    const result = await this.api.reset();
    return result.success;
  }

  get portInfo(): { vid?: number; pid?: number } | null {
    // Electron serialport 模式下暂无 USB VID/PID
    return null;
  }

  // ── 内部方法 ──

  private setupListeners(): void {
    this.cleanupListeners();

    this.cleanups.push(
      this.api.onLine((line: string) => {
        if (!line) return;
        const cls: LineClass = classifyLine(line);

        if (cls !== 'json') {
          if (import.meta.env.DEV && cls !== 'unknown') {
            console.debug(`[Serial][${cls}]`, line);
          }
          // 崩溃信息始终传给 listeners
          if (cls === 'crash') {
            this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } });
          }
          return;
        }

        if (import.meta.env.DEV && line.length > 2000) {
          console.debug('[Serial] large line:', line.length, 'B',
            'preview:', line.substring(0, 80));
        }
        this.lineListeners.forEach(cb => { try { cb(line) } catch { /* ignore */ } });
      })
    );

    this.cleanups.push(
      this.api.onDisconnected(() => {
        this._connected = false;
        this._portPath = '';
        this.disconnectCallback?.();
      })
    );

    this.cleanups.push(
      this.api.onError((data) => {
        console.error('[ElectronSerial]', data.message);
      })
    );
  }

  private cleanupListeners(): void {
    this.cleanups.forEach(fn => { try { fn() } catch { /* ignore */ } });
    this.cleanups = [];
  }
}

/** Electron 模式下的全局串口服务实例 */
export const electronSerialService = new ElectronSerialService();
