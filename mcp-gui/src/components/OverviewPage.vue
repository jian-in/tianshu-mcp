<script setup lang="ts">
/**
 * 态一 · 任务概览（内容区整页）：指标仪 + 状态圆片 + 筛选浮层 + 任务卡网格 / 搜索模式。
 *
 * 布局契约：品牌 / 数据目录 / 搜索 / 刷新 / 设置由外壳的**常驻侧栏**承担，本页**没有顶栏**；
 * 任务以卡片网格铺满本页，点卡片由外壳切到「工作区」整页。
 * `mode` 由外壳持有（侧栏搜索框聚焦即置为 `search`），本组件经 `v-model:mode` 读写。
 */
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import MetricsStrip from "./MetricsStrip.vue";
import TaskCard from "./TaskCard.vue";
import SearchPanel from "./SearchPanel.vue";
import { useI18n } from "@/i18n";
import { countByPhase, emptyFilter } from "@/core/filter";
import { statusTone, type StatusTone } from "@/core/status";
import { app, refreshTasks, taskFacets, visibleTasks } from "@/stores/app";
import type { SortDir, SortKey } from "@/api/types";

const props = defineProps<{ mode: "tasks" | "search" }>();

const emit = defineEmits<{
  (e: "open-task", taskId: string): void;
  (e: "navigated"): void;
  (e: "update:mode", mode: "tasks" | "search"): void;
}>();

const { t } = useI18n();
/** 状态圆片：纯视图内分组过滤（不改 store 的筛选条件） */
const statusFilter = ref<StatusTone | null>(null);
const filterOpen = ref(false);

const STATUS_CHIPS: { tone: StatusTone | null; labelKey: string }[] = [
  { tone: null, labelKey: "common.all" },
  { tone: "active", labelKey: "status.running" },
  { tone: "ok", labelKey: "status.succeeded" },
  { tone: "fail", labelKey: "status.failed" },
  { tone: "warn", labelKey: "status.needs_attention" },
  { tone: "info", labelKey: "status.needs_user" },
];

const counts = computed(() => countByPhase(app.tasks));
const failedCount = computed(() => app.tasks.filter((task) => task.status === "failed").length);

const metrics = computed(() => [
  { label: t("tasks.total"), value: app.tasks.length },
  { label: t("tasks.active"), value: counts.value.active, tone: "active" },
  { label: t("tasks.finished"), value: counts.value.terminal },
  { label: t("status.failed"), value: failedCount.value, tone: "fail" },
]);

const facets = computed(() => taskFacets.value);

const boardTasks = computed(() => {
  const tone = statusFilter.value;
  if (!tone) return visibleTasks.value;
  return visibleTasks.value.filter((task) => statusTone(task.status) === tone);
});

function isoFromDate(value: string, endOfDay: boolean): string | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const fromDate = computed({
  get: () => (app.filter.from ? app.filter.from.slice(0, 10) : ""),
  set: (v: string) => {
    app.filter.from = isoFromDate(v, false);
    void refreshTasks();
  },
});

const toDate = computed({
  get: () => (app.filter.to ? app.filter.to.slice(0, 10) : ""),
  set: (v: string) => {
    app.filter.to = isoFromDate(v, true);
    void refreshTasks();
  },
});

async function onFilterChange(): Promise<void> {
  await refreshTasks();
}

async function resetFilters(): Promise<void> {
  Object.assign(app.filter, emptyFilter());
  statusFilter.value = null;
  await refreshTasks();
}

async function onSortChange(key: SortKey, dir: SortDir): Promise<void> {
  app.sortKey = key;
  app.sortDir = dir;
  await refreshTasks();
}
</script>

