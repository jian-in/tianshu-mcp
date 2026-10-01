<script setup lang="ts">
/**
 * 命令面板（`Ctrl/Cmd + K`）：输入即模糊过滤，回车 / 点击派发命令 `id`。
 *
 * 本组件**不知道任何视图状态**：命令目录与动作分发都在外壳（`App.vue`）——
 * 这里只负责渲染、键盘导航与派发 `id`（详见 `@/core/palette`）。
 */
import { computed, nextTick, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { filterCommands, stepIndex, type PaletteCommand } from "@/core/palette";

const props = defineProps<{ commands: PaletteCommand[] }>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "close"): void;
}>();

const { t } = useI18n();
const query = ref("");
const index = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

const results = computed(() => filterCommands(props.commands, query.value));

// 结果集变化后重置高亮，避免越界指向已消失的项
watch(results, () => {
  index.value = stepIndex(results.value.length, index.value, 0);
});

async function focusInput(): Promise<void> {
  await nextTick();
  inputEl.value?.focus();
}
void focusInput();

function onInput(): void {
  index.value = 0;
}

function move(delta: number): void {
  index.value = stepIndex(results.value.length, index.value, delta);
}

function choose(at: number): void {
  const picked = results.value[at];
  if (!picked) return;
  emit("select", picked.id);
}

function onKeydown(event: KeyboardEvent): void {
  // 面板内自行处理导航键：`Esc` 关闭、上下移动、回车执行。
  // 全局 `Ctrl/Cmd + K` 由外壳的 window 监听处理（会走同一个关闭分支）。
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    choose(index.value);
  }
}
</script>

<template>
  <div class="poverlay poverlay-top" @click.self="emit('close')">
    <div class="palette" role="dialog" aria-modal="true" :aria-label="t('palette.title')">
      <div class="palette-head">
        <AppIcon name="command" size="14" />
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          :placeholder="t('palette.placeholder')"
          :aria-label="t('palette.placeholder')"
          @keydown="onKeydown"
          @input="onInput"
        />
        <span class="tag palette-key">{{ t("palette.shortcut") }}</span>
      </div>

      <ul v-if="results.length > 0" class="palette-list">
        <li v-for="(item, i) in results" :key="item.id">
          <button
            class="palette-item"
            :class="{ 'is-active': i === index }"
            @mouseenter="index = i"
            @click="choose(i)"
          >
            <span class="grow truncate">{{ item.label }}</span>
            <span v-if="item.hint" class="hint truncate">{{ item.hint }}</span>
          </button>
        </li>
      </ul>
      <div v-else class="empty palette-empty">{{ t("palette.empty") }}</div>

      <div class="palette-foot hint">{{ t("palette.footHint") }}</div>
    </div>
  </div>
</template>
