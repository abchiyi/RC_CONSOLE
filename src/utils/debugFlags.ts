/**
 * 调试开关 (临时): 排查 BLE 链路刷新率
 *   true  = 仅保留固件→前端通道数据 (get_channels 轮询), 暂停其他所有数据同步
 *   false = 恢复正常同步
 */
export const CHANNEL_LINK_ONLY = true
