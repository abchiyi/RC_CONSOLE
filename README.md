# rc-app — 遥控器上位机

ESP-GAMEPAD-2-RC 遥控器的桌面配置工具（Web + Electron 双形态），经 **USB CDC / BLE NUS**
二进制协议与固件通讯。仓库：`ESP-GAMEPAD-2-RC`（固件，本工具的对应端）。

## 功能

| 页面 | 内容 |
|---|---|
| 遥测 | 实时通道 / 链路状态 / MAVLink 飞控遥测 |
| 配置 | 16 通道曲线 / 模型槽位（未激活时 ch7-16 与槽位切换灰显） |
| ELRS | 接收机参数读写、对频 |
| 校准 | 摇杆 / 扳机 / IMU 分步校准向导 |
| 系统 | 设备信息、激活（许可证）、固件升级（USB/BLE OTA）、电源监控 |
| 产线 | 出厂测试（系统页版本号连点 5 次进入，不占导航） |

## 许可证 / 激活

一机一码：激活对话框生成**设备ID**（31 字符），发给卖家换取 128 字符许可证串。
支持 24 小时免费体验（按设备运行时间计时）。固件侧签发工具见
`ESP-GAMEPAD-2-RC/docs/License_Fulfillment.md`。

## 开发

```bash
npm install
npm run dev            # Web 开发（浏览器 + Web Serial，http://localhost:3000）
npm run electron:dev   # Electron 开发（serialport 后端）
```

> 浏览器形态走 Web Serial API（仅 Chrome/Edge）；Electron 形态走 node serialport，
> 两者共用同一套命令层（`src/utils/commands.ts`），由 SerialService 抹平差异。

## 构建与发布

```bash
npm run build          # 类型检查 + Web 构建 → dist/（随固件打包进 ESP32 FAT 分区）
npm run electron:build           # Windows 便携版 exe → release/
npm run electron:build:installer # Windows NSIS 安装包
```

> 注意：图标使用**子集字体**（`src/assets/mdi-subset.woff2`），新增 `mdi-*` 图标后
> 必须重跑 `python scripts/mdi_subset.py`（需 fonttools + brotli），否则图标渲染空白。

## 目录结构

```
electron/        Electron 主进程（serialport 后端、窗口管理）
src/pages/       页面（文件路由：setup / config / elrs / calibration / system / telemetry / factory-test）
src/stores/      Pinia 状态（config / license / theme / ...）
src/services/    传输与服务层（SerialService 双后端抽象 / FlashService OTA）
src/utils/       协议编解码（protocol.ts 帧 + commands.ts 命令表，与固件 components/proto 对齐）
scripts/         mdi_subset.py（图标子集生成）
```

## 协议红线

`src/utils/protocol.ts` / `commands.ts` 的字段顺序与长度必须与固件
`components/protocol/protocol.h` 逐字节一致——改任何一侧都要同步另一侧并重跑真机回归。
