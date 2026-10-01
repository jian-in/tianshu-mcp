<script setup lang="ts">
/**
 * 应用外壳：**常驻左侧栏 + 内容区**。
 *
 * 左栏（`aside.rail`）承载品牌 · 全局搜索 · 主导航（含「洞察」「MCP 能力」「设置」）· 数据目录（与「刷新」同排）· 任务分区（底部仅在 mock 运行时留提示条）；
 * 右区（`main.stage`）是四态内容：态一 `OverviewPage`（指标仪 / 状态圆片 / 任务卡网格 / 搜索模式），
 * 态二 `InsightsPage`（A1 效能 / A2 归因 / A3 趋势），态三 `CapabilitiesPage`（MCP 工具面只读镜像），
 * 态四 `WorkspacePage`（面包屑 / 摘要带 / 内容）。
 *
 * 布局契约：任务分区导航（事件流 / Agent 日志 / 验收日志 / 验收报告）**并入同一条侧栏**，
 * 页面里不存在第二层左栏；全局 `server.log` 由主导航「运行日志」承担，其形态由
 * `app.tab === "serverLog"` 派生——它一出现，任务上下文（摘要带与分区导航）即整体让位。
 *
 * 全局快捷键（`Ctrl/Cmd + K` 命令面板、`Ctrl/Cmd + R` 刷新）在本组件统一监听与分发；
 * 命令目录由 `@/core/palette` 装配，面板组件只派发命令 `id`（见 `CommandPalette.vue`）。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "./components/AppIcon.vue";
import BaselinePanel from "./components/BaselinePanel.vue";
import CommandPalette from "./components/CommandPalette.vue";
import DataHomeBar from "./components/DataHomeBar.vue";
import OverviewPage from "./components/OverviewPage.vue";
import InsightsPage from "./components/InsightsPage.vue";
import CapabilitiesPage from "./components/CapabilitiesPage.vue";
import WorkspacePage from "./components/WorkspacePage.vue";
import EventTimeline from "./components/EventTimeline.vue";
import LogViewer from "./components/LogViewer.vue";
import ReportPanel from "./components/ReportPanel.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import { useI18n } from "@/i18n";
import { isMockRuntime } from "@/api";
import { matchHotkey } from "@/core/hotkeys";
import { buildStaticCommands, type PaletteCommand } from "@/core/palette";
import {
  app,
  clearError,
  drainDeepLinks,
  openTab,
  refreshTasks,
  selectTask,
  setActiveDataHome,
  setError,
  subscribeDeepLinks,
  type TabKey,
} from "@/stores/app";

const { t } = useI18n();

/** 四态：概览 / 洞察 / MCP 能力 / 工作区 */
const view = ref<"overview" | "insights" | "capabilities" | "workspace">("overview");
/** 概览页模式（提升到外壳：侧栏搜索框聚焦即进入搜索模式） */
const overviewMode = ref<"tasks" | "search">("tasks");
const settingsOpen = ref(false);
/** 命令面板（`Ctrl/Cmd + K`） */
const paletteOpen = ref(false);

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
  { key: "baseline", labelKey: "tabs.baseline", icon: "baseline" },
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

/** 侧栏「MCP 能力」：静态展示工具面（不读文件系统、不连 MCP） */
function goCapabilities(): void {
  view.value = "capabilities";
}

/** 侧栏「洞察」：进页加载一次聚合（组件 onMounted 负责取数，计划 D12） */
function goInsights(): void {
  view.value = "insights";
}

/** 搜索命中跳转后：按命中落在哪个分区进入工作区（形态由 tab 派生） */
function onNavigated(): void {
  view.value = "workspace";
}

/* ---------------- 命令面板与全局快捷键 ---------------- */

/** 命令目录（导航 + 数据目录）：与输入无关，只随任务无关的数据变化重建；任务命令由面板按输入实时检索 */
const paletteCommands = computed<PaletteCommand[]>(() =>
  buildStaticCommands(t, {
    dataHomes: app.dataHome.entries.map((entry) => entry.path),
    activeHome: app.dataHome.active,
  }),
);

/** 命令派发：动作只在壳体实现（面板不知道视图状态） */
function onPaletteSelect(id: string): void {
  paletteOpen.value = false;
  if (id === "nav:overview") goOverview();
  else if (id === "nav:insights") goInsights();
  else if (id === "nav:serverLog") void openServerLog();
  else if (id === "nav:capabilities") goCapabilities();
  else if (id === "nav:search") openSearch();
  else if (id === "nav:settings") settingsOpen.value = true;
  else if (id.startsWith("task:")) void openTask(id.slice("task:".length));
  else if (id.startsWith("home:")) void setActiveDataHome(id.slice("home:".length));
}

