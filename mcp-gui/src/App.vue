<script setup lang="ts">
/**
 * 应用外壳：**常驻左侧栏 + 内容区**。
 *
 * 左栏（`aside.rail`）承载品牌 · 全局搜索 · 主导航 · 任务分区 · 数据目录 · 状态操作；
 * 右区（`main.stage`）是两态内容：态一 `OverviewPage`（指标仪 / 状态圆片 / 任务卡网格 / 搜索模式），
 * 态二 `WorkspacePage`（面包屑 / 摘要带 / 内容）。
 *
 * 布局契约：任务分区导航（事件流 / Agent 日志 / 验收日志 / 验收报告）**并入同一条侧栏**，
 * 页面里不存在第二层左栏；全局 `server.log` 由主导航「运行日志」承担，其形态由
 * `app.tab === "serverLog"` 派生——它一出现，任务上下文（摘要带与分区导航）即整体让位。
 */
import { computed, ref } from "vue";
import AppIcon from "./components/AppIcon.vue";
import DataHomeBar from "./components/DataHomeBar.vue";
import OverviewPage from "./components/OverviewPage.vue";
import WorkspacePage from "./components/WorkspacePage.vue";
import EventTimeline from "./components/EventTimeline.vue";
import LogViewer from "./components/LogViewer.vue";
import ReportPanel from "./components/ReportPanel.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import { useI18n } from "@/i18n";
import { isMockRuntime } from "@/api";
import { app, clearError, openTab, refreshTasks, selectTask, type TabKey } from "@/stores/app";

const { t } = useI18n();

/** 两态：概览 / 工作区 */
const view = ref<"overview" | "workspace">("overview");
/** 概览页模式（提升到外壳：侧栏搜索框聚焦即进入搜索模式） */
const overviewMode = ref<"tasks" | "search">("tasks");
const settingsOpen = ref(false);

/** 工作区的 server.log 形态，由 tab 派生（不再单设状态位） */
const isServerLog = computed(() => view.value === "workspace" && app.tab === "serverLog");
/** 任务上下文：工作区里正在看某个任务的分区 */
const isTaskView = computed(() => view.value === "workspace" && app.tab !== "serverLog");

/** 任务分区导航：仅任务态出现 */
const SECTIONS: { key: TabKey; labelKey: string; icon: string }[] = [
  { key: "events", labelKey: "tabs.events", icon: "clock" },
  { key: "agentLogs", labelKey: "tabs.agentLogs", icon: "file" },
  { key: "verifyLogs", labelKey: "tabs.verifyLogs", icon: "check" },
  { key: "reports", labelKey: "tabs.reports", icon: "archive" },
];

/** 侧栏「任务列表」：回概览页的卡片网格 */
function goOverview(): void {
  overviewMode.value = "tasks";
  view.value = "overview";
}

/** 侧栏搜索框聚焦 / 回车：切到概览页的搜索模式 */
function openSearch(): void {
  overviewMode.value = "search";
  view.value = "overview";
}

/** 概览点卡片：选中任务后进入工作区（进入后默认停在事件流） */
async function openTask(taskId: string): Promise<void> {
  await selectTask(taskId);
  if (app.tab === "search" || app.tab === "serverLog") await openTab("events");
  view.value = "workspace";
}

/** 侧栏「运行日志」：进入工作区的服务器日志形态 */
async function openServerLog(): Promise<void> {
  await openTab("serverLog");
  view.value = "workspace";
}

/** 搜索命中跳转后：按命中落在哪个分区进入工作区（形态由 tab 派生） */
function onNavigated(): void {
  view.value = "workspace";
}
</script>

<template>
  <div class="shell">
    <aside class="rail" :aria-label="t('nav.primary')">
      <div class="rail-head">
        <span class="brand">{{ t("app.name") }}</span>
      </div>

      <div class="rail-search">
        <div class="omni">
          <AppIcon name="search" size="14" />
          <input
            v-model="app.search.keyword"
            class="omni-input"
            :placeholder="t('search.title')"
            :aria-label="t('search.placeholder')"
            @focus="openSearch"
            @keyup.enter="openSearch"
          />
        </div>
      </div>

      <nav class="rail-nav">
        <button
          class="navitem"
          :class="{ 'is-on': view === 'overview' && overviewMode === 'tasks' }"
          @click="goOverview"
        >
          <AppIcon name="list" size="14" />
          <span class="grow truncate">{{ t("tasks.title") }}</span>
        </button>
        <button class="navitem" :class="{ 'is-on': isServerLog }" @click="openServerLog">
          <AppIcon name="terminal" size="14" />
          <span class="grow truncate">{{ t("tabs.serverLog") }}</span>
        </button>
        <button class="navitem" :class="{ 'is-on': settingsOpen }" @click="settingsOpen = true">
          <AppIcon name="settings" size="14" />
          <span class="grow truncate">{{ t("settings.title") }}</span>
        </button>

        <template v-if="isTaskView">
          <div class="rail-label">{{ t("nav.sections") }}</div>
          <button
            v-for="item in SECTIONS"
            :key="item.key"
            class="navitem"
            :class="{ 'is-on': app.tab === item.key }"
            @click="openTab(item.key)"
          >
            <AppIcon :name="item.icon" size="14" />
            <span class="grow truncate">{{ t(item.labelKey) }}</span>
          </button>
        </template>
      </nav>

      <div class="rail-foot">
        <DataHomeBar />
        <div class="rail-row">
          <button
            class="ibtn"
            :title="t('common.refresh')"
            :aria-label="t('common.refresh')"
            @click="refreshTasks"
          >
            <AppIcon name="refresh" />
          </button>
        </div>
        <div
          v-if="isMockRuntime"
          class="tag tone-warn rail-mock"
          :title="t('runtime.tauriUnavailable')"
        >
          {{ t("runtime.mock") }}
        </div>
      </div>
    </aside>

    <main class="stage">
      <OverviewPage
        v-if="view === 'overview'"
        v-model:mode="overviewMode"
        @open-task="openTask"
        @navigated="onNavigated"
      />

      <WorkspacePage v-else :mode="isServerLog ? 'server' : 'task'" @back="goOverview">
        <EventTimeline v-if="app.tab === 'events'" />
        <LogViewer v-else-if="app.tab === 'agentLogs'" kind="agent" :title="t('tabs.agentLogs')" />
        <LogViewer
          v-else-if="app.tab === 'verifyLogs'"
          kind="verify"
          :title="t('tabs.verifyLogs')"
        />
        <ReportPanel v-else-if="app.tab === 'reports'" />
        <LogViewer v-else kind="server" :title="t('tabs.serverLog')" />
      </WorkspacePage>

      <div v-if="app.error" class="alarm" role="alert">
        <AppIcon name="alert" />
        <span class="grow">{{ app.error }}</span>
        <button class="ibtn" :aria-label="t('common.close')" @click="clearError">
          <AppIcon name="close" />
        </button>
      </div>
    </main>

    <SettingsDrawer v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
