<template>
  <v-dialog v-model="open" max-width="720" persistent>
    <v-card class="cal-dialog-card" rounded="lg" elevation="0">
      <v-card-item>
        <template #prepend>
          <v-avatar color="surface-variant" size="36" class="cal-avatar">
            <v-icon color="primary" size="20">mdi-wizard-hat</v-icon>
          </v-avatar>
        </template>
        <v-card-title>校准向导</v-card-title>
        <v-card-subtitle>按 IMU → 扳机 → 摇杆 的顺序完成校准</v-card-subtitle>
        <template #append>
          <v-btn icon="mdi-close" variant="text" size="small" @click="closeGuide" />
        </template>
      </v-card-item>

      <v-card-text>
        <v-stepper class="cal-stepper" v-model="step" complete-icon="mdi-check-circle" edit-icon="mdi-cog">
          <v-stepper-header>
            <v-stepper-item v-for="(t, i) in stepTitles" :key="i" :value="i" :title="t"
              :complete="i < step" :disabled="i > maxStep" />
          </v-stepper-header>

          <v-stepper-window>
            <!-- 步骤 0: 选择校准条目 -->
            <v-stepper-window-item :value="0">
              <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                勾选本次需要校准的条目，将按 IMU → 扳机 → 摇杆 的顺序执行已选项。
              </v-alert>

              <div class="cal-select-item" :class="{ 'cal-selected': selected.imu }" @click="selected.imu = !selected.imu">
                <v-checkbox v-model="selected.imu" hide-details density="compact" class="mr-1" @click.stop />
                <v-avatar color="warning" size="30" class="cal-avatar">
                  <v-icon color="white" size="16">mdi-axis-arrow</v-icon>
                </v-avatar>
                <div>
                  <div class="font-weight-bold">IMU</div>
                  <div class="text-caption text-medium-emphasis">陀螺仪零偏 + 0 点归零</div>
                </div>
              </div>

              <div class="cal-select-item" :class="{ 'cal-selected': selected.trigger }" @click="selected.trigger = !selected.trigger">
                <v-checkbox v-model="selected.trigger" hide-details density="compact" class="mr-1" @click.stop />
                <v-avatar color="primary" size="30" class="cal-avatar">
                  <v-icon color="white" size="16">mdi-gamepad-right</v-icon>
                </v-avatar>
                <div>
                  <div class="font-weight-bold">扳机</div>
                  <div class="text-caption text-medium-emphasis">扳机零位与行程范围</div>
                </div>
              </div>

              <div class="cal-select-item" :class="{ 'cal-selected': selected.joy }" @click="selected.joy = !selected.joy">
                <v-checkbox v-model="selected.joy" hide-details density="compact" class="mr-1" @click.stop />
                <v-avatar color="success" size="30" class="cal-avatar">
                  <v-icon color="white" size="16">mdi-gamepad-variant</v-icon>
                </v-avatar>
                <div>
                  <div class="font-weight-bold">摇杆</div>
                  <div class="text-caption text-medium-emphasis">摇杆 X/Y 居中与行程范围</div>
                </div>
              </div>

              <div class="d-flex justify-space-between mt-3">
                <v-btn color="grey" variant="text" @click="closeGuide">关闭</v-btn>
                <v-btn color="primary" prepend-icon="mdi-play" variant="tonal" :disabled="!anySelected"
                  @click="startSelected">开始校准</v-btn>
              </div>
            </v-stepper-window-item>

            <!-- 步骤 1: IMU (内嵌子 stepper) -->
            <v-stepper-window-item :value="1">
              <v-stepper class="cal-stepper cal-stepper-nested" v-model="imuStep" complete-icon="mdi-check-circle"
                edit-icon="mdi-cog">
                <v-stepper-header>
                  <v-stepper-item v-for="(t, i) in imuStepTitles" :key="i" :value="i" :title="t"
                    :complete="i < imuStep" :disabled="i > imuStep" />
                </v-stepper-header>

                <v-stepper-window>
                  <!-- 子步骤 0: 误差校准 (陀螺仪零偏) -->
                  <v-stepper-window-item :value="0">
                    <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                      将设备<span class="font-weight-bold">置于桌面</span>（任意姿态）<span class="font-weight-bold">保持静止</span>，自动校准陀螺仪零偏（约 6 秒）。
                    </v-alert>

                    <div class="d-flex align-center justify-space-between my-3">
                      <span class="text-caption text-medium-emphasis">校准进度</span>
                      <v-chip v-if="runningType === 'imu'" color="primary" size="small" variant="tonal">
                        <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
                        {{ calProgress }}%
                      </v-chip>
                    </div>
                    <v-progress-linear v-if="runningType === 'imu'" :model-value="calProgress" color="primary" height="6"
                      rounded />
                    <v-alert v-if="lastMessage && lastType === 'imu'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'imu' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="closeGuide">关闭</v-btn>
                      <v-btn v-if="runningType !== 'imu'" color="primary" prepend-icon="mdi-play" variant="tonal"
                        @click="startCal('imu')">开始校准</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 1: 0位校准 -->
                  <v-stepper-window-item :value="1">
                    <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                      以<span class="font-weight-bold">舒服的握持姿态</span>握稳设备（保持不动），点击"开始归零"
                      将当前姿态设为 0 点，重启后仍保持。
                    </v-alert>

                    <div class="stat-grid mt-3">
                      <div class="stat-col text-center">
                        <span class="text-caption text-medium-emphasis">Roll</span>
                        <div class="mono text-h6 font-weight-bold text-primary">{{ fmtDeg(imu.roll) }}</div>
                      </div>
                      <div class="stat-col text-center">
                        <span class="text-caption text-medium-emphasis">Pitch</span>
                        <div class="mono text-h6 font-weight-bold text-primary">{{ fmtDeg(imu.pitch) }}</div>
                      </div>
                      <div class="stat-col text-center">
                        <span class="text-caption text-medium-emphasis">Yaw</span>
                        <div class="mono text-h6 font-weight-bold text-primary">{{ fmtDeg(imu.yaw) }}</div>
                      </div>
                    </div>

                    <div v-if="imuDone" class="stat-grid mt-2">
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">偏置 X</span>
                        <div class="mono font-weight-bold text-primary">{{ fmtBias(imu.gyro_bias_x) }}</div>
                      </div>
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">偏置 Y</span>
                        <div class="mono font-weight-bold text-primary">{{ fmtBias(imu.gyro_bias_y) }}</div>
                      </div>
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">偏置 Z</span>
                        <div class="mono font-weight-bold text-primary">{{ fmtBias(imu.gyro_bias_z) }}</div>
                      </div>
                    </div>

                    <v-alert v-if="lastMessage && lastType === 'imu'" class="mt-3 py-1" density="compact"
                      :color="zeroing ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="imuStep = 0">上一步</v-btn>
                      <v-btn v-if="!zeroing" color="primary" prepend-icon="mdi-crosshairs-gps" variant="tonal"
                        @click="runZeroIMU">开始归零</v-btn>
                      <v-btn v-else color="primary" variant="tonal" disabled>
                        <v-progress-circular indeterminate size="14" width="2" class="mr-1" />归零中…
                      </v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 2: 完成 -->
                  <v-stepper-window-item :value="2">
                    <v-alert type="success" density="compact" variant="tonal" class="mb-2">
                      IMU 校准完成！误差与零点均已保存。
                    </v-alert>

                    <div class="stat-grid mt-3">
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">偏置 X</span>
                        <div class="mono font-weight-bold text-primary">{{ fmtBias(imu.gyro_bias_x) }}</div>
                      </div>
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">偏置 Y</span>
                        <div class="mono font-weight-bold text-primary">{{ fmtBias(imu.gyro_bias_y) }}</div>
                      </div>
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">偏置 Z</span>
                        <div class="mono font-weight-bold text-primary">{{ fmtBias(imu.gyro_bias_z) }}</div>
                      </div>
                    </div>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="imuStep = 1">上一步</v-btn>
                      <v-btn color="primary" prepend-icon="mdi-arrow-right" variant="tonal"
                        @click="gotoNext(1)">下一步</v-btn>
                    </div>
                  </v-stepper-window-item>
                </v-stepper-window>
              </v-stepper>
            </v-stepper-window-item>

            <!-- 步骤 2: 扳机 (内嵌子 stepper, 参考摇杆) -->
            <v-stepper-window-item :value="2">
              <v-stepper class="cal-stepper cal-stepper-nested" v-model="triggerStep"
                complete-icon="mdi-check-circle" edit-icon="mdi-cog">
                <v-stepper-header>
                  <v-stepper-item v-for="(t, i) in triggerStepTitles" :key="i" :value="i" :title="t"
                    :complete="i < triggerStep" :disabled="i > triggerStep" />
                </v-stepper-header>

                <v-stepper-window>
                  <!-- 子步骤 0: 居中采样 -->
                  <v-stepper-window-item :value="0">
                    <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                      请将扳机<span class="font-weight-bold">保持自然松开状态，不要触碰</span>，点击"开始采样"（约 1 秒）。
                    </v-alert>

                    <div class="d-flex align-center mb-1 mt-2">
                      <span class="text-caption font-weight-bold mr-2 text-primary">扳机</span>
                      <v-spacer />
                      <span class="text-caption text-medium-emphasis mr-2">raw</span>
                      <span class="mono font-weight-bold text-primary">{{ trigger.raw ?? '--' }}</span>
                    </div>
                    <div class="range-meter">
                      <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
                        <span class="mono">{{ trigger.raw_min ?? '--' }}</span>
                        <v-spacer />
                        <span class="mono text-primary">{{ trigger.raw_center ?? '--' }}</span>
                        <v-spacer />
                        <span class="mono">{{ trigger.raw_max ?? '--' }}</span>
                      </div>
                      <div class="range-track">
                        <div class="range-fill"
                          :style="{ width: rawPercent(trigger) + '%', background: triggerGradient }" />
                        <div v-if="hasRange(trigger)" class="range-deadzone" :style="deadzoneStyle(trigger)" />
                        <div v-if="hasRange(trigger)" class="range-center" :style="{ left: centerPercent(trigger) + '%' }" />
                        <div class="range-thumb" :style="{ left: rawPercent(trigger) + '%' }">
                          <div class="range-thumb-dot" />
                        </div>
                      </div>
                    </div>

                    <v-progress-linear v-if="runningType === 'trigger'" :model-value="calProgress" color="primary"
                      class="mt-3" height="6" rounded />
                    <v-alert v-if="lastMessage && lastType === 'trigger'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'trigger' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="closeGuide">取消</v-btn>
                      <v-btn v-if="runningType !== 'trigger'" color="primary" prepend-icon="mdi-play" variant="tonal"
                        @click="runTriggerStep(1)">开始采样</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 1: 行程扫描 -->
                  <v-stepper-window-item :value="1">
                    <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                      请将扳机<span class="font-weight-bold">按到行程末端，缓慢往复按压</span>，覆盖全部行程（约 4 秒）。
                    </v-alert>

                    <div class="d-flex align-center mb-1 mt-2">
                      <span class="text-caption font-weight-bold mr-2 text-primary">扳机</span>
                      <v-spacer />
                      <span class="text-caption text-medium-emphasis mr-2">raw</span>
                      <span class="mono font-weight-bold text-primary">{{ trigger.raw ?? '--' }}</span>
                    </div>
                    <div class="range-meter">
                      <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
                        <span class="mono">{{ trigger.raw_min ?? '--' }}</span>
                        <v-spacer />
                        <span class="mono text-primary">{{ trigger.raw_center ?? '--' }}</span>
                        <v-spacer />
                        <span class="mono">{{ trigger.raw_max ?? '--' }}</span>
                      </div>
                      <div class="range-track">
                        <div class="range-fill"
                          :style="{ width: rawPercent(trigger) + '%', background: triggerGradient }" />
                        <div v-if="hasRange(trigger)" class="range-deadzone" :style="deadzoneStyle(trigger)" />
                        <div v-if="hasRange(trigger)" class="range-center" :style="{ left: centerPercent(trigger) + '%' }" />
                        <div class="range-thumb" :style="{ left: rawPercent(trigger) + '%' }">
                          <div class="range-thumb-dot" />
                        </div>
                      </div>
                    </div>

                    <v-progress-linear v-if="runningType === 'trigger'" :model-value="calProgress" color="primary"
                      class="mt-3" height="6" rounded />
                    <v-alert v-if="lastMessage && lastType === 'trigger'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'trigger' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="triggerStep = 0">上一步</v-btn>
                      <v-btn v-if="runningType !== 'trigger'" color="primary" prepend-icon="mdi-play" variant="tonal"
                        @click="runTriggerStep(2)">开始采样</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 2: 完成 -->
                  <v-stepper-window-item :value="2">
                    <v-alert type="success" density="compact" variant="tonal" class="mb-2">
                      扳机校准完成！结果已保存，死区可在展示卡片中调整。
                    </v-alert>

                    <div class="d-flex align-center mb-1 mt-2">
                      <span class="text-caption font-weight-bold mr-2 text-primary">扳机</span>
                      <v-spacer />
                      <span class="text-caption text-medium-emphasis mr-2">raw</span>
                      <span class="mono font-weight-bold text-primary">{{ trigger.raw ?? '--' }}</span>
                    </div>
                    <div class="stat-grid">
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">最小</span>
                        <div class="mono font-weight-bold text-primary">{{ trigger.raw_min ?? '--' }}</div>
                      </div>
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">中心</span>
                        <div class="mono font-weight-bold text-primary">{{ trigger.raw_center ?? '--' }}</div>
                      </div>
                      <div class="stat-col">
                        <span class="text-caption text-medium-emphasis">最大</span>
                        <div class="mono font-weight-bold text-primary">{{ trigger.raw_max ?? '--' }}</div>
                      </div>
                    </div>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="triggerStep = 1">上一步</v-btn>
                      <v-btn color="primary" prepend-icon="mdi-arrow-right" variant="tonal"
                        @click="gotoNext(2)">下一步</v-btn>
                    </div>
                  </v-stepper-window-item>
                </v-stepper-window>
              </v-stepper>
            </v-stepper-window-item>

            <!-- 步骤 3: 摇杆 (内嵌子 stepper) -->
            <v-stepper-window-item :value="3">
              <v-stepper class="cal-stepper cal-stepper-nested" v-model="joyStep" complete-icon="mdi-check-circle"
                edit-icon="mdi-cog">
                <v-stepper-header>
                  <v-stepper-item v-for="(t, i) in joyStepTitles" :key="i" :value="i" :title="t"
                    :complete="i < joyStep" :disabled="i > joyStep" />
                </v-stepper-header>

                <v-stepper-window>
                  <!-- 子步骤 0: 居中采样 -->
                  <v-stepper-window-item :value="0">
                    <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                      请将摇杆<span class="font-weight-bold">保持居中不动</span>，点击"开始采样"（约 1 秒）。
                    </v-alert>

                    <template v-for="ax in joyAxes" :key="ax.key">
                      <div class="d-flex align-center mb-1 mt-2">
                        <span class="text-caption font-weight-bold mr-2" :class="'text-' + ax.color">{{ ax.label }}</span>
                        <v-spacer />
                        <span class="text-caption text-medium-emphasis mr-2">raw</span>
                        <span class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw ?? '--' }}</span>
                      </div>
                      <div class="range-meter">
                        <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
                          <span class="mono">{{ ax.data.raw_min ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono" :class="'text-' + ax.color">{{ ax.data.raw_center ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono">{{ ax.data.raw_max ?? '--' }}</span>
                        </div>
                        <div class="range-track">
                          <div class="range-fill" :style="{ width: rawPercent(ax.data) + '%', background: ax.gradient }" />
                          <div v-if="hasRange(ax.data)" class="range-deadzone" :style="deadzoneStyle(ax.data)" />
                          <div v-if="hasRange(ax.data)" class="range-center" :style="{ left: centerPercent(ax.data) + '%' }" />
                          <div class="range-thumb" :style="{ left: rawPercent(ax.data) + '%' }">
                            <div class="range-thumb-dot" />
                          </div>
                        </div>
                      </div>
                    </template>

                    <v-progress-linear v-if="runningType === 'joy_xy'" :model-value="calProgress" color="primary"
                      class="mt-3" height="6" rounded />
                    <v-alert v-if="lastMessage && lastType === 'joy_xy'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'joy_xy' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="closeGuide">取消</v-btn>
                      <v-btn v-if="runningType !== 'joy_xy'" color="success" prepend-icon="mdi-play" variant="tonal"
                        @click="runJoyStep(1)">开始采样</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 1: 行程扫描 -->
                  <v-stepper-window-item :value="1">
                    <v-alert color="primary" icon="mdi-information" density="compact" variant="tonal" class="mb-2">
                      请将摇杆<span class="font-weight-bold">推到行程两端</span>并缓慢画圈，覆盖全部范围（约 4 秒）。
                    </v-alert>

                    <template v-for="ax in joyAxes" :key="ax.key">
                      <div class="d-flex align-center mb-1 mt-2">
                        <span class="text-caption font-weight-bold mr-2" :class="'text-' + ax.color">{{ ax.label }}</span>
                        <v-spacer />
                        <span class="text-caption text-medium-emphasis mr-2">raw</span>
                        <span class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw ?? '--' }}</span>
                      </div>
                      <div class="range-meter">
                        <div class="range-scale d-flex text-caption text-medium-emphasis mb-1">
                          <span class="mono">{{ ax.data.raw_min ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono" :class="'text-' + ax.color">{{ ax.data.raw_center ?? '--' }}</span>
                          <v-spacer />
                          <span class="mono">{{ ax.data.raw_max ?? '--' }}</span>
                        </div>
                        <div class="range-track">
                          <div class="range-fill" :style="{ width: rawPercent(ax.data) + '%', background: ax.gradient }" />
                          <div v-if="hasRange(ax.data)" class="range-deadzone" :style="deadzoneStyle(ax.data)" />
                          <div v-if="hasRange(ax.data)" class="range-center" :style="{ left: centerPercent(ax.data) + '%' }" />
                          <div class="range-thumb" :style="{ left: rawPercent(ax.data) + '%' }">
                            <div class="range-thumb-dot" />
                          </div>
                        </div>
                      </div>
                    </template>

                    <v-progress-linear v-if="runningType === 'joy_xy'" :model-value="calProgress" color="primary"
                      class="mt-3" height="6" rounded />
                    <v-alert v-if="lastMessage && lastType === 'joy_xy'" class="mt-3 py-1" density="compact"
                      :color="runningType === 'joy_xy' ? 'warning' : 'success'" variant="tonal">
                      {{ lastMessage }}
                    </v-alert>

                    <div class="d-flex justify-space-between mt-3">
                      <v-btn color="grey" variant="text" @click="joyStep = 0">上一步</v-btn>
                      <v-btn v-if="runningType !== 'joy_xy'" color="success" prepend-icon="mdi-play" variant="tonal"
                        @click="runJoyStep(2)">开始采样</v-btn>
                      <v-btn v-else color="error" variant="tonal" @click="cancelCal">取消</v-btn>
                    </div>
                  </v-stepper-window-item>

                  <!-- 子步骤 2: 完成 -->
                  <v-stepper-window-item :value="2">
                    <v-alert type="success" density="compact" variant="tonal" class="mb-2">
                      校准完成！X/Y 两轴结果已保存，死区可在展示卡片中调整。
                    </v-alert>

                    <template v-for="ax in joyAxes" :key="ax.key">
                      <div class="d-flex align-center mb-1 mt-2">
                        <span class="text-caption font-weight-bold mr-2" :class="'text-' + ax.color">{{ ax.label }}</span>
                        <v-spacer />
                        <span class="text-caption text-medium-emphasis mr-2">raw</span>
                        <span class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw ?? '--' }}</span>
                      </div>
                      <div class="stat-grid">
                        <div class="stat-col">
                          <span class="text-caption text-medium-emphasis">最小</span>
                          <div class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw_min ?? '--' }}</div>
                        </div>
                        <div class="stat-col">
                          <span class="text-caption text-medium-emphasis">中心</span>
                          <div class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw_center ?? '--' }}</div>
                        </div>
                        <div class="stat-col">
                          <span class="text-caption text-medium-emphasis">最大</span>
                          <div class="mono font-weight-bold" :class="'text-' + ax.color">{{ ax.data.raw_max ?? '--' }}</div>
                        </div>
                      </div>
                    </template>

                    <div class="d-flex justify-end mt-3">
                      <v-btn color="primary" prepend-icon="mdi-check-circle" variant="tonal" @click="closeGuide">完成</v-btn>
                    </div>
                  </v-stepper-window-item>
                </v-stepper-window>
              </v-stepper>
            </v-stepper-window-item>
          </v-stepper-window>
        </v-stepper>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCalibrationStore, type AdcCal } from '@/stores/calibration'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const calStore = useCalibrationStore()