/** 全局按键：未打开面板时认 `Ctrl/Cmd + K`（开面板）与 `Ctrl/Cmd + R`（刷新）；面板打开时只认关闭键 */
function onKeydown(event: KeyboardEvent): void {
  const action = matchHotkey(event, paletteOpen.value);
  if (action === null) return;
  // 命中即拦截，避免 `Ctrl/Cmd + R` 触发 webview 重载
  event.preventDefault();
  if (action === "paletteToggle") paletteOpen.value = !paletteOpen.value;
  else if (action === "paletteClose") paletteOpen.value = false;
  else if (action === "refresh") void refreshTasks();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

/* ---------------- A8b 深链（tianshu://task/<id>） ---------------- */

/**
 * 取走待处理深链并路由。
 *
 * Rust 侧把 URL 记入队列后发 `gui://deeplink` 信号（冷启动时事件早于本监听，故队列才是事实来源），
 * 因此「挂载时主动取一次」与「收到信号再取一次」走的是同一个函数——两条路径都不丢链接。
 */
async function drainDeepLinkQueue(): Promise<void> {
  const { target, invalid } = await drainDeepLinks();
  if (invalid.length > 0) {
    setError(t("deeplink.invalid", { url: invalid[0] ?? "" }));
  }
  if (!target) return;
  await openTask(target.taskId);
}

let unsubscribeDeepLinks: (() => void) | null = null;

onMounted(async () => {
  await drainDeepLinkQueue();
  unsubscribeDeepLinks = await subscribeDeepLinks(() => {
    void drainDeepLinkQueue();
  });
});
onUnmounted(() => {
  unsubscribeDeepLinks?.();
  unsubscribeDeepLinks = null;
});
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
        <button class="navitem" :class="{ 'is-on': view === 'insights' }" @click="goInsights">
          <AppIcon name="insights" size="14" />
          <span class="grow truncate">{{ t("insights.title") }}</span>
        </button>
        <button class="navitem" :class="{ 'is-on': isServerLog }" @click="openServerLog">
          <AppIcon name="terminal" size="14" />
          <span class="grow truncate">{{ t("tabs.serverLog") }}</span>
        </button>
        <button class="navitem" :class="{ 'is-on': view === 'capabilities' }" @click="goCapabilities">
          <AppIcon name="info" size="14" />
          <span class="grow truncate">{{ t("capabilities.title") }}</span>
        </button>
        <button class="navitem" :class="{ 'is-on': settingsOpen }" @click="settingsOpen = true">
          <AppIcon name="settings" size="14" />
          <span class="grow truncate">{{ t("settings.title") }}</span>
        </button>

        <button class="navitem" :class="{ 'is-on': paletteOpen }" @click="paletteOpen = true">
          <AppIcon name="command" size="14" />
          <span class="grow truncate">{{ t("palette.title") }}</span>
          <span class="tag palette-key">{{ t("palette.shortcut") }}</span>
        </button>

        <DataHomeBar />

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

      <div v-if="isMockRuntime" class="rail-foot">
        <div class="tag tone-warn rail-mock" :title="t('runtime.tauriUnavailable')">
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

      <InsightsPage v-else-if="view === 'insights'" />

      <CapabilitiesPage v-else-if="view === 'capabilities'" />

      <WorkspacePage v-else :mode="isServerLog ? 'server' : 'task'" @back="goOverview">
        <EventTimeline v-if="app.tab === 'events'" />
        <LogViewer v-else-if="app.tab === 'agentLogs'" kind="agent" :title="t('tabs.agentLogs')" />
        <LogViewer
          v-else-if="app.tab === 'verifyLogs'"
          kind="verify"
          :title="t('tabs.verifyLogs')"
        />
        <ReportPanel v-else-if="app.tab === 'reports'" />
        <BaselinePanel v-else-if="app.tab === 'baseline'" />
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

    <!-- 命令面板：静态命令来自外壳，任务命令由面板按输入实时检索（`@/core/palette`） -->
    <CommandPalette
      v-if="paletteOpen"
      :static-commands="paletteCommands"
      :tasks="app.tasks"
      @select="onPaletteSelect"
      @close="paletteOpen = false"
    />

    <!-- 更新日志面板：启动静默检查命中或手动检查后打开（面板内部自行关闭） -->
    <UpdateDialog v-if="app.update.dialogOpen" />
  </div>
</template>
