/**
 * Electron 主进程 - RC_CONSOLE Desktop
 *
 * 使用 serialport 替代浏览器 Web Serial API，
 * 保留完整的 JSON 行协议 + ESP_LOG 噪声过滤逻辑（同 Web 端）
 */

const { app, BrowserWindow, ipcMain, session } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const fsp = fs.promises;

// ── 全局状态 ──
let mainWindow = null;
let serialPort = null;
let parser = null;
let firmwareFlashProcess = null;

// ── 串口操作 ──
async function listPorts() {
  try {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || "",
      serialNumber: p.serialNumber || "",
      pnpId: p.pnpId || "",
      vendorId: p.vendorId || "",
      productId: p.productId || "",
    }));
  } catch (err) {
    console.error("[Serial] list error:", err.message);
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
        parity: "none",
        autoOpen: false,
      });

      serialPort.open((err) => {
        if (err) {
          serialPort = null;
          reject(new Error(`打开失败: ${err.message}`));
          return;
        }

        // 使用 Readline 解析器逐行读取（固件每行以 \n 结尾）
        parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

        parser.on("data", (line) => {
          const trimmed = line.toString().trim();
          if (!trimmed) return;
          sendToRenderer("serial:line", trimmed);
        });

        serialPort.on("error", (err) => {
          console.error("[Serial] error:", err.message);
          sendToRenderer("serial:error", { message: err.message });
        });

        serialPort.on("close", () => {
          console.log("[Serial] closed");
          parser = null;
          sendToRenderer("serial:disconnected");
        });

        sendToRenderer("serial:connected", { path: portPath });
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
      parser.removeAllListeners("data");
      parser = null;
    }
    if (serialPort && serialPort.isOpen) {
      serialPort.close((err) => {
        if (err) console.error("[Serial] close error:", err.message);
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
      reject(new Error("串口未连接"));
      return;
    }
    serialPort.write(line + "\n", (err) => {
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
      reject(new Error("串口未连接"));
      return;
    }
    serialPort.set({ dtr: true }, (err) => {
      if (err) {
        reject(new Error(`DTR 置位失败: ${err.message}`));
        return;
      }
      setTimeout(() => {
        serialPort.set({ dtr: false }, (err2) => {
          if (err2) {
            reject(new Error(`DTR 复位失败: ${err2.message}`));
            return;
          }
          resolve({ success: true });
        });
      }, 100);
    });
  });
}

function sendFirmwareLog(line) {
  if (!line) return;
  sendToRenderer("firmware:log", line);
}

function findCommandInPath(command) {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(locator, [command], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) return null;

    const match = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    return match || null;
  } catch {
    return null;
  }
}

function resolveEspTool() {
  const python = findCommandInPath("python") || findCommandInPath("python3");
  const directTool =
    findCommandInPath("esptool.py") || findCommandInPath("esptool");

  if (directTool) {
    if (directTool.toLowerCase().endsWith(".py") && python) {
      return { command: python, baseArgs: [directTool] };
    }
    return { command: directTool, baseArgs: [] };
  }

  const idfPath = process.env.IDF_PATH;
  if (idfPath && python) {
    const bundledTool = path.join(
      idfPath,
      "components",
      "esptool_py",
      "esptool",
      "esptool.py",
    );
    if (fs.existsSync(bundledTool)) {
      return { command: python, baseArgs: [bundledTool] };
    }
  }

  return null;
}

