<script setup lang="ts">
/**
 * 任务状态标签（终端风：`[OK] 已成功`）。
 *
 * 短码由 tone 决定（语言无关的终端惯例，不进 i18n）；文案仍走 i18n。
 */
import { computed } from "vue";
import { useI18n } from "@/i18n";
import { statusTone, type StatusTone } from "@/core/status";

const props = withDefaults(defineProps<{ status: string; dot?: boolean }>(), { dot: false });
const { t } = useI18n();

const CODE: Record<StatusTone, string> = {
  active: "RUN",
  ok: "OK",
  fail: "FAIL",
  warn: "WARN",
  info: "WAIT",
  muted: "IDLE",
};

const tone = computed(() => statusTone(props.status));
const code = computed(() => CODE[tone.value]);
const label = computed(() => {
  const text = t(`status.${props.status}`);
  return text.startsWith("status.") ? props.status : text;
});
</script>

<template>
  <span class="state" :class="`tone-${tone}`" :title="label">
    <span v-if="props.dot" class="dot" />
    <span class="state-code">{{ code }}</span>
    <span class="state-label">{{ label }}</span>
  </span>
</template>