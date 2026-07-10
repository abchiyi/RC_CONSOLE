/**
 * Electron 主进程 - RC_CONSOLE Desktop
 *
 * 使用 serialport 替代浏览器 Web Serial API，
 * 保留完整的 JSON 行协议 + ESP_LOG 噪声过滤逻辑（同 Web 端）
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// ── 全局状态 ──
let mainWindow = null;
let serialPort = null;
let parser = null;

// ── 串口操作 ──
async function listPorts() {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      pnpId: p.pnpId || '',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
    }));
  } catch (err) {
    console.error('[Serial] list error:', err.message);
    return [];
  }
}

function connectPort(portPath, baudRate = 115200) {
  return new Promise((resolve, reject) => {
    if (serialPort && serialPort.isOpen) {
      resolve({ success: true, path: portPath });
      return;
    }

    try {
      serialPort = new SerialPort({
        path: portPath,
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false,
      });

      serialPort.open((err) => {
        if (err) {
          serialPort = null;
          reject(new Error(`打开失败: ${err.message}`));
          return;
        }

        // 使用 Readline 解析器逐行读取（固件每行以 \n 结尾）
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

        parser.on('data', (line) => {
          const trimmed = line.toString().trim();
          if (!trimmed) return;
          sendToRenderer('serial:line', trimmed);
        });

        serialPort.on('error', (err) => {
          console.error('[Serial] error:', err.message);
          sendToRenderer('serial:error', { message: err.message });
        });

        serialPort.on('close', () => {
          console.log('[Serial] closed');
          parser = null;
          sendToRenderer('serial:disconnected');
        });

        sendToRenderer('serial:connected', { path: portPath });
        resolve({ success: true, path: portPath });
      });
    } catch (err) {
      reject(new Error(`创建失败: ${err.message}`));
    }
  });
}

function disconnectPort() {
  return new Promise((resolve) => {
    if (parser) {
      parser.removeAllListeners('data');
      parser = null;
    }
    if (serialPort && serialPort.isOpen) {
      serialPort.close((err) => {
        if (err) console.error('[Serial] close error:', err.message);
        serialPort = null;
        resolve({ success: true });
      });
    } else {
      serialPort = null;
      resolve({ success: true });
    }
  });
}

function sendLine(line) {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) {
      reject(new Error('串口未连接'));
      return;
    }
    serialPort.write(line + '\n', (err) => {
      if (err) reject(new Error(`写入失败: ${err.message}`));
      else resolve({ success: true });
    });
  });
}

function isConnected() {
  return !!(serialPort && serialPort.isOpen);
}

function resetPort() {
  return new Promise((resolve, reject) => {
    if (!serialPort || !serialPort.isOpen) {
      reject(new Error('串口未连接'));
      return;
    }
    serialPort.set({ dtr: true }, (err) => {
      if (err) { reject(new Error(`DTR 置位失败: ${err.message}`)); return; }
      setTimeout(() => {
        serialPort.set({ dtr: false }, (err2) => {
          if (err2) { reject(new Error(`DTR 复位失败: ${err2.message}`)); return; }
          resolve({ success: true });
        });
      }, 100);
    });
  });
}

// ── IPC 转发 ──
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── 创建窗口 ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: 'GamePad2RC Console',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC 注册 ──
function setupIPC() {
  ipcMain.handle('serial:list', listPorts);

  ipcMain.handle('serial:connect', async (_e, { path: portPath, baudRate = 115200 }) => {
    try {
      return await connectPort(portPath, baudRate);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('serial:disconnect', disconnectPort);

  ipcMain.handle('serial:send', async (_e, line) => {
    try {
      return await sendLine(line);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('serial:isConnected', () => isConnected());

  ipcMain.handle('serial:reset', async () => {
    try { return await resetPort(); }
    catch (err) { return { success: false, error: err.message }; }
  });
}

// ── 应用生命周期 ──
app.whenReady().then(() => {
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  disconnectPort();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  disconnectPort();
});
