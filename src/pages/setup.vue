<template>
  <div class="setup-page">
    <!-- 强制校准向导: 全屏覆盖、无关闭出口 (mandatory)。完成全部缺失项后本页自动放行 -->
    <CalStepperGuide v-model="guideOpen" mandatory @completed="onCompleted" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CalStepperGuide from '@/components/calibration/CalStepperGuide.vue';
import { useCalibrationStore } from '@/stores/calibration';

const router = useRouter()
const cal = useCalibrationStore()

/** 强制向导开关: 挂载即打开。mandatory 下用户关不掉, 只能靠完成校准走出去 */
const guideOpen = ref(false)

/**
 * 解锁轮询 (2s)。
 * 校准完成后 cal_mask 靠固件回的 cal_get 回填, 但 BLE 链路丢帧率可观, 单靠那一次
 * 可能一直停在"未解锁"; 这里周期性重问 get_work_mode 兜底。指令是纯读, 不影响校准。
 */
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  guideOpen.value = true
  setTimeout(() => void cal.fetchCalData(), 300)
  // 实时 raw + IMU 由页面负责启停 —— 与传感器页 CalWizard 同源 (向导自身不启流),
  // 少了这一行向导里的姿态与量程条会一直是死的。
  cal.startCalDataPolling(100)
  pollTimer = setInterval(() => {
    if (cal.rfLocked === true) void cal.fetchWorkMode()
  }, 2000)
})

onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  cal.stopCalDataPolling()
  cal.stopTimers()
})

/** 四项齐全 → 放行。固件侧 rf_gate_task 会捕获同一上升沿并在运行中释放 ELRS 模块的 EN */
watch(() => cal.rfLocked, locked => {
  if (locked === false) void router.replace('/config')
})

/** 向导走完最后一步: 立刻核一次, 若仍有缺项则把原因写进提示条, 页面继续留在本页 */
function onCompleted (): void {
  void cal.fetchWorkMode().then(() => {
    if (cal.rfLocked === true) {
      const miss = cal.missingItems.join('、')
      cal.lastMessage = miss ? `仍缺：${miss}，请完成对应条目` : '校准未完成，请重试'
    }
  })
}
</script>

<style scoped>
/* 向导是 fullscreen dialog, 本页只作为挂载点与逻辑宿主 */
.setup-page {
  min-height: 100%;
}
</style>
