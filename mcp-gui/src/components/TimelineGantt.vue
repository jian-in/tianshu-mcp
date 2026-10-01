<script setup lang="ts">
/**
 * A6 状态跃迁甘特（只读）：把状态跃迁事件画成横向阶段条。
 *
 * 数据来自**全量**事件（`app.eventsFull`，进阶段视图时按需读取一次），
 * 阶段切分与时长计算全在 `@/core/timeline` 的纯函数里（可单测）。
 * 最后一段没有结束时间时标注「进行中」，**不编造时长**。
 */
import { computed } from "vue";
import { useI18n } from "@/i18n";
import { buildStages, stageShare, totalMs } from "@/core/timeline";
import { formatDuration, formatDateTime } from "@/core/format";
import { statusTone } from "@/core/status";
import { app } from "@/stores/app";
import { needsFullRead } from "@/core/deeplink";

const { t } = useI18n();

const stages = computed(() => buildStages(app.eventsFull));
const total = computed(() => totalMs(stages.value));

/** 全量读取后仍不是从 `created` 开始：如实提示「前面还有内容未读到」 */
const truncated = computed(() => needsFullRead(app.eventsFull));

function label(name: string): string {
  const text = t(`eventName.${name}`);
  return text.startsWith("eventName.") ? name : text;
}

function width(stage: (typeof stages.value)[number]): string {
  const share = stageShare(stage, total.value);
  if (share === null) return "0";
  // 最小可见宽度：占比再小也要看得见（纯展示，不改变口径）
  return `${Math.max(share * 100, 0.8).toFixed(3)}%`;
}
</script>

<template>
  <div class="gantt">
    <p v-if="stages.length === 0" class="hint">{{ t("events.noStages") }}</p>
    <template v-else>
      <div class="gantt-meta">
        <span class="hint">
          {{ t("events.stageTotal", { total: total === null ? t("common.notAvailable") : formatDuration(total) }) }}
        </span>
        <span class="grow" />
        <span class="hint">{{ t("events.stageHint") }}</span>
      </div>

      <div v-if="truncated" class="notice notice-warn">
        <span>{{ t("events.stageTruncated") }}</span>
      </div>

      <ol class="gantt-track">
        <li v-for="stage in stages" :key="stage.key" class="gantt-row">
          <span class="gantt-name" :class="`tone-${statusTone(stage.state)}`">
            {{ label(stage.name) }}
          </span>
          <span class="gantt-bar-wrap">
            <span
              class="gantt-bar"
              :class="[`tone-${statusTone(stage.state)}`, { 'is-open': stage.ms === null }]"
              :style="{ width: width(stage) }"
              :title="`${formatDateTime(stage.startedAt)} → ${
                stage.endedAt === null ? t('events.stageRunning') : formatDateTime(stage.endedAt)
              }`"
            />
          </span>
          <span class="gantt-ms">
            {{ stage.ms === null ? t("events.stageRunning") : formatDuration(stage.ms) }}
          </span>
          <span class="gantt-ts">{{ formatDateTime(stage.startedAt) }}</span>
        </li>
      </ol>
    </template>
  </div>
</template>
