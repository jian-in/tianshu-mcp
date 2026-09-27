<script setup lang="ts">
/**
 * 数据目录选择器（概览顶栏内）：自动探测 + 手动多目录切换 / 追加 / 移除。
 *
 * 保留原生 `<select>`：跨 Windows/macOS 的稳定性与可访问性优先，样式由 `.select` 统一提供。
 */
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { addDataHome, app, removeDataHome, setActiveDataHome } from "@/stores/app";

const { t } = useI18n();

const entries = computed(() => app.dataHome.entries);

async function onChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  await setActiveDataHome(value);
}
</script>

<template>
  <div class="inline">
    <AppIcon name="folder" />
    <select
      class="select select-path"
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
</template>