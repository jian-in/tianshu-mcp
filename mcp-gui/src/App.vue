<script setup lang="ts">
/**
 * 应用外壳：顶栏（品牌 / 数据目录 / 全局动作）+ 三栏（任务列表 · 内容区 · 详情）。
 *
 * 视觉契约：顶部 1px 强调色细线是全局唯一的记忆点；标签栏用下划线指示器而不是药丸。
 */
import { ref } from "vue";
import AppIcon from "./components/AppIcon.vue";
import DataHomeBar from "./components/DataHomeBar.vue";
import TaskListPanel from "./components/TaskListPanel.vue";
import DetailPanel from "./components/DetailPanel.vue";
import EventTimeline from "./components/EventTimeline.vue";
import LogViewer from "./components/LogViewer.vue";
import ReportPanel from "./components/ReportPanel.vue";
import SearchPanel from "./components/SearchPanel.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import { useI18n } from "@/i18n";
import { isMockRuntime } from "@/api";
import { app, clearError, openTab, refreshTasks, type TabKey } from "@/stores/app";

const { t } = useI18n();
const settingsOpen = ref(false);

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: "events", labelKey: "tabs.events" },
  { key: "agentLogs", labelKey: "tabs.agentLogs" },
  { key: "verifyLogs", labelKey: "tabs.verifyLogs" },
  { key: "reports", labelKey: "tabs.reports" },
  { key: "serverLog", labelKey: "tabs.serverLog" },
  { key: "search", labelKey: "tabs.search" },
];

/** ←/→ 在标签之间移动焦点并切换（键盘可达性） */
function onTabKey(event: KeyboardEvent, index: number): void {
  const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (delta === 0) return;
  event.preventDefault();
  const nextIndex = (index + delta + TABS.length) % TABS.length;
  const next = TABS[nextIndex];
  if (!next) return;
  openTab(next.key);
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
    '[role="tab"]',
  );
  buttons?.[nextIndex]?.focus();
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-brand">
        <span class="brand-mark"><AppIcon name="terminal" size="13" /></span>
        <span>{{ t("app.name") }}</span>
      </div>
      <DataHomeBar />
      <span class="app-header-spacer" />
      <span v-if="isMockRuntime" class="badge tone-warn" :title="t('runtime.tauriUnavailable')">
        {{ t("runtime.mock") }}
      </span>
      <div class="app-header-actions">
        <button
          class="btn btn-icon"
          :title="t('common.refresh')"
          :aria-label="t('common.refresh')"
          @click="refreshTasks"
        >
          <AppIcon name="refresh" />
        </button>
        <button
          class="btn btn-icon"
          :title="t('settings.title')"
          :aria-label="t('settings.title')"
          @click="settingsOpen = true"
        >
          <AppIcon name="settings" />
        </button>
      </div>
    </header>

    <div v-if="app.error" class="notice notice-error app-notice" role="alert">
      <AppIcon name="alert" />
      <span class="grow">{{ app.error }}</span>
      <button class="btn btn-icon" :aria-label="t('common.close')" @click="clearError">
        <AppIcon name="close" />
      </button>
    </div>

    <main class="app-body">
      <TaskListPanel />

      <section class="pane">
        <header class="pane-header">
          <div class="tabbar" role="tablist">
            <button
              v-for="(tab, index) in TABS"
              :key="tab.key"
              class="tab"
              role="tab"
              type="button"
              :class="{ 'is-active': app.tab === tab.key }"
              :aria-selected="app.tab === tab.key"
              :tabindex="app.tab === tab.key ? 0 : -1"
              @click="openTab(tab.key)"
              @keydown="onTabKey($event, index)"
            >
              {{ t(tab.labelKey) }}
            </button>
          </div>
        </header>

        <EventTimeline v-if="app.tab === 'events'" />
        <LogViewer v-else-if="app.tab === 'agentLogs'" kind="agent" :title="t('tabs.agentLogs')" />
        <LogViewer v-else-if="app.tab === 'verifyLogs'" kind="verify" :title="t('tabs.verifyLogs')" />
        <LogViewer v-else-if="app.tab === 'serverLog'" kind="server" :title="t('tabs.serverLog')" />
        <ReportPanel v-else-if="app.tab === 'reports'" />
        <SearchPanel v-else />
      </section>

      <DetailPanel />
    </main>

    <SettingsDrawer v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>