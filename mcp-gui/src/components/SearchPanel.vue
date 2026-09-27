<script setup lang="ts">
/**
 * 概览页 · 搜索模式：跨任务全局搜索（按需扫描，不建本地全文索引；有进度与可取消）。
 *
 * 命中跳转沿用原逻辑（`selectTask` + `openTab` + `openLog` / `openReport`），跳转后向上
 * 抛 `navigated`，由外壳切到工作区。
 */
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { taskIdFromRel } from "@/core/paths";
import {
  app,
  cancelSearch,
  loadEvents,
  openLog,
  openReport,
  runSearch,
  selectTask,
} from "@/stores/app";
import type { SearchHit } from "@/api/types";

const emit = defineEmits<{ (e: "navigated"): void; (e: "exit"): void }>();

const { t } = useI18n();

const canRun = computed(
  () => app.search.keyword.trim().length > 0 && Object.values(app.search.scope).some(Boolean),
);

const groups = computed(() => app.search.result?.groups ?? []);

async function doSearch(): Promise<void> {
  if (!canRun.value) return;
  await runSearch();
}

async function jumpTo(hit: SearchHit): Promise<void> {
  const rel = hit.relPath;
  const taskId = taskIdFromRel(rel);
  if (taskId && taskId !== app.selectedTaskId) {
    await selectTask(taskId);
  }
  if (/task\.jsonl$/.test(rel)) {
    app.tab = "events";
    await loadEvents(true);
    emit("navigated");
    return;
  }
  if (/agent-\d+\.log$/.test(rel)) {
    app.tab = "agentLogs";
    await openLog(rel);
    emit("navigated");
    return;
  }
  if (/verify-\d+\.log$/.test(rel)) {
    app.tab = "verifyLogs";
    await openLog(rel);
    emit("navigated");
    return;
  }
  if (/dry-run-report-(\d+)\.(md|json)$/.test(rel)) {
    const round = Number(/dry-run-report-(\d+)\./.exec(rel)?.[1] ?? 0);
    app.tab = "reports";
    await openReport(round, rel.endsWith(".md") ? "dry-run-md" : "dry-run-json");
    emit("navigated");
    return;
  }
  if (/report-(\d+)\.(md|json|html)$/.test(rel)) {
    const round = Number(/report-(\d+)\./.exec(rel)?.[1] ?? 0);
    app.tab = "reports";
    await openReport(round, rel.endsWith(".md") ? "md" : rel.endsWith(".json") ? "json" : "html");
    emit("navigated");
    return;
  }
  app.tab = "serverLog";
  await openLog(rel);
  emit("navigated");
}
</script>

<template>
  <div class="view">
    <div class="searchbar">
      <input
        v-model="app.search.keyword"
        class="input input-compact grow"
        :placeholder="t('search.placeholder')"
        :aria-label="t('search.placeholder')"
        @keyup.enter="doSearch"
      />
      <button class="tbtn is-primary" :disabled="!canRun || app.search.running" @click="doSearch">
        <AppIcon name="search" />{{ t("search.run") }}
      </button>
      <button class="tbtn" :disabled="!app.search.running" @click="cancelSearch">
        <AppIcon name="close" />{{ t("search.cancel") }}
      </button>
      <span class="grow" />
      <button class="tbtn" @click="emit('exit')">
        <AppIcon name="chevronLeft" />{{ t("tasks.title") }}
      </button>
    </div>

    <div class="search-chips">
      <span class="chiprow-label">{{ t("search.scope") }}</span>
      <button
        class="chip"
        :class="{ 'is-on': app.search.scope.eventStream }"
        @click="app.search.scope.eventStream = !app.search.scope.eventStream"
      >
        {{ t("search.scopeEvents") }}
      </button>
      <button
        class="chip"
        :class="{ 'is-on': app.search.scope.agentLogs }"
        @click="app.search.scope.agentLogs = !app.search.scope.agentLogs"
      >
        {{ t("search.scopeAgentLogs") }}
      </button>
      <button
        class="chip"
        :class="{ 'is-on': app.search.scope.verifyLogs }"
        @click="app.search.scope.verifyLogs = !app.search.scope.verifyLogs"
      >
        {{ t("search.scopeVerifyLogs") }}
      </button>
      <button
        class="chip"
        :class="{ 'is-on': app.search.scope.reports }"
        @click="app.search.scope.reports = !app.search.scope.reports"
      >
        {{ t("search.scopeReports") }}
      </button>
      <button
        class="chip"
        :class="{ 'is-on': app.search.scope.serverLog }"
        @click="app.search.scope.serverLog = !app.search.scope.serverLog"
      >
        {{ t("search.scopeServerLog") }}
      </button>
      <button
        class="chip"
        :class="{ 'is-on': app.search.caseSensitive }"
        @click="app.search.caseSensitive = !app.search.caseSensitive"
      >
        {{ t("search.caseSensitive") }}
      </button>
      <span class="grow" />
      <span v-if="!canRun" class="hint">
        {{ app.search.keyword.trim().length === 0 ? t("search.needKeyword") : t("search.needScope") }}
      </span>
    </div>

    <div class="view-body">
      <div v-if="app.search.running" class="empty">
        {{ t("search.progress", { n: app.search.scanned }) }}
      </div>
      <div v-else-if="!app.search.result" class="empty">{{ t("search.placeholder") }}</div>
      <div v-else-if="groups.length === 0" class="empty">{{ t("search.noResults") }}</div>
      <template v-else>
        <div v-for="group in groups" :key="group.relPath">
          <div class="search-group">
            <span class="grow truncate" :title="group.relPath">{{ group.relPath }}</span>
            <span class="hint">{{ t("search.results", { n: group.hits.length }) }}</span>
          </div>
          <div
            v-for="hit in group.hits"
            :key="`${hit.relPath}:${hit.line}`"
            class="search-hit"
            @click="jumpTo(hit)"
          >
            <div class="inline">
              <span class="hint">{{ hit.line }}</span>
              <span class="grow" />
              <span class="hint">
                <span class="jump">{{ t("search.jump") }}<AppIcon name="chevronRight" size="12" /></span>
              </span>
            </div>
            <div class="search-snip">{{ hit.snippet }}</div>
          </div>
          <div v-if="group.truncated" class="hint search-note">
            {{ t("search.truncated", { n: group.hits.length }) }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>