async function cleanupTempFirmware(tempDir) {
  try {
    await fsp.rm(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

async function flashFirmware({ portPath, fileName, data }) {
  if (!portPath) {
    return { success: false, error: "缺少串口路径，无法执行升级" };
  }
  if (!data) {
    return { success: false, error: "未收到固件数据" };
  }
  if (firmwareFlashProcess) {
    return { success: false, error: "已有升级任务正在执行" };
  }

  const esptool = resolveEspTool();
  if (!esptool) {
    return { success: false, error: "未找到 esptool，请先激活 ESP-IDF 环境" };
  }

  const safeName = path
    .basename(fileName || "firmware.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gamepad2rc-fw-"));
  const tempFile = path.join(
    tempDir,
    safeName.toLowerCase().endsWith(".bin") ? safeName : `${safeName}.bin`,
  );

  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await fsp.writeFile(tempFile, Buffer.from(bytes));
    await disconnectPort();

    return await new Promise((resolve) => {
      const args = [
        ...esptool.baseArgs,
        "--chip",
        "esp32s3",
        "--port",
        portPath,
        "--baud",
        "921600",
        "--before",
        "default_reset",
        "--after",
        "hard_reset",
        "write_flash",
        "0x0",
        tempFile,
      ];

      sendFirmwareLog(`[INFO] 准备刷写 ${safeName}`);
      sendFirmwareLog(`[INFO] 串口: ${portPath}`);
      sendFirmwareLog(`[INFO] esptool: ${esptool.command}`);

      const child = spawn(esptool.command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      firmwareFlashProcess = child;
      let settled = false;

      const forwardOutput = (chunk) => {
        chunk
          .toString()
          .split(/\r?\n/)
          .forEach((line) => {
            const trimmed = line.trim();
            if (trimmed) sendFirmwareLog(trimmed);
          });
      };

      const finish = async (result) => {
        if (settled) return;
        settled = true;
        firmwareFlashProcess = null;
        await cleanupTempFirmware(tempDir);
        resolve(result);
      };

      child.stdout.on("data", forwardOutput);
      child.stderr.on("data", forwardOutput);

      child.on("error", async (err) => {
        sendFirmwareLog(`[ERROR] ${err.message}`);
        await finish({
          success: false,
          error: `启动 esptool 失败: ${err.message}`,
        });
      });

      child.on("close", async (code) => {
        if (code === 0) {
          sendFirmwareLog("[INFO] 固件刷写完成");
          await finish({ success: true, message: "固件刷写完成" });
          return;
        }

        await finish({
          success: false,
          error: `固件刷写失败，esptool 退出码 ${code ?? "unknown"}`,
        });
      });
    });
  } catch (err) {
    await cleanupTempFirmware(tempDir);
    return { success: false, error: `准备固件失败: ${err.message}` };
  }
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
    title: "GamePad2RC Console",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Web Bluetooth：必须处理设备选择，否则 navigator.bluetooth.requestDevice 无弹窗
  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    if (deviceList.length === 0) {
      callback("");
      return;
    }
    const name = (d) => (d.deviceName || "").toLowerCase();
    // 优先选择 GamePad2RC，其次包含 "rc" 的设备，最后回退第一个
    const target =
      deviceList.find((d) => name(d).includes("gamepad")) ||
      deviceList.find((d) => name(d).includes("rc")) ||
      deviceList[0];
    callback(target.deviceId);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC 注册 ──
function setupIPC() {
  ipcMain.handle("serial:list", listPorts);

  ipcMain.handle(
    "serial:connect",
    async (_e, { path: portPath, baudRate = 115200 }) => {
      try {
        return await connectPort(portPath, baudRate);
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("serial:disconnect", disconnectPort);

  ipcMain.handle("serial:send", async (_e, line) => {
    try {
      return await sendLine(line);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("serial:isConnected", () => isConnected());

  ipcMain.handle("serial:reset", async () => {
    try {
      return await resetPort();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("firmware:flash", async (_e, payload) => {
    try {
      return await flashFirmware(payload);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ── 应用生命周期 ──
app.whenReady().then(() => {
  // 允许 Web Bluetooth 权限请求（设备选择由 select-bluetooth-device 事件控制）
  session.defaultSession.setBluetoothPermissionHandler((_req, callback) => {
    callback(true);
  });

  setupIPC();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  disconnectPort();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  disconnectPort();
});
