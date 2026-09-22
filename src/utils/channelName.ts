/**
 * 通道命名唯一真源 (Single Source of Truth)
 *
 * 约定:
 * - 内部索引 (数组下标 / 协议字段) 一律保持 0 起始 (0..15), 本模块不改协议语义
 * - 面向用户的通道号一律 1 起始 (CH1..CH16)
 * - 主名称: CH1=A, CH2=E, CH3=R, CH4=T; CH5 起为 AUX 序列 (CH5=AUX1 ... CH16=AUX12)
 * - 副名称: 1 起始通道号, 弱化显示, 形如 "AUX1 · CH5"
 */

export const CHANNEL_COUNT = 16

/**
 * 安全锁固定监视的通道索引 (0 起始): CH5 / AUX1
 * 该通道本身作为解锁控制源, 不提供安全锁开关 (自锁会抖动)
 */
export const LOCK_CHANNEL_INDEX = 4

/** 前 4 路主名称: 副翼(A) / 升降(E) / 方向(R) / 油门(T) */
const PRIMARY_NAMES = ['A', 'E', 'R', 'T'] as const

function isValid(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CHANNEL_COUNT
}

/** 1 起始通道号标签: 0 -> 'CH1', 15 -> 'CH16' */
export function channelNumberLabel(index: number): string {
  return isValid(index) ? `CH${index + 1}` : 'CH?'
}

/** 主名称: 0..3 -> 'A'|'E'|'R'|'T'; 4..15 -> 'AUX1'..'AUX12' */
export function channelPrimaryName(index: number): string {
  if (!isValid(index)) return 'CH?'
  return index < PRIMARY_NAMES.length ? PRIMARY_NAMES[index]! : `AUX${index - 3}`
}

/** 纯文本完整名: 'AUX1 · CH5' (下拉 title / snackbar / store label 等纯文本场景) */
export function channelDisplayName(index: number): string {
  return `${channelPrimaryName(index)} · ${channelNumberLabel(index)}`
}