const trigger = calStore.trigger
const joyX = calStore.joyX
const joyY = calStore.joyY
const imu = calStore.imu
const { runningType, calProgress, lastMessage, lastType } = storeToRefs(calStore)

// 主 stepper: 0=选择条目 1=IMU 2=扳机 3=摇杆
const step = ref(0)
const maxStep = ref(0) // 已解锁的最大步骤 (不可跳过)
const stepTitles = ['条目', 'IMU', '扳机', '摇杆']

// 勾选的校准条目 (默认全选); 步骤号: IMU=1 扳机=2 摇杆=3
const selected = reactive({ imu: true, trigger: true, joy: true })
const anySelected = computed(() => selected.imu || selected.trigger || selected.joy)

// IMU 子 stepper: 0=误差校准 1=0位校准 2=完成
const imuStep = ref(0)
const imuStepTitles = ['误差校准', '0位校准', '完成']
const zeroing = ref(false) // 归零请求进行中 (防重入)

// 扳机子 stepper
const triggerStep = ref(0)
const triggerStepTitles = ['居中采样', '行程扫描', '完成']

// 摇杆子 stepper
const joyStep = ref(0)
const joyStepTitles = ['居中采样', '行程扫描', '完成']

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const imuDone = computed(() => imuStep.value >= 1)

