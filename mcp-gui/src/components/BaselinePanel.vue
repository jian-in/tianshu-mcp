<script setup lang="ts">
/**
 * A5 工作区 · 基线分区（只读）。
 *
 * 展示该任务动工前保存的 `baseline.json` 摘要，并与**最新一轮报告**的改动统计对照：
 * 基线里已有 N 项改动 vs 本次实际改动 M 个文件，用于判断「改动是否越界」。
 *
 * - 基线缺失 / 损坏时如实提示「没有保存的动工前基线」，**不编造零值**；
 * - 报告按需读取（`readReport(kind: "json")` + `summarizeReport`），按任务缓存；
 * - 全程只读，不提供任何写 / 删除入口。
 */
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { api } from "@/api";
import { summarizeReport, type ReportSummary } from "@/core/report";
import { formatDateTime } from "@/core/format";
import { app } from "@/stores/app";

const { t } = useI18n();

/** 报告缓存：`taskId → 摘要`（`null` = 已尝试但无报告 / 不可解析） */
const reports = ref<Record<string, ReportSummary | null>>({});
const reportLoading = ref(false);

const taskId = computed(() => app.selectedTaskId);
const info = computed(() => app.baseline);
const report = computed(() => (taskId.value ? (reports.value[taskId.value] ?? null) : null));

watch(
  taskId,
  (id) => {
    if (id && !(id in reports.value)) void loadReport(id);
  },
  { immediate: true },
);

/**
 * 取最新一轮 JSON 报告（与洞察页对比分区同一口径：优先快照 `reportRound`，
 * 否则取目录里最大的 `report-<轮次>.json`）。
 */
async function loadReport(id: string): Promise<void> {
  const task = app.tasks.find((item) => item.taskId === id);
  if (!task) return;
  const rounds = task.artifacts.reportJson;
  const round = task.reportRound ?? (rounds.length > 0 ? (rounds[rounds.length - 1] ?? null) : null);
  if (round === null) {
    reports.value = { ...reports.value, [id]: null };
    return;
  }
  reportLoading.value = true;
  try {
    const res = await api.readReport({
      dataHome: app.dataHome.active,
      taskId: id,
      round,
      kind: "json",
    });
    let summary: ReportSummary | null = null;
    if (!res.missing) {
      try {
        summary = summarizeReport(JSON.parse(res.text) as unknown);
      } catch {
        summary = null;
      }
    }
    reports.value = { ...reports.value, [id]: summary };
  } catch {
    // 单份报告读不到只影响「对照」区（显示不可用），不打断基线展示
    reports.value = { ...reports.value, [id]: null };
  } finally {
    reportLoading.value = false;
  }
}

/** HEAD 只展示短哈希（完整值在 title 里，避免长串撑破版式） */
const shortHead = computed(() => {
  const head = info.value?.head ?? "";
  return head === "" ? t("common.notAvailable") : head.slice(0, 10);
});
</script>

<template>
  <div class="view">
    <div class="view-bar">
      <span class="view-title">{{ t("baseline.title") }}</span>
      <span class="hint truncate">{{ taskId ?? "" }}</span>
      <span class="grow" />
      <span class="hint">{{ t("baseline.readonlyHint") }}</span>
    </div>

    <div class="view-body">
      <div v-if="app.baselineLoading" class="empty">{{ t("common.loading") }}</div>

      <!-- 没有基线：如实提示，不编造零值 -->
      <div v-else-if="!info || !info.present" class="empty">
        <div>{{ t("baseline.missing") }}</div>
        <div class="empty-sub">{{ t("baseline.missingHint") }}</div>
      </div>

      <template v-else>
        <h3 class="section-title">
          {{ t("baseline.summary") }}
          <span class="tag" :class="info.dirty ? 'tone-warn' : 'tone-ok'">
            {{ info.dirty ? t("baseline.dirty") : t("baseline.clean") }}
          </span>
        </h3>
        <dl class="kv">
          <dt>{{ t("baseline.isRepo") }}</dt>
          <dd>{{ info.isRepo ? t("common.yes") : t("baseline.notRepo") }}</dd>
          <dt>{{ t("baseline.head") }}</dt>
          <dd :title="info.head ?? ''">{{ shortHead }}</dd>
          <dt>{{ t("baseline.capturedAt") }}</dt>
          <dd>{{ formatDateTime(info.capturedAt) }}</dd>
          <dt>{{ t("baseline.dirtyFiles") }}</dt>
          <dd>{{ info.dirtyFilesCount }}</dd>
          <dt>{{ t("baseline.preExistingChanged") }}</dt>
          <dd>{{ info.preExistingChangedCount }}</dd>
          <dt>{{ t("baseline.preExistingUntracked") }}</dt>
          <dd>{{ info.preExistingUntrackedCount }}</dd>
        </dl>
        <div v-if="info.message" class="notice mt-sm">
          <AppIcon name="info" />
          <span>{{ info.message }}</span>
        </div>

        <h3 class="section-title mt-sm">{{ t("baseline.reportCompare") }}</h3>
        <p v-if="reportLoading" class="hint">{{ t("common.loading") }}</p>
        <p v-else-if="!report" class="hint">{{ t("baseline.reportMissing") }}</p>
        <ul v-else class="baseline-diff">
          <li>{{ t("baseline.preExistingLine", { n: info.preExistingChangedCount }) }}</li>
          <li>
            {{
              t("baseline.currentChanges", {
                files: report.diffstat.perFile.length || report.changedFiles.length,
                add: report.diffstat.totalAdd,
                del: report.diffstat.totalDel,
              })
            }}
          </li>
          <li v-if="report.untrackedFiles.length > 0">
            {{ t("baseline.untrackedLine", { n: report.untrackedFiles.length }) }}
          </li>
        </ul>
        <p v-if="report" class="hint">{{ t("baseline.compareHint") }}</p>
      </template>
    </div>
  </div>
</template>
