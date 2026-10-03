/**
 * 断开连接时的一次性清理入口
 *
 * 时机（见 App.vue）：路由已切到 /disconnected、旧页面组件已卸载之后才调用。
 *   顺序是刻意的 —— 先卸载页面（各页 onUnmounted 停轮询 / 撤流请求 / 清定时器），
 *   再清 store。若反过来，页面里的 watch 会先看到"空数据"，可能触发无意义的
 *   重算甚至向已断开的链路发命令。
 *
 * 只清本地状态，一条命令都不发：连接已断，命令无处可去；重连后由各页面
 * onMounted 重新拉取，保证新会话是干净的。
 */
import { useCalibrationStore } from './calibration'
import { useChannelStore } from './channels'
import { useConfigStore } from './config'
import { useLinkStatsStore } from './linkStats'
import { usePowerStore } from './power'
import { releaseAllStreams } from './stream'
import { useTelemetryStore } from './telemetry'

export function resetAllStores (): void {
  // 遥测：先停流（撤请求 + 停 1s 结算定时器），再清统计与解码值
  const telemetry = useTelemetryStore()
  telemetry.stop()
  telemetry.clear()

  useLinkStatsStore().reset()
  useCalibrationStore().reset()
  useConfigStore().reset()
  usePowerStore().reset()
  useChannelStore().reset()

  // 收口：清空全部流请求 + 让在飞行的 flush 回写失效（各 store 的 stop/reset 已撤过自己的）
  releaseAllStreams()
}
