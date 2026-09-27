<script setup lang="ts">
/**
 * 左栏：任务列表（紧凑筛选条 + 折叠筛选板 / 状态脊 / 轮次）。
 */
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import StatusBadge from "./StatusBadge.vue";
import { useI18n } from "@/i18n";
import { countByPhase, emptyFilter } from "@/core/filter";
import { formatDateTime } from "@/core/format";
import { statusTone } from "@/core/status";
import { refreshTasks, selectTask, app, taskFacets, visibleTasks } from "@/stores/app";
import type { SortDir, SortKey } from "@/api/types";

const { t } = useI18n();
const showFilters = ref(true);

const counts = computed(() => countByPhase(app.tasks));
const facets = computed(() => taskFacets.value);

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
  await refreshTasks();
}

async function onSortChange(key: SortKey, dir: SortDir): Promise<void> {
  app.sortKey = key;
  app.sortDir = dir;
  await refreshTasks();
}
</script>

<template>
  <section class="pane pane-rail">
    <header class="pane-header">
      <span class="pane-title">{{ t("tasks.title") }}</span>
      <span class="hint">{{ t("tasks.count", { n: app.tasks.length }) }}</span>
      <span class="hint tone-active">{{ t("tasks.activeCount", { n: counts.active }) }}</span>
      <span class="hint">{{ t("tasks.terminalCount", { n: counts.terminal }) }}</span>
      <span class="app-header-spacer" />
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
        :class="{ 'is-on': showFilters }"
        :title="t('tasks.filterKeyword')"
        :aria-label="t('tasks.filterKeyword')"
        :aria-expanded="showFilters"
        @click="showFilters = !showFilters"
      >
        <AppIcon name="filter" />
      </button>
    </header>

    <div class="filter-bar">
      <input
        v-model="app.filter.keyword"
        class="input"
        :placeholder="t('tasks.filterKeyword')"
        :aria-label="t('tasks.filterKeyword')"
        @keyup.enter="onFilterChange"
        @change="onFilterChange"
      />
      <select
        v-model="app.filter.status"
        class="select"
        :aria-label="t('tasks.filterStatus')"
        @change="onFilterChange"
      >
        <option :value="null">{{ t("common.all") }}</option>
        <option v-for="s in facets.statuses" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
      </select>
    </div>

    <div v-if="showFilters" class="filter-sheet">
      <div class="grid-2">
        <div class="field">
          <span class="field-label">{{ t("tasks.filterAgent") }}</span>
          <select
            v-model="app.filter.agentId"
            class="select"
            :aria-label="t('tasks.filterAgent')"
            @change="onFilterChange"
          >
            <option :value="null">{{ t("common.all") }}</option>
            <option v-for="a in facets.agents" :key="a" :value="a">{{ a }}</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">{{ t("tasks.filterFrom") }}</span>
          <input v-model="fromDate" class="input" type="date" :aria-label="t('tasks.filterFrom')" />
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <span class="field-label">{{ t("tasks.filterProject") }}</span>
          <select
            v-model="app.filter.projectPath"
            class="select"
            :aria-label="t('tasks.filterProject')"
            @change="onFilterChange"
          >
            <option :value="null">{{ t("common.all") }}</option>
            <option v-for="p in facets.projects" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">{{ t("tasks.filterTo") }}</span>
          <input v-model="toDate" class="input" type="date" :aria-label="t('tasks.filterTo')" />
        </div>
      </div>

      <div class="inline wrap">
        <label class="check">
          <input v-model="app.filter.onlyActive" type="checkbox" @change="onFilterChange" />
          <span>{{ t("tasks.onlyActive") }}</span>
        </label>
      </div>

      <div class="inline">
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
          class="btn btn-icon"
          :title="app.sortDir === 'desc' ? t('tasks.sortDesc') : t('tasks.sortAsc')"
          :aria-label="app.sortDir === 'desc' ? t('tasks.sortDesc') : t('tasks.sortAsc')"
          @click="onSortChange(app.sortKey, app.sortDir === 'desc' ? 'asc' : 'desc')"
        >
          <AppIcon :name="app.sortDir === 'desc' ? 'sortDesc' : 'sortAsc'" />
        </button>
        <span class="app-header-spacer" />
        <button class="btn btn-ghost" @click="resetFilters">{{ t("tasks.resetFilter") }}</button>
      </div>
    </div>

    <div class="pane-body">
      <div v-if="app.tasksLoading" class="empty">{{ t("common.loading") }}</div>
      <div v-else-if="visibleTasks.length === 0" class="empty">
        <div>{{ t("tasks.noTasks") }}</div>
        <div class="hint empty-sub">{{ t("tasks.noTasksHint") }}</div>
      </div>
      <template v-else>
        <div
          v-for="task in visibleTasks"
          :key="task.taskId"
          class="task-item"
          :class="{ 'is-selected': task.taskId === app.selectedTaskId }"
          :data-tone="statusTone(task.status)"
          @click="selectTask(task.taskId)"
        >
          <div class="task-item-top">
            <StatusBadge :status="task.status" />
            <span v-if="task.dryRun" class="badge tone-info">{{ t("tasks.dryRun") }}</span>
            <span class="app-header-spacer" />
            <span class="hint mono truncate" :title="task.agentId">{{ task.agentId }}</span>
          </div>
          <div class="task-item-title" :title="task.task || task.taskId">
            {{ task.task || task.taskId }}
          </div>
          <div class="task-item-meta">
            <span class="mono truncate" :title="task.taskId">{{ task.taskId }}</span>
          </div>
          <div class="task-item-meta">
            <span>{{ formatDateTime(task.updatedAt) }}</span>
            <span>{{ t("tasks.rounds", { used: task.roundsUsed }) }}</span>
            <span v-if="task.reportRound !== null">
              {{ t("tasks.reportRound", { n: task.reportRound }) }}
            </span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>