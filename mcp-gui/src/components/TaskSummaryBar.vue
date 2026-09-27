<script setup lang="ts">
/**
 * 工作区 · 任务摘要带：默认单行读数，展开后给出完整元信息 / 改动文件 / 导出整包。
 *
 * 版式基线：单行摘要 + 右侧 `任务元信息 ⌄` 折叠开关（展开内容不占独立栏）。
 */
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import StatusBadge from "./StatusBadge.vue";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/core/format";
import { taskDirRel } from "@/core/paths";
import { app } from "@/stores/app";
import type { TaskSummary } from "@/api/types";

const props = defineProps<{
  task: TaskSummary;
  expanded: boolean;
  excludeHeavyLogs: boolean;
  message: string | null;
}>();

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "set-exclude", value: boolean): void;
}>();

const { t } = useI18n();
const copied = ref(false);

const taskDirAbsolute = computed(() => {
  const home = app.dataHome.active.replace(/[\\/]+$/, "");
  return `${home}/${taskDirRel(props.task.taskId)}`;
});

const exclude = computed({
  get: () => props.excludeHeavyLogs,
  set: (value: boolean) => emit("set-exclude", value),
});

async function copyDir(): Promise<void> {
  try {
    await navigator.clipboard.writeText(taskDirAbsolute.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <section class="summary">
    <div class="summary-line">
      <StatusBadge :status="props.task.status" />
      <span v-if="props.task.dryRun" class="tag tone-info">{{ t("tasks.dryRun") }}</span>
      <span class="summary-fact">{{ props.task.agentId }}</span>
      <span class="summary-fact">
        {{ t("detail.rounds") }} {{ props.task.roundsUsed }}
      </span>
      <span class="summary-fact">{{ formatDateTime(props.task.updatedAt) }}</span>
      <span class="summary-fact">
        {{ t("detail.changedFiles") }} {{ props.task.changedFiles.length }}
      </span>
      <span class="grow" />
      <button class="summary-toggle" :aria-expanded="props.expanded" @click="emit('toggle')">
        {{ t("detail.meta") }}
        <AppIcon :name="props.expanded ? 'chevronUp' : 'chevronDown'" size="12" />
      </button>
    </div>

    <div v-if="props.expanded" class="summary-body">
      <div>
        <h3 class="section-title">{{ t("detail.meta") }}</h3>
        <dl class="kv">
          <dt>{{ t("detail.taskId") }}</dt>
          <dd>{{ props.task.taskId }}</dd>
          <dt>{{ t("detail.agent") }}</dt>
          <dd>{{ props.task.agentId }}</dd>
          <dt>{{ t("detail.workspace") }}</dt>
          <dd>
            {{
              props.task.workspaceMode === "default"
                ? t("workspaceMode.default")
                : t("workspaceMode.project")
            }}
          </dd>
          <dt>{{ t("detail.project") }}</dt>
          <dd>{{ props.task.displayPath || props.task.projectPath || t("common.none") }}</dd>
          <dt>{{ t("detail.reportRound") }}</dt>
          <dd>{{ props.task.reportRound ?? t("common.notAvailable") }}</dd>
          <dt>{{ t("detail.createdAt") }}</dt>
          <dd>{{ formatDateTime(props.task.createdAt) }}</dd>
          <dt>{{ t("detail.finishedAt") }}</dt>
          <dd>{{ formatDateTime(props.task.finishedAt) }}</dd>
          <dt>{{ t("detail.errorType") }}</dt>
          <dd>{{ props.task.errorType ?? t("common.none") }}</dd>
          <dt>{{ t("detail.lastMessage") }}</dt>
          <dd>{{ props.task.lastMessage ?? t("common.none") }}</dd>
          <dt>{{ t("detail.checkSummary") }}</dt>
          <dd>{{ props.task.checkSummary || t("common.none") }}</dd>
          <dt>{{ t("detail.diffstat") }}</dt>
          <dd>{{ props.task.diffstat || t("common.none") }}</dd>
        </dl>
      </div>

      <div>
        <h3 class="section-title">{{ t("detail.changedFiles") }}</h3>
        <div v-if="props.task.changedFiles.length === 0" class="hint">{{ t("common.none") }}</div>
        <div v-else class="file-list">
          <span v-for="file in props.task.changedFiles" :key="file" class="truncate" :title="file">
            {{ file }}
          </span>
        </div>
      </div>

      <div>
        <h3 class="section-title">{{ t("detail.copyPath") }}</h3>
        <div class="inline wrap">
          <button class="tbtn" @click="copyDir">
            <AppIcon :name="copied ? 'check' : 'copy'" />{{ t("detail.copyPath") }}
          </button>
          <label class="check">
            <input v-model="exclude" type="checkbox" />
            <span>{{ t("export.excludeHeavyLogs") }}</span>
          </label>
          <span v-if="props.message" class="hint">{{ props.message }}</span>
        </div>
      </div>
    </div>
  </section>
</template>