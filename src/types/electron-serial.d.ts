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
  onLine(callback: (line: string) => void): () => void;
  onConnected(callback: (data: { path: string }) => void): () => void;
  onDisconnected(callback: () => void): () => void;
  onError(callback: (data: { message: string }) => void): () => void;
}

declare global {
  interface Window {
    electronSerialAPI?: ElectronSerialAPI;
  }
}

export {};
