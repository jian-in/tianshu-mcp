<script setup lang="ts">
/**
 * 态二 · 工作区（内容区整页）：面包屑 + 任务摘要带 + 内容槽。
 *
 * 布局契约：分区导航（事件流 / Agent 日志 / 验收日志 / 验收报告）**归外壳的常驻侧栏**，
 * 这里只有「面包屑 + 摘要带 + 内容」一列，自身不占任何独立侧栏。
 * 两种形态：`task`（某任务的分区视图，摘要带可见）/ `server`（全局 server.log，摘要带让位）。
 */
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import TaskSummaryBar from "./TaskSummaryBar.vue";
import { useI18n } from "@/i18n";
import {
  app,
  exportCurrentFile,
  exportTaskZip,
  loadEvents,
  openLog,
  openReport,
  selectedTask,
} from "@/stores/app";

const props = defineProps<{ mode: "task" | "server" }>();
const emit = defineEmits<{ (e: "back"): void }>();
const { t } = useI18n();

const task = computed(() => selectedTask.value);
const crumbTitle = computed(() =>
  props.mode === "server" ? t("tabs.serverLog") : (task.value?.taskId ?? ""),
);

const expanded = ref(false);
const excludeHeavyLogs = ref(true);
const copied = ref(false);
const message = ref<string | null>(null);

/** 刷新当前分区（沿用各分区已有的加载动作） */
async function refreshCurrent(): Promise<void> {
  if (props.mode === "server" || app.tab === "agentLogs" || app.tab === "verifyLogs") {
    if (app.logRelPath) await openLog(app.logRelPath);
    return;
  }
  if (app.tab === "events") {
    await loadEvents(true);
    return;
  }
  if (app.tab === "reports") {
    await openReport(app.reportRound, app.reportKind);
    return;
  }
  if (app.logRelPath) await openLog(app.logRelPath);
}

async function copyCurrent(): Promise<void> {
  const text = props.mode === "server" ? app.logText : (task.value?.taskId ?? "");
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}

async function doExport(): Promise<void> {
  message.value = null;
  try {
    const path =
      props.mode === "server"
        ? await exportCurrentFile()
        : await exportTaskZip(excludeHeavyLogs.value);
    if (path) message.value = t("export.done", { path });
  } catch (err) {
    message.value = t("export.failed", { msg: err instanceof Error ? err.message : String(err) });
  }
}
</script>

<template>
  <div class="page">
    <header class="crumb">
      <button class="crumb-back" @click="emit('back')">
        <AppIcon name="chevronLeft" size="14" />{{ t("tasks.title") }}
      </button>
      <span class="crumb-sep">/</span>
      <span class="crumb-cur truncate" :title="crumbTitle">{{ crumbTitle }}</span>
      <span class="grow" />
      <div class="crumb-actions">
        <button
          class="ibtn"
          :title="t('common.refresh')"
          :aria-label="t('common.refresh')"
          @click="refreshCurrent"
        >
          <AppIcon name="refresh" />
        </button>
        <button
          class="ibtn"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="copyCurrent"
        >
          <AppIcon :name="copied ? 'check' : 'copy'" />
        </button>
        <button class="tbtn" :title="t('export.export')" @click="doExport">
          <AppIcon name="download" />{{ t("export.export") }}
        </button>
      </div>
    </header>

    <TaskSummaryBar
      v-if="props.mode === 'task' && task"
      :task="task"
      :expanded="expanded"
      :exclude-heavy-logs="excludeHeavyLogs"
      :message="message"
      @toggle="expanded = !expanded"
      @set-exclude="excludeHeavyLogs = $event"
    />

    <div class="content">
      <slot />
    </div>
  </div>
</template>