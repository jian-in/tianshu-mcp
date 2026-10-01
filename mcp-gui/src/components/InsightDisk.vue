<script setup lang="ts">
/**
 * 洞察页 · A9 磁盘占用（**只读统计，不提供任何删除入口**）。
 *
 * 展示总量 / logs 占比 / 任务体积 TOP 20（含「体积大户」列）与「可清理」**提示**。
 * 判据全部为**相对口径**（`CLEANUP_HEAVIEST_RATIO` / `CLEANUP_MEDIAN_MULTIPLE`，见 `core/insights.ts`），
 * 因此不依赖任何绝对字节阈值；本页**没有**删除 / 清理按钮。
 */
import { computed, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { cleanupHints, medianOf } from "@/core/insights";
import { formatBytes } from "@/core/format";
import { app, loadDiskUsage } from "@/stores/app";
import type { CleanupReason } from "@/core/insights";

const { t } = useI18n();

const data = computed(() => app.disk);
const items = computed(() => data.value?.topTasks ?? []);
const hints = computed(() => cleanupHints(items.value));
const median = computed(() => medianOf(items.value.filter((i) => i.taskId !== null).map((i) => i.bytes)));

/** logs 占比；总量为 0 时不给百分比（不编造） */
const logsShare = computed(() => {
  const total = data.value?.totalBytes ?? 0;
  if (total <= 0) return null;
  return (data.value?.logsBytes ?? 0) / total;
});

function pct(value: number | null): string {
  return value === null ? t("common.notAvailable") : `${(value * 100).toFixed(1)}%`;
}

function reasonText(reason: CleanupReason): string {
  return t(`insights.cleanup.reason.${reason}`);
}

onMounted(() => {
  // 进分区加载一次；页内有「刷新」（切目录会清空缓存并重载）
  if (!app.disk) void loadDiskUsage();
});
</script>

<template>
  <section class="ins-block">
    <h2 class="ins-block-title">
      {{ t("insights.sectionDisk") }}
      <span class="tag">{{ data ? t("insights.diskDirs", { n: data.scannedDirs }) : "—" }}</span>
    </h2>
    <p class="ins-block-hint">{{ t("insights.diskHint") }}</p>

    <div class="ins-bar">
      <span class="grow" />
      <button class="tbtn" :disabled="app.diskLoading" @click="loadDiskUsage()">
        <AppIcon name="refresh" size="12" />
        {{ app.diskLoading ? t("common.loading") : t("common.refresh") }}
      </button>
    </div>

    <div v-if="!data" class="empty">
      {{ app.diskLoading ? t("common.loading") : t("insights.diskEmpty") }}
    </div>

    <template v-else>
      <dl class="kv">
        <dt>{{ t("insights.diskTotal") }}</dt>
        <dd>{{ formatBytes(data.totalBytes) }}</dd>
        <dt>{{ t("insights.diskTasks") }}</dt>
        <dd>{{ formatBytes(data.tasksBytes) }}</dd>
        <dt>{{ t("insights.diskLogs") }}</dt>
        <dd>{{ formatBytes(data.logsBytes) }}（{{ pct(logsShare) }}）</dd>
        <dt>{{ t("insights.diskMedian") }}</dt>
        <dd>{{ median === null ? t("common.notAvailable") : formatBytes(median) }}</dd>
      </dl>

      <p v-if="items.length === 0" class="hint">{{ t("insights.diskEmpty") }}</p>
      <div v-else class="ins-table ins-disk-table" role="table">
        <div class="ins-tr ins-th" role="row">
          <span role="columnheader">{{ t("insights.colTask") }}</span>
          <span role="columnheader">{{ t("insights.colSize") }}</span>
          <span role="columnheader">{{ t("insights.colFiles") }}</span>
          <span role="columnheader">{{ t("insights.diskHeaviest") }}</span>
          <span role="columnheader">{{ t("insights.diskHeaviestShare") }}</span>
        </div>
        <div v-for="item in items" :key="item.relPath" class="ins-tr" role="row">
          <span class="ins-key" role="cell" :title="item.relPath">{{ item.taskId ?? item.relPath }}</span>
          <span role="cell">{{ formatBytes(item.bytes) }}</span>
          <span role="cell">{{ item.files }}</span>
          <span role="cell" class="truncate" :title="item.heaviest?.name ?? ''">
            {{ item.heaviest?.name ?? t("common.notAvailable") }}
          </span>
          <span role="cell">{{ pct(item.heaviest === null ? null : item.heaviestRatio) }}</span>
        </div>
      </div>

      <h3 class="ins-block-title mt-sm">
        {{ t("insights.diskCleanup") }}
        <span class="tag">{{ hints.length }}</span>
      </h3>
      <p class="ins-block-hint">{{ t("insights.diskCleanupHint") }}</p>
      <p v-if="hints.length === 0" class="hint">{{ t("insights.diskCleanupNone") }}</p>
      <ul v-else class="ins-disk-hints">
        <li v-for="hint in hints" :key="hint.relPath" class="ins-disk-hint">
          <span class="ins-key truncate">{{ hint.taskId }}</span>
          <span class="tag">{{ formatBytes(hint.bytes) }}</span>
          <span v-for="reason in hint.reasons" :key="reason" class="tag tone-warn">
            {{ reasonText(reason) }}
          </span>
          <span class="hint truncate" :title="hint.heaviest?.name ?? ''">
            {{ hint.heaviest?.name ?? "" }}
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
