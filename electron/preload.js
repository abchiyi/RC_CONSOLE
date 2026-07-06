/**
 * Electron Preload - RC_CONSOLE Desktop
 * 通过 contextBridge 安全暴露串口 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSerialAPI', {
  /** 列出可用串口 */
  list: () => ipcRenderer.invoke('serial:list'),

  /** 连接指定串口 */
  connect: (portPath, baudRate = 115200) =>
    ipcRenderer.invoke('serial:connect', { path: portPath, baudRate }),

  /** 断开串口 */
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),

  /** 发送一行数据（不含换行符） */
  send: (line) => ipcRenderer.invoke('serial:send', line),

  /** 查询连接状态 */
  isConnected: () => ipcRenderer.invoke('serial:isConnected'),

  /** 注册数据行监听（固件发送的每一行，含 JSON 和日志） */
  onLine: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('serial:line', handler);
    return () => ipcRenderer.removeListener('serial:line', handler);
  },

  /** 注册连接事件 */
  onConnected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('serial:connected', handler);
    return () => ipcRenderer.removeListener('serial:connected', handler);
  },

  /** 注册断开事件 */
  onDisconnected: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('serial:disconnected', handler);
    return () => ipcRenderer.removeListener('serial:disconnected', handler);
  },

  /** 注册错误事件 */
  onError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('serial:error', handler);
    return () => ipcRenderer.removeListener('serial:error', handler);
  },
});
