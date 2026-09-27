<script setup lang="ts">
/**
 * 工作区 · 事件流 `task.jsonl`：带表头的四列终端时间线（行 / 时间 / 事件 / 详情）。
 *
 * 展开的数据块整行通栏；事件类型用方括号徽标领起详情。
 */
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { formatBytes, formatDateTime, prettyJson } from "@/core/format";
import { eventKindTone } from "@/core/status";
import { app, loadEvents, loadMoreEvents, selectedTask } from "@/stores/app";

const { t } = useI18n();
const expanded = ref<Set<number>>(new Set());

const hasMore = computed(() => app.eventsLoadedFrom > 0);

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
      <span class="hint">
        {{
          t("events.loadedOf", {
            loaded: formatBytes(app.eventsLoadedTo - app.eventsLoadedFrom),
            total: formatBytes(app.eventsTotalBytes),
          })
        }}
      </span>
      <button class="tbtn" :disabled="!hasMore || app.eventsLoading" @click="loadMoreEvents">
        <AppIcon name="chevronUp" />{{ t("events.loadMore") }}
      </button>
      <button
        class="ibtn"
        :title="t('common.refresh')"
        :aria-label="t('common.refresh')"
        @click="loadEvents(true)"
      >
        <AppIcon name="refresh" />
      </button>
    </div>

    <div v-if="app.eventsBadLines > 0" class="notice notice-warn mt-sm">
      <AppIcon name="alert" />
      <span>{{ t("events.badLines", { n: app.eventsBadLines }) }}</span>
    </div>

    <div class="view-body">
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
    </div>
  </div>
</template>