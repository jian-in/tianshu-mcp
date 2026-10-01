<script setup lang="ts">
/**
 * 工作区 · 事件流 `task.jsonl`。
 *
 * 两种视图（分段控件切换）：
 * - **列表**：带表头的四列终端时间线（行 / 时间 / 事件 / 详情），读的是**尾部窗口**（大文件友好）；
 * - **阶段**：状态跃迁甘特（见 `TimelineGantt.vue`），**按需读一次全量**（`full = true`）——
 *   只在切到阶段视图时读取，列表视图的行为与既有一致。
 */
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import TimelineGantt from "./TimelineGantt.vue";
import { useI18n } from "@/i18n";
import { formatBytes, formatDateTime, prettyJson } from "@/core/format";
import { eventKindTone } from "@/core/status";
import {
  app,
  invalidateEventsFull,
  loadEvents,
  loadEventsFull,
  loadMoreEvents,
  selectedTask,
} from "@/stores/app";

const { t } = useI18n();
const expanded = ref<Set<number>>(new Set());
const mode = ref<"list" | "stages">("list");

const hasMore = computed(() => app.eventsLoadedFrom > 0);

watch(mode, (next) => {
  // 首次切到阶段视图才读全量；同一任务只读一次（store 内部按任务缓存）
  if (next === "stages") void loadEventsFull();
});

/** 刷新：列表重读尾部窗口，阶段丢弃全量缓存后重读（避免显示过期阶段） */
async function refresh(): Promise<void> {
  if (mode.value === "stages") {
    invalidateEventsFull();
    await loadEventsFull();
    return;
  }
  await loadEvents(true);
}

function eventLabel(name: string): string {
  const text = t(`eventName.${name}`);
  return text.startsWith("eventName.") ? name : text;
}

function kindLabel(kind: string): string {
  const text = t(`eventKind.${kind}`);
  return text.startsWith("eventKind.") ? kind : text;
}

function toggleData(line: number): void {
  const next = new Set(expanded.value);
  if (next.has(line)) next.delete(line);
  else next.add(line);
  expanded.value = next;
}
</script>

<template>
  <div class="view">
    <div class="view-bar">
      <span class="view-title">{{ t("tabs.events") }}</span>
      <span class="hint truncate" :title="selectedTask?.taskId">
        {{ selectedTask?.taskId ?? "" }}
      </span>
      <span class="grow" />
      <div class="segmented">
        <button
          class="segment"
          :class="{ 'is-active': mode === 'list' }"
          @click="mode = 'list'"
        >
          {{ t("events.viewList") }}
        </button>
        <button
          class="segment"
          :class="{ 'is-active': mode === 'stages' }"
          @click="mode = 'stages'"
        >
          {{ t("events.viewStages") }}
        </button>
      </div>
      <span v-if="mode === 'list'" class="hint">
        {{
          t("events.loadedOf", {
            loaded: formatBytes(app.eventsLoadedTo - app.eventsLoadedFrom),
            total: formatBytes(app.eventsTotalBytes),
          })
        }}
      </span>
      <button
        v-if="mode === 'list'"
        class="tbtn"
        :disabled="!hasMore || app.eventsLoading"
        @click="loadMoreEvents"
      >
        <AppIcon name="chevronUp" />{{ t("events.loadMore") }}
      </button>
      <button
        class="ibtn"
        :title="t('common.refresh')"
        :aria-label="t('common.refresh')"
        @click="refresh"
      >
        <AppIcon name="refresh" />
      </button>
    </div>

    <div v-if="mode === 'list' && app.eventsBadLines > 0" class="notice notice-warn mt-sm">
      <AppIcon name="alert" />
      <span>{{ t("events.badLines", { n: app.eventsBadLines }) }}</span>
    </div>
    <div v-if="mode === 'stages' && app.eventsFullBadLines > 0" class="notice notice-warn mt-sm">
      <AppIcon name="alert" />
      <span>{{ t("events.badLines", { n: app.eventsFullBadLines }) }}</span>
    </div>

    <div class="view-body">
      <!-- 阶段视图：全量事件按需读取（阶段切分全在 core/timeline 纯函数里） -->
      <template v-if="mode === 'stages'">
        <div v-if="app.eventsFullLoading" class="empty">{{ t("common.loading") }}</div>
        <TimelineGantt v-else />
      </template>

      <template v-else>
        <div v-if="app.eventsLoading" class="empty">{{ t("common.loading") }}</div>
        <div v-else-if="app.events.length === 0" class="empty">{{ t("events.empty") }}</div>
        <template v-else>
          <div class="thead">
            <span>{{ t("common.lines") }}</span>
            <span>{{ t("events.ts") }}</span>
            <span>{{ t("events.event") }}</span>
            <span>{{ t("events.detail") }}</span>
          </div>
          <div
            v-for="event in app.events"
            :key="`${event.line}-${event.ts}`"
            class="erow"
            :class="{ 'is-note': event.kind === 'note' }"
          >
            <span class="etime">{{ event.line }}</span>
            <span class="etime">{{ formatDateTime(event.ts) }}</span>
            <span class="ename" :class="`tone-${eventKindTone(event.kind)}`">
              {{ eventLabel(event.event) }}
            </span>
            <div>
              <div class="edetail">
                <span class="ebadge" :class="`tone-${eventKindTone(event.kind)}`">
                  {{ kindLabel(event.kind) }}
                </span>
                <span v-if="event.detail">{{ event.detail }}</span>
                <span v-else class="hint">{{ t("common.notAvailable") }}</span>
              </div>
              <button
                v-if="event.data"
                class="tbtn etoggle"
                @click="toggleData(event.line)"
              >
                <AppIcon :name="expanded.has(event.line) ? 'chevronDown' : 'chevronRight'" />
                {{ expanded.has(event.line) ? t("events.hideData") : t("events.showData") }}
              </button>
            </div>
            <pre v-if="event.data && expanded.has(event.line)" class="edata">{{
              prettyJson(event.data)
            }}</pre>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>