/**
 * Electron Preload - RC_CONSOLE Desktop
 * 通过 contextBridge 安全暴露串口 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronSerialAPI", {
  /** 列出可用串口 */
  list: () => ipcRenderer.invoke("serial:list"),

  /** 连接指定串口 */
  connect: (portPath, baudRate = 115200) =>
    ipcRenderer.invoke("serial:connect", { path: portPath, baudRate }),

  /** 断开串口 */
  disconnect: () => ipcRenderer.invoke("serial:disconnect"),

  /** 发送原始字节（二进制帧） */
  send: (data) => ipcRenderer.invoke("serial:send", data),

  /** 查询连接状态 */
  isConnected: () => ipcRenderer.invoke("serial:isConnected"),

  /** 通过 DTR 信号复位设备（用于设备跑飞时硬件复位） */
  reset: () => ipcRenderer.invoke("serial:reset"),

  /** 刷写固件（仅桌面端） */
  flashFirmware: (payload) => ipcRenderer.invoke("firmware:flash", payload),

  /** 注册原始字节流监听（二进制帧 + ESP_LOG 混流） */
  onData: (callback) => {
    const handler = (_event, data) => {
      if (data instanceof ArrayBuffer) {
        callback(new Uint8Array(data));
      } else if (ArrayBuffer.isView(data)) {
        callback(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      } else if (typeof data === "string") {
        callback(new TextEncoder().encode(data));
      }
    };
    ipcRenderer.on("serial:data", handler);
    return () => ipcRenderer.removeListener("serial:data", handler);
  },

  /** 注册连接事件 */
  onConnected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("serial:connected", handler);
    return () => ipcRenderer.removeListener("serial:connected", handler);
  },

  /** 注册断开事件 */
  onDisconnected: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("serial:disconnected", handler);
    return () => ipcRenderer.removeListener("serial:disconnected", handler);
  },

  /** 注册错误事件 */
  onError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("serial:error", handler);
    return () => ipcRenderer.removeListener("serial:error", handler);
  },

  /** 固件刷写日志 */
  onFirmwareLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on("firmware:log", handler);
    return () => ipcRenderer.removeListener("firmware:log", handler);
  },
});
