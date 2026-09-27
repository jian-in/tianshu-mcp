<script setup lang="ts">
/**
 * 应用外壳：**两态式**
 *   态一 `OverviewPage` —— 任务概览（顶栏 / 指标仪 / 状态圆片 / 任务卡网格 / 搜索模式）
 *   态二 `WorkspacePage` —— 全屏工作区（面包屑 / 摘要带 / 竖排分区导航 / 内容）
 *
 * 两态切换只落在本组件的本地状态上，**不改 store**（`app.tab` 仍由 `openTab` 驱动）。
 */
import { ref } from "vue";
import AppIcon from "./components/AppIcon.vue";
import OverviewPage from "./components/OverviewPage.vue";
import WorkspacePage from "./components/WorkspacePage.vue";
import EventTimeline from "./components/EventTimeline.vue";
import LogViewer from "./components/LogViewer.vue";
import ReportPanel from "./components/ReportPanel.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import { useI18n } from "@/i18n";
import { app, clearError, openTab, selectTask } from "@/stores/app";

const { t } = useI18n();

/** 两态：概览 / 工作区 */
const view = ref<"overview" | "workspace">("overview");
/** 工作区主体：某任务的分区视图 / 全局 server.log */
const workspaceMode = ref<"task" | "server">("task");
const settingsOpen = ref(false);

/** 概览点卡片：选中任务后进入工作区（进入后默认停在事件流） */
async function openTask(taskId: string): Promise<void> {
  await selectTask(taskId);
  if (app.tab === "search" || app.tab === "serverLog") await openTab("events");
  workspaceMode.value = "task";
  view.value = "workspace";
}

/** 概览顶栏「运行日志」：进入工作区的服务器日志形态 */
async function openServerLog(): Promise<void> {
  await openTab("serverLog");
  workspaceMode.value = "server";
  view.value = "workspace";
}

/** 搜索命中跳转后：按命中落在哪个分区决定工作区形态 */
function onNavigated(): void {
  workspaceMode.value = app.tab === "serverLog" ? "server" : "task";
  view.value = "workspace";
}
</script>

<template>
  <div class="shell">
    <OverviewPage
      v-if="view === 'overview'"
      @open-task="openTask"
      @open-server-log="openServerLog"
      @open-settings="settingsOpen = true"
      @navigated="onNavigated"
    />

    <WorkspacePage v-else :mode="workspaceMode" @back="view = 'overview'">
      <EventTimeline v-if="app.tab === 'events'" />
      <LogViewer v-else-if="app.tab === 'agentLogs'" kind="agent" :title="t('tabs.agentLogs')" />
      <LogViewer v-else-if="app.tab === 'verifyLogs'" kind="verify" :title="t('tabs.verifyLogs')" />
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

    <SettingsDrawer v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>