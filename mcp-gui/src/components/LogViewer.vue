<script setup lang="ts">
/**
 * 工作区 · 原始日志查看器（agent-<round>.log / verify-<round>.log / logs/server.log）。
 *
 * 大文件策略：首屏只读尾部窗口，向前按块加载；跟随开关关闭时**不把视口强行拉回底部**。
 * 版式：`view-bar`（标题 + 轮次 + 文件动作）→ 次级工具条（级别 / 关键字 / 计数）→ 终端正文 → `view-foot`。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { startWatch } from "@/api/watch";
import { highlightSegments, LOG_LEVELS, parseLogText, filterLogLines, type LogLevel } from "@/core/logline";
import { formatBytes } from "@/core/format";
import { logLevelTone } from "@/core/status";
import {
  app,
  applyLogGrowth,
  exportCurrentFile,
  loadMoreLog,
  openLog,
  openRoundLog,
  selectedTask,
} from "@/stores/app";

const props = defineProps<{
  kind: "agent" | "verify" | "server";
  title: string;
}>();

const { t } = useI18n();
const scroller = ref<HTMLElement | null>(null);
const copied = ref(false);
const exportMessage = ref<string | null>(null);

const rounds = computed<number[]>(() => {
  const task = selectedTask.value;
  if (!task) return [];
  return props.kind === "agent" ? task.artifacts.agentLogs : task.artifacts.verifyLogs;
});

const activeRound = computed<number | null>(() => {
  const m = new RegExp(`/${props.kind}-(\\d+)\\.log$`).exec(app.logRelPath);
  return m ? Number(m[1]) : null;
});

const isServerLog = computed(() => props.kind === "server");

const parsedLines = computed(() => parseLogText(app.logText));
const visibleLines = computed(() => filterLogLines(parsedLines.value, app.logFilter));

const hasMoreBefore = computed(() => (app.logChunk?.loadedFrom ?? 0) > 0);

function levelLabel(level: LogLevel): string {
  const map: Record<LogLevel, string> = {
    debug: t("logs.levelDebug"),
    info: t("logs.levelInfo"),
    warn: t("logs.levelWarn"),
    error: t("logs.levelError"),
    unknown: t("logs.levelUnknown"),
  };
  return map[level];
}

function toggleLevel(level: LogLevel): void {
  const set = new Set(app.logFilter.levels);
  if (set.has(level)) set.delete(level);
  else set.add(level);
  app.logFilter.levels = [...set];
}

async function openRound(round: number): Promise<void> {
  if (props.kind === "server") return;
  await openRoundLog(props.kind, round);
}

let stopWatch: (() => void) | null = null;

async function restartWatch(): Promise<void> {
  stopWatch?.();
  stopWatch = null;
  if (!app.logRelPath || !app.logFollow) return;
  stopWatch = await startWatch([app.logRelPath], (payload) => {
    void applyLogGrowth(payload.totalBytes);
  });
}

onBeforeUnmount(() => stopWatch?.());

watch(
  () => [app.logRelPath, app.logFollow] as const,
  () => {
    void restartWatch();
  },
  { immediate: true },
);

watch(
  () => app.logText,
  async () => {
    if (!app.logFollow) return;
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  if (!nearBottom && app.logFollow) app.logFollow = false;
  else if (nearBottom && !app.logFollow) app.logFollow = true;
}

async function jumpToLatest(): Promise<void> {
  app.logFollow = true;
  await openLog(app.logRelPath);
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(app.logText);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}

async function doExport(): Promise<void> {
  exportMessage.value = null;
  try {
    const path = await exportCurrentFile();
    if (path) exportMessage.value = t("export.done", { path });
  } catch (err) {
    exportMessage.value = t("export.failed", { msg: err instanceof Error ? err.message : String(err) });
  }
}
</script>

<template>
  <div class="view">
    <div class="view-bar">
      <span class="view-title">{{ props.title }}</span>
      <div v-if="!isServerLog && rounds.length > 0" class="segmented">
        <button
          v-for="r in rounds"
          :key="r"
          class="segment"
          :class="{ 'is-active': r === activeRound }"
          @click="openRound(r)"
        >
          {{ t("logs.round", { n: r }) }}
        </button>
      </div>
      <span v-else-if="!isServerLog" class="hint">{{ t("common.none") }}</span>
      <span class="grow" />
      <button
        class="ibtn"
        :title="t('common.copy')"
        :aria-label="t('common.copy')"
        @click="copyAll"
      >
        <AppIcon :name="copied ? 'check' : 'copy'" />
      </button>
      <button
        class="ibtn"
        :title="t('export.exportFile')"
        :aria-label="t('export.exportFile')"
        @click="doExport"
      >
        <AppIcon name="download" />
      </button>
    </div>

    <div class="view-bar is-sub">
      <template v-if="isServerLog">
        <button
          v-for="level in LOG_LEVELS"
          :key="level"
          class="chip"
          :class="{ 'is-on': app.logFilter.levels.includes(level) }"
          @click="toggleLevel(level)"
        >
          <span :class="`tone-${logLevelTone(level)}`">{{ levelLabel(level) }}</span>
        </button>
      </template>
      <input
        v-model="app.logFilter.keyword"
        class="input input-compact"
        :placeholder="t('logs.keyword')"
        :aria-label="t('logs.keyword')"
      />
      <label class="check">
        <input v-model="app.logShowLineNumbers" type="checkbox" />
        <span>{{ t("logs.lineNumbers") }}</span>
      </label>
      <label class="check">
        <input v-model="app.logWrap" type="checkbox" />
        <span>{{ t("logs.wrap") }}</span>
      </label>
      <span class="grow" />
      <span class="hint">
        {{
          t("logs.loadedOf", {
            loaded: formatBytes(app.logChunk ? app.logChunk.loadedTo - app.logChunk.loadedFrom : 0),
            total: formatBytes(app.logChunk?.totalBytes ?? 0),
          })
        }}
      </span>
      <span class="hint">
        {{ t("logs.filteredHint", { shown: visibleLines.length, total: parsedLines.length }) }}
      </span>
      <button class="tbtn" :disabled="!hasMoreBefore || app.logLoading" @click="loadMoreLog">
        <AppIcon name="chevronUp" />{{ t("logs.loadMore") }}
      </button>
      <button class="tbtn" :class="{ 'is-primary': app.logFollow }" @click="jumpToLatest">
        <AppIcon name="arrowDown" />{{ t("logs.jumpToLatest") }}
      </button>
    </div>

    <div v-if="exportMessage" class="notice mt-sm">
      <AppIcon name="info" />
      <span class="grow">{{ exportMessage }}</span>
    </div>

    <div
      ref="scroller"
      class="view-body log"
      :class="{ 'is-wrap': app.logWrap, 'is-nowrap-num': !app.logShowLineNumbers }"
      @scroll="onScroll"
    >
      <div v-if="app.logLoading" class="empty">{{ t("common.loading") }}</div>
      <div v-else-if="parsedLines.length === 0" class="empty">{{ t("logs.empty") }}</div>
      <div v-else-if="visibleLines.length === 0" class="empty">{{ t("search.noResults") }}</div>
      <template v-else>
        <div v-for="line in visibleLines" :key="line.line" class="lrow">
          <span v-if="app.logShowLineNumbers" class="lgut">{{ line.line }}</span>
          <span class="ltext">
            <template v-for="(seg, i) in highlightSegments(line.raw, app.logFilter.keyword)" :key="i">
              <mark v-if="seg.hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </div>
      </template>
    </div>

    <footer class="view-foot">
      <span v-if="app.logFollow" class="tone-ok"><span class="dot" />{{ t("logs.following") }}</span>
      <span v-else class="tone-muted"><span class="dot" />{{ t("logs.paused") }}</span>
      <span v-if="hasMoreBefore">{{ t("logs.loadMore") }}…</span>
    </footer>
  </div>
</template>