// 扳机量程条渐变 (与 CalWizard 卡片一致)
const triggerGradient = 'linear-gradient(90deg, rgb(var(--v-theme-primary)), #4fc3f7)'

// 双轴量程展示 (reactive 使嵌套的 joyX/joyY ref 自动解包)
const joyAxes = reactive([
  { key: 'joy_x', label: 'X 轴', data: joyX, color: 'success', gradient: 'linear-gradient(90deg, rgb(var(--v-theme-success)), #26c6da)' },
  { key: 'joy_y', label: 'Y 轴', data: joyY, color: 'info', gradient: 'linear-gradient(90deg, rgb(var(--v-theme-info)), #29b6f6)' },
])

// 打开向导: 仅定位到正在进行的校准, 不自动启动
watch(() => props.modelValue, (v) => {
  if (!v) return
  const rt = calStore.runningType
  if (rt === 'imu') { step.value = 1; maxStep.value = 1; imuStep.value = 0; joyStep.value = 0 }
  else if (rt === 'trigger') { step.value = 2; maxStep.value = 2; imuStep.value = 0; triggerStep.value = 0; joyStep.value = 0 }
  else if (rt === 'joy_xy') { step.value = 3; maxStep.value = 3; imuStep.value = 0; triggerStep.value = 0; joyStep.value = 0 }
  else { step.value = 0; maxStep.value = 0; imuStep.value = 0; triggerStep.value = 0; joyStep.value = 0 }
})