<template>
  <div class="page">
    <MetricsStrip :items="metrics" />

    <template v-if="props.mode === 'tasks'">
      <div class="chiprow">
        <span class="chiprow-label">{{ t("tasks.count", { n: app.tasks.length }) }}</span>
        <button
          v-for="chip in STATUS_CHIPS"
          :key="chip.labelKey"
          class="chip"
          :class="{ 'is-on': statusFilter === chip.tone }"
          @click="statusFilter = chip.tone"
        >
          {{ t(chip.labelKey) }}
        </button>
        <span class="grow" />
        <button class="chip" :class="{ 'is-on': filterOpen }" @click="filterOpen = !filterOpen">
          <AppIcon name="filter" size="12" />{{ t("tasks.filter") }}
        </button>
      </div>

      <div v-if="filterOpen" class="sheet">
        <div class="sheet-grid">
          <div class="field">
            <span class="field-label">{{ t("tasks.filterKeyword") }}</span>
            <input
              v-model="app.filter.keyword"
              class="input"
              :placeholder="t('tasks.filterKeyword')"
              @keyup.enter="onFilterChange"
              @change="onFilterChange"
            />
          </div>
          <div class="field">
            <span class="field-label">{{ t("tasks.filterAgent") }}</span>
            <select v-model="app.filter.agentId" class="select" @change="onFilterChange">
              <option :value="null">{{ t("common.all") }}</option>
              <option v-for="a in facets.agents" :key="a" :value="a">{{ a }}</option>
            </select>
          </div>
          <div class="field">
            <span class="field-label">{{ t("tasks.filterStatus") }}</span>
            <select v-model="app.filter.status" class="select" @change="onFilterChange">
              <option :value="null">{{ t("common.all") }}</option>
              <option v-for="s in facets.statuses" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
            </select>
          </div>
          <div class="field">
            <span class="field-label">{{ t("tasks.filterProject") }}</span>
            <select v-model="app.filter.projectPath" class="select" @change="onFilterChange">
              <option :value="null">{{ t("common.all") }}</option>
              <option v-for="p in facets.projects" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
          <div class="field">
            <span class="field-label">{{ t("tasks.filterFrom") }}</span>
            <input v-model="fromDate" class="input" type="date" />
          </div>
          <div class="field">
            <span class="field-label">{{ t("tasks.filterTo") }}</span>
            <input v-model="toDate" class="input" type="date" />
          </div>
        </div>

        <div class="sheet-actions">
          <label class="check">
            <input v-model="app.filter.onlyActive" type="checkbox" @change="onFilterChange" />
            <span>{{ t("tasks.onlyActive") }}</span>
          </label>
          <span class="grow" />
          <select
            class="select select-compact"
            :value="app.sortKey"
            :aria-label="t('tasks.sortBy')"
            @change="onSortChange(($event.target as HTMLSelectElement).value as SortKey, app.sortDir)"
          >
            <option value="updatedAt">{{ t("tasks.sortUpdatedAt") }}</option>
            <option value="createdAt">{{ t("tasks.sortCreatedAt") }}</option>
            <option value="taskId">{{ t("tasks.sortTaskId") }}</option>
          </select>
          <button
            class="ibtn"
            :title="app.sortDir === 'desc' ? t('tasks.sortDesc') : t('tasks.sortAsc')"
            :aria-label="app.sortDir === 'desc' ? t('tasks.sortDesc') : t('tasks.sortAsc')"
            @click="onSortChange(app.sortKey, app.sortDir === 'desc' ? 'asc' : 'desc')"
          >
            <AppIcon :name="app.sortDir === 'desc' ? 'sortDesc' : 'sortAsc'" />
          </button>
          <button class="tbtn" @click="resetFilters">{{ t("tasks.resetFilter") }}</button>
        </div>
      </div>

      <div class="board">
        <div v-if="app.tasksLoading" class="empty">{{ t("common.loading") }}</div>
        <div v-else-if="boardTasks.length === 0" class="empty">
          <div>{{ t("tasks.noTasks") }}</div>
          <div class="empty-sub">{{ t("tasks.noTasksHint") }}</div>
        </div>
        <div v-else class="grid">
          <TaskCard
            v-for="task in boardTasks"
            :key="task.taskId"
            :task="task"
            @open="emit('open-task', $event)"
          />
        </div>
      </div>
    </template>

    <SearchPanel v-else @navigated="emit('navigated')" @exit="emit('update:mode', 'tasks')" />
  </div>
</template>