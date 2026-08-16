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
  /** 发送原始字节（二进制帧） */
  send(data: Uint8Array): Promise<{ success: boolean; error?: string }>;
  isConnected(): Promise<boolean>;
  reset(): Promise<{ success: boolean; error?: string }>;
  flashFirmware(payload: { portPath: string; fileName: string; data: ArrayBuffer | Uint8Array }): Promise<{ success: boolean; message?: string; error?: string }>;
  /** 接收原始字节流（二进制帧 + ESP_LOG 混流） */
  onData(callback: (data: Uint8Array) => void): () => void;
  onConnected(callback: (data: { path: string }) => void): () => void;
  onDisconnected(callback: () => void): () => void;
  onError(callback: (data: { message: string }) => void): () => void;
  onFirmwareLog(callback: (line: string) => void): () => void;
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

// Web Bluetooth API 最小类型声明（Electron 渲染进程 / Chromium 内核）
interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly value: DataView | null;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRequestDeviceFilter {
  services?: string[];
  name?: string;
  namePrefix?: string;
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface Bluetooth {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
}

declare global {
  interface Navigator {
    serial?: Serial;
    bluetooth?: Bluetooth;
  }
  interface Window {
    electronSerialAPI?: ElectronSerialAPI;
  }
}
