<script setup lang="ts">
/**
 * 更新日志面板（大尺寸居中弹窗）。
 *
 * 两条入口都汇聚到这里：
 *  - 启动静默检查命中且该版本**未被忽略**（`stores/app.ts` 的 `checkUpdateOnStartup`）；
 *  - 手动「检查更新」——结果**一律展示**（「忽略」只压自动提示）。
 *
 * 面板职责（对应需求）：版本对比 → 本次将使用的更新源（含降级如实提示）→ release 正文
 * （Markdown 经 `core/markdown.ts` 渲染，`html: false` 不解析内联 HTML）→ 动作（更新 / 忽略 / 稍后）。
 *
 * 尺寸取自维护者对默认窗口 1440×900 的红框批注：宽约 74.5%、高约 83.6%（≈1070×750）。
 */
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { renderMarkdown } from "@/core/markdown";
import {
  app,
  closeUpdateDialog,
  ignoreUpdateVersion,
  installUpdate,
  openExternalUrl,
} from "@/stores/app";
import { preferences } from "@/stores/preferences";

const { t } = useI18n();

const result = computed(() => app.update.result);
const currentVersion = computed(() => result.value?.currentVersion || app.update.currentVersion || "—");

/** release 正文：Markdown → 受控 HTML（`html: false`，不执行源码里的内联 HTML） */
const notesHtml = computed(() => {
  const src = result.value?.notes?.trim();
  return src ? renderMarkdown(src) : "";
});

/** 本次实际使用的更新源（Rust 侧按实测择优 / 或强制模式给出） */
const sourceLabel = computed(() => {
  const s = result.value?.source;
  if (s === "gitee") return t("update.probeGitee");
  if (s === "github") return t("update.probeGithub");
  return "";
});

/** 该源的探测细节（可达性与延迟）；无探测结果时不显示 */
const sourceProbe = computed(() => {
  const s = result.value?.source;
  if (!s) return null;
  return app.update.probe?.[s] ?? null;
});

const degraded = computed(() => app.update.probe?.degraded === true);
</script>

<template>
  <div class="poverlay" @click.self="closeUpdateDialog()">
    <section
      class="panel is-wide"
      role="dialog"
      aria-modal="true"
      :aria-label="t('update.dialogTitle')"
    >
      <header class="panel-head">
        <AppIcon name="download" />
        <span class="panel-title">{{ t("update.dialogTitle") }}</span>
        <span class="grow" />
        <button class="ibtn" :aria-label="t('common.close')" @click="closeUpdateDialog()">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="dlg-body">
        <div class="dlg-headline">
          <span class="tone-muted">{{ currentVersion }}</span>
          <template v-if="result?.available">
            <AppIcon name="chevronRight" size="14" />
            <span class="dlg-version tone-ok">{{ result.version }}</span>
          </template>
        </div>

        <div v-if="app.update.checking && !result" class="hint">{{ t("update.checking") }}</div>

        <div v-else-if="result && !result.available && !result.error" class="notice notice-ok">
          <AppIcon name="check" />
          <span>{{ t("update.upToDate") }}</span>
        </div>

        <div v-if="result?.error" class="notice notice-error">
          <AppIcon name="alert" />
          <span>{{ t("update.failed", { msg: result.error }) }}</span>
        </div>

        <div v-if="sourceLabel" class="hint">
          {{ t("update.sourceUsed", { s: sourceLabel }) }}
          <template v-if="sourceProbe">
            ·
            {{
              sourceProbe.reachable
                ? t("update.reachable", { ms: sourceProbe.latencyMs ?? "?" })
                : t("update.unreachable")
            }}
          </template>
        </div>

        <div v-if="degraded" class="notice notice-warn">
          <AppIcon name="alert" />
          <span>{{ t("update.offlineFallback") }}</span>
        </div>

        <div class="dlg-notes">
          <div v-if="notesHtml" class="md" v-html="notesHtml" />
          <div v-else-if="result?.available" class="hint">{{ t("update.releaseNotesEmpty") }}</div>
        </div>
      </div>

      <footer class="dlg-foot">
        <button
          v-if="result?.available"
          class="tbtn is-primary"
          :disabled="app.update.installing"
          @click="installUpdate(preferences.updateSource)"
        >
          <AppIcon name="download" />
          {{ app.update.installing ? t("update.installing") : t("update.install") }}
        </button>
        <button
          v-if="result?.manualDownloadUrl"
          class="tbtn"
          @click="openExternalUrl(result.manualDownloadUrl)"
        >
          <AppIcon name="external" />{{ t("update.manualDownload") }}
        </button>

        <span class="grow" />

        <button
          v-if="result?.available"
          class="tbtn"
          @click="ignoreUpdateVersion(result.version)"
        >
          {{ t("update.ignoreVersion") }}
        </button>
        <button class="tbtn" @click="closeUpdateDialog()">{{ t("update.later") }}</button>
      </footer>
    </section>
  </div>
</template>
