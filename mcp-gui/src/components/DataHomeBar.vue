<script setup lang="ts">
/**
 * 数据目录选择器 + 「刷新」按钮（常驻侧栏导航区内，紧接「设置」下方）。
 *
 * 自动探测 + 手动多目录切换 / 追加 / 移除；「刷新」在此与数据源操作同排，
 * 使侧栏底部不再残留孤立按钮（刷新是**全局**动作，两态内容区都可用）。
 *
 * 侧栏是窄列，故为竖排形态：标签与「刷新 / 加 / 减」按钮同行，路径下拉独占一行。
 * 保留原生 `<select>`：跨 Windows/macOS 的稳定性与可访问性优先，样式由 `.select` 统一提供。
 */
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { addDataHome, app, refreshTasks, removeDataHome, setActiveDataHome } from "@/stores/app";

const { t } = useI18n();

const entries = computed(() => app.dataHome.entries);

async function onChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  await setActiveDataHome(value);
}
</script>

<template>
  <div class="rail-block">
    <div class="rail-block-head">
      <span class="field-label">{{ t("dataHome.title") }}</span>
      <span class="grow" />
      <button
        class="ibtn"
        :title="t('common.refresh')"
        :aria-label="t('common.refresh')"
        @click="refreshTasks"
      >
        <AppIcon name="refresh" />
      </button>
      <button
        class="ibtn"
        :title="t('dataHome.add')"
        :aria-label="t('dataHome.add')"
        @click="addDataHome"
      >
        <AppIcon name="folder" />
      </button>
      <button
        class="ibtn"
        :title="t('dataHome.remove')"
        :aria-label="t('dataHome.remove')"
        :disabled="entries.length <= 1"
        @click="removeDataHome(app.dataHome.active)"
      >
        <AppIcon name="close" />
      </button>
    </div>
    <select
      class="select"
      :value="app.dataHome.active"
      :title="app.dataHome.active"
      :aria-label="t('dataHome.title')"
      @change="onChange"
    >
      <option v-for="entry in entries" :key="entry.path" :value="entry.path">
        {{ entry.label || entry.path }}
      </option>
      <option v-if="entries.length === 0" value="">{{ t("dataHome.empty") }}</option>
    </select>
  </div>
</template>
