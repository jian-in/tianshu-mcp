<script setup lang="ts">
/**
 * 任务卡（概览页网格单元）：左侧状态脊 + `›` 提示符标题 + 两行等宽元信息。
 */
import StatusBadge from "./StatusBadge.vue";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/core/format";
import { statusTone } from "@/core/status";
import type { TaskSummary } from "@/api/types";

const props = defineProps<{ task: TaskSummary }>();
const emit = defineEmits<{ (e: "open", taskId: string): void }>();
const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="tcard"
    :data-tone="statusTone(props.task.status)"
    :title="props.task.task || props.task.taskId"
    @click="emit('open', props.task.taskId)"
  >
    <span class="tcard-tags">
      <StatusBadge :status="props.task.status" />
      <span v-if="props.task.dryRun" class="tag tone-info">{{ t("tasks.dryRun") }}</span>
    </span>
    <span class="tcard-title">{{ props.task.task || props.task.taskId }}</span>
    <span class="tcard-meta">{{ props.task.agentId }} · {{ props.task.taskId }}</span>
    <span class="tcard-meta">
      {{ formatDateTime(props.task.updatedAt) }} · {{ t("tasks.rounds", { used: props.task.roundsUsed })
      }}<template v-if="props.task.reportRound !== null">
        · {{ t("tasks.reportRound", { n: props.task.reportRound }) }}</template
      >
    </span>
  </button>
</template>