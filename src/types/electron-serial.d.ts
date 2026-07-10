/**
 * electronSerialAPI 类型声明（Electron preload 注入的全局对象）
 */

interface SerialPortDescriptor {
  path: string;
  manufacturer: string;
  serialNumber: string;
  pnpId: string;
  vendorId: string;
  productId: string;
}

interface ElectronSerialAPI {
  list(): Promise<SerialPortDescriptor[]>;
  connect(portPath: string, baudRate?: number): Promise<{ success: boolean; path?: string; error?: string }>;
  disconnect(): Promise<{ success: boolean }>;
  send(line: string): Promise<{ success: boolean; error?: string }>;
  isConnected(): Promise<boolean>;
  reset(): Promise<{ success: boolean; error?: string }>;
  onLine(callback: (line: string) => void): () => void;
  onConnected(callback: (data: { path: string }) => void): () => void;
  onDisconnected(callback: () => void): () => void;
  onError(callback: (data: { message: string }) => void): () => void;
}

// Web Serial API 类型声明
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface SerialPortRequestOptions {
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
}

declare global {
  interface Navigator {
    serial?: Serial;
  }
  interface Window {
    electronSerialAPI?: ElectronSerialAPI;
  }
}
