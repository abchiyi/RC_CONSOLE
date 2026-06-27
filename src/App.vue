<template>
  <v-app>
    <AppBar @toggle-drawer="drawer = !drawer" />

    <!-- 侧边导航 -->
    <v-navigation-drawer v-model="drawer" width="240">
      <v-list density="compact" nav>
        <v-list-item
          title="仪表盘"
          prepend-icon="mdi-view-dashboard"
          to="/"
          exact
        />
        <v-list-item
          title="通道配置"
          prepend-icon="mdi-cog"
          to="/config"
        />
        <v-list-item
          title="校准"
          prepend-icon="mdi-target"
          to="/calibration"
        />
      </v-list>

      <template #append>
        <div class="pa-4">
          <v-divider class="mb-2" />
          <div class="text-caption text-medium-emphasis">
            ESP_GamePad2RC · v0.1.0
          </div>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- 主内容区 -->
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppBar from '@/components/AppBar.vue'

const drawer = ref(true)
</script>