// 校准完成 (runningType 非空 → null) 后自动推进
watch(runningType, (nv, ov) => {
  if (!props.modelValue) return
  if (ov !== null && nv === null && lastMessage.value !== '已取消') {
    if (lastType.value === 'imu' && step.value === 1) {
      imuStep.value = 1 // 误差校准完成 → 0位校准
    } else if (lastType.value === 'trigger' && step.value === 2) {
      if (triggerStep.value === 0) triggerStep.value = 1
      else if (triggerStep.value === 1) {
        triggerStep.value = 2
        maxStep.value = 2
      }
    } else if (lastType.value === 'joy_xy') {
      if (joyStep.value === 0) joyStep.value = 1
      else if (joyStep.value === 1) joyStep.value = 2
    }
  }
})

async function startCal(type: 'imu' | 'trigger'): Promise<void> {
  await calStore.startCal(type)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

async function runTriggerStep(s: 1 | 2): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCalStep('trigger', s)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

async function runJoyStep(s: 1 | 2): Promise<void> {
  if (calStore.runningType) return
  await calStore.startCalStep('joy_xy', s)
  calStore.startStatusPolling()
  calStore.startCalTimeout()
}

/** 0位校准: 等待 cal_zero_imu 响应 (store 内置 3s 超时), 成功进入完成页 */
async function runZeroIMU(): Promise<void> {
  if (zeroing.value || calStore.runningType) return
  zeroing.value = true
  try {
    const ok = await calStore.zeroIMU()
    if (ok) imuStep.value = 2
  } finally {
    zeroing.value = false
  }
}

// 返回 after 之后第一个被勾选的步骤 (IMU=1, 扳机=2, 摇杆=3), 无则 -1
function nextSelectedStep(after: number): number {
  for (const s of [1, 2, 3]) {
    if (s <= after) continue
    if ((s === 1 && selected.imu) || (s === 2 && selected.trigger) || (s === 3 && selected.joy)) return s
  }
  return -1
}

// 选择页: 跳转第一个被勾选条目
function startSelected(): void {
  const s = nextSelectedStep(0)
  if (s > 0) { step.value = s; maxStep.value = s }
}

// 当前条目完成后: 跳转下一个被勾选条目, 全部完成则关闭向导
function gotoNext(after: number): void {
  const s = nextSelectedStep(after)
  if (s === -1) { closeGuide(); return }
  step.value = s
  maxStep.value = s
  if (s === 2) triggerStep.value = 0
  else if (s === 3) joyStep.value = 0
}

async function cancelCal(): Promise<void> {
  await calStore.cancelCal()
}

function closeGuide(): void {
  if (calStore.runningType) calStore.cancelCal()
  open.value = false
}

// --- 量程计算 (与 CalWizard.vue 一致) ---
function hasRange(data: AdcCal): boolean {
  return data.raw_min !== undefined && data.raw_max !== undefined && data.raw_center !== undefined && data.raw_min !== data.raw_max
}

function rawPercent(data: AdcCal): number {
  const { raw, raw_min, raw_max } = data
  if (raw === undefined || raw_min === undefined || raw_max === undefined) return 0
  const range = raw_max - raw_min
  if (range <= 0) return 0
  return Math.max(0, Math.min(100, ((raw - raw_min) / range) * 100))
}

function centerPercent(data: AdcCal): number {
  const { raw_center, raw_min, raw_max } = data
  if (raw_center === undefined || raw_min === undefined || raw_max === undefined) return 50
  const range = raw_max - raw_min
  if (range <= 0) return 50
  return ((raw_center - raw_min) / range) * 100
}

function deadzoneStyle(data: AdcCal): Record<string, string> {
  const { deadzone, raw_min, raw_max } = data
  if (raw_min === undefined || raw_max === undefined) return {}
  const range = raw_max - raw_min
  if (range <= 0) return {}
  const half = Math.min(50, (deadzone / range) * 100)
  const c = centerPercent(data)
  const left = Math.max(0, c - half)
  return { left: left + '%', width: (Math.min(100, c + half) - left) + '%' }
}

function fmtBias(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(4)
}

function fmtDeg(v?: number): string {
  if (v === undefined || v === null) return '--'
  return v.toFixed(1) + '°'
}
</script>

<style scoped>
.cal-avatar {
  border-radius: 10px;
  border: 1px solid rgba(255, 187, 0, 0.25);
}

/* 对话框卡片: 去除默认 box-shadow, 改用边框 */
.cal-dialog-card {
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

/* stepper: 扁平, 无阴影, 边框+底色划分区域 */
.cal-stepper {
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
}
.cal-stepper-nested {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}
.cal-stepper :deep(.v-stepper-header) {
  box-shadow: none !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

/* 等宽数字字体 */
.mono {
  font-family: 'Cascadia Mono', 'Consolas', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* 量程条 */
.range-track {
  position: relative;
  height: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: visible;
}

.range-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: 8px;
  transition: width 0.1s linear;
}

.range-deadzone {
  position: absolute;
  top: -3px;
  bottom: -3px;
  background: rgba(255, 152, 0, 0.18);
  border: 1px dashed rgba(255, 152, 0, 0.5);
  border-radius: 4px;
  transition: left 0.2s, width 0.2s;
}

.range-center {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: rgba(255, 255, 255, 0.55);
  transform: translateX(-50%);
  transition: left 0.2s;
}

.range-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: left 0.1s linear;
}

.range-thumb-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  border: 2px solid #fff;
}

/* 状态数值列 */
.stat-col {
  border-radius: 10px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.stat-grid {
  display: flex;
  gap: 12px;
}

.stat-grid > .stat-col {
  flex: 1 1 0;
  min-width: 0;
}
</style>
