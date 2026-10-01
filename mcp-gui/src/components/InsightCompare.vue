<script setup lang="ts">
/**
 * 洞察页 · A4 多任务对比（2–{@link COMPARE_MAX} 个任务并排）。
 *
 * 全为只读：左侧勾选来自既有 `app.tasks`，右侧指标来自任务快照与**按需拉取**的最新一轮
 * JSON 报告（取数与缓存都在 `stores/app.ts` 的 `toggleCompareTask`）。
 * 缺失一律显示 `—`（`common.notAvailable`），**不编造结论**；
 * 「横向最优」只在确实存在可比数值时标注（见 `bestOf`）。
 */
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { COMPARE_MAX, bestOf, compareTasks, type CompareRow } from "@/core/insights";
import { formatDuration } from "@/core/format";
import { app, clearCompareTasks, toggleCompareTask } from "@/stores/app";
import type { TaskSummary } from "@/api/types";

const { t } = useI18n();

const keyword = ref("");
/** 勾选超出上限时置为 true（界面明确提示，不静默顶替已有勾选） */
const limitHit = ref(false);

const selectedTasks = computed<TaskSummary[]>(() =>
  app.insights.compareIds
    .map((id) => app.tasks.find((task) => task.taskId === id) ?? null)
    .filter((task): task is TaskSummary => task !== null),
);

const candidates = computed<TaskSummary[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return app.tasks;
  return app.tasks.filter((task) =>
    [task.taskId, task.task, task.projectPath, task.displayPath, task.agentId]
      .join("\n")
      .toLowerCase()
      .includes(kw),
  );
});

const rows = computed(() => compareTasks(selectedTasks.value, app.insights.compareReports));

/** 横向最优（仅在存在可比数值时标注）：轮次最少 / 验收耗时最短 */
const bestRounds = computed(() => bestOf(rows.value, (row) => row.roundsUsed));
const bestSpan = computed(() => bestOf(rows.value, (row) => row.spanMs));

interface Metric {
  key: string;
  labelKey: string;
  text: (row: CompareRow) => string;
  best?: (row: CompareRow) => boolean;
}

const metrics = computed<Metric[]>(() => [
  { key: "status", labelKey: "insights.cmpStatus", text: (r) => statusLabel(r.status) },
  { key: "agent", labelKey: "insights.cmpAgent", text: (r) => text(r.agentId) },
  { key: "project", labelKey: "insights.cmpProject", text: (r) => text(r.projectPath) },
  {
    key: "rounds",
    labelKey: "insights.cmpRounds",
    text: (r) => String(r.roundsUsed),
    best: (r) => bestRounds.value !== null && r.roundsUsed === bestRounds.value,
  },
  {
    key: "duration",
    labelKey: "insights.cmpDuration",
    text: (r) => spanText(r.spanMs),
    best: (r) => r.spanMs !== null && r.spanMs === bestSpan.value,
  },
  {
    key: "diff",
    labelKey: "insights.cmpDiff",
    text: (r) =>
      r.totalAdd === null && r.totalDel === null
        ? t("common.notAvailable")
        : `${t("reports.addLines", { n: r.totalAdd ?? 0 })} / ${t("reports.delLines", { n: r.totalDel ?? 0 })}`,
  },
  { key: "changedFiles", labelKey: "insights.cmpChangedFiles", text: (r) => String(r.changedFiles) },
  {
    key: "verdict",
    labelKey: "insights.cmpVerdict",
    text: (r) => (r.reportPassed === null ? t("common.notAvailable") : yesNo(r.reportPassed)),
  },
  {
    key: "failedChecks",
    labelKey: "insights.cmpFailedChecks",
    text: (r) => (r.failedChecks.length === 0 ? t("common.none") : r.failedChecks.join(", ")),
  },
  { key: "errorType", labelKey: "insights.cmpErrorType", text: (r) => text(r.errorType) },
  { key: "message", labelKey: "insights.cmpMessage", text: (r) => text(r.message) },
]);

async function onToggle(taskId: string): Promise<void> {
  const ok = await toggleCompareTask(taskId);
  limitHit.value = !ok;
}

function onClear(): void {
  clearCompareTasks();
  limitHit.value = false;
}

/** 状态词表走 i18n；词表里没有的值**原样显示**（不显示 `status.xxx` 路径） */
function statusLabel(status: string): string {
  if (!status) return t("common.notAvailable");
  const key = `status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

function text(value: string | null): string {
  return value === null || value === "" ? t("common.notAvailable") : value;
}

function spanText(value: number | null): string {
  return value === null ? t("common.notAvailable") : formatDuration(value);
}

function yesNo(value: boolean): string {
  return value ? t("common.yes") : t("common.no");
}
</script>

<template>
  <section class="ins-block">
    <h2 class="ins-block-title">
      {{ t("insights.sectionCompare") }}
      <span class="tag">{{ selectedTasks.length }} / {{ COMPARE_MAX }}</span>
    </h2>
    <p class="ins-block-hint">{{ t("insights.compareHint", { n: COMPARE_MAX }) }}</p>

    <div class="cmp">
      <aside class="cmp-picker">
        <input
          v-model="keyword"
          class="input"
          :placeholder="t('insights.compareSearch')"
          :aria-label="t('insights.compareSearch')"
        />
        <ul class="cmp-list">
          <li v-for="task in candidates" :key="task.taskId">
            <label class="check cmp-check">
              <input
                type="checkbox"
                :checked="app.insights.compareIds.includes(task.taskId)"
                @change="onToggle(task.taskId)"
              />
              <span class="grow truncate">{{ task.taskId }}</span>
              <span class="tag">{{ statusLabel(task.status) }}</span>
            </label>
          </li>
        </ul>
        <p v-if="candidates.length === 0" class="hint">{{ t("insights.compareNoTask") }}</p>
        <p v-if="limitHit" class="hint tone-warn">
          {{ t("insights.compareLimit", { n: COMPARE_MAX }) }}
        </p>
      </aside>

      <div class="cmp-view">
        <div class="ins-bar">
          <span v-if="app.insights.compareLoading" class="hint">
            {{ t("insights.compareLoadingReports") }}
          </span>
          <span class="grow" />
          <button v-if="selectedTasks.length > 0" class="tbtn" @click="onClear">
            <AppIcon name="close" size="12" />
            {{ t("insights.compareClear") }}
          </button>
        </div>

        <p v-if="selectedTasks.length === 0" class="hint">{{ t("insights.comparePick") }}</p>

        <div v-else class="cmp-scroll">
          <table class="cmp-table">
            <thead>
              <tr>
                <th scope="col">{{ t("insights.compareField") }}</th>
                <th v-for="task in selectedTasks" :key="task.taskId" scope="col">
                  <span class="cmp-task">{{ task.taskId }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in metrics" :key="metric.key">
                <th scope="row">{{ t(metric.labelKey) }}</th>
                <td
                  v-for="row in rows"
                  :key="row.taskId"
                  :class="{ 'is-best': metric.best?.(row) === true }"
                >
                  {{ metric.text(row) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>
