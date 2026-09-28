<script setup lang="ts">
/**
 * 设置面板（右侧全高滑出）：界面语言 / 主题 / 更新源三态 + 自动更新（检查 / 安装 / 手动下载）。
 *
 * 更新失败**不得影响主流程**：这里只展示结果与「手动下载」兜底入口。
 */
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { isMockRuntime } from "@/api";
import {
  checkUpdate,
  installUpdate,
  openExternalUrl,
  openUpdateDialog,
  probeUpdateSources,
  app,
} from "@/stores/app";
import { preferences, updatePreferences } from "@/stores/preferences";
import type { CloseAction, Language, ThemeMode, UpdateSource } from "@/api/types-lite";

const { t } = useI18n();

const emit = defineEmits<{ (e: "close"): void }>();

const languages: { value: Language; label: string }[] = [
  { value: "zh-CN", label: t("settings.languageZh") },
  { value: "en-US", label: t("settings.languageEn") },
];

const themes: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "system", label: t("settings.themeSystem"), icon: "monitor" },
  { value: "light", label: t("settings.themeLight"), icon: "sun" },
  { value: "dark", label: t("settings.themeDark"), icon: "moon" },
];

const sources: { value: UpdateSource; label: string }[] = [
  { value: "auto", label: t("settings.sourceAuto") },
  { value: "gitee", label: t("settings.sourceGitee") },
  { value: "github", label: t("settings.sourceGithub") },
];

const closeActions: { value: CloseAction; label: string; icon: string }[] = [
  { value: "tray", label: t("settings.closeToTray"), icon: "minimize" },
  { value: "exit", label: t("settings.closeApp"), icon: "power" },
];

function probeText(side: "gitee" | "github"): string {
  const probe = app.update.probe;
  if (!probe) return t("common.notAvailable");
  const item = probe[side];
  if (!item.reachable) return t("update.unreachable");
  return t("update.reachable", { ms: item.latencyMs ?? "?" });
}
</script>

<template>
  <div class="poverlay" @click.self="emit('close')">
    <aside class="panel" role="dialog" aria-modal="true" :aria-label="t('settings.title')">
      <header class="panel-head">
        <AppIcon name="settings" />
        <span class="panel-title">{{ t("settings.title") }}</span>
        <span v-if="isMockRuntime" class="tag tone-warn">{{ t("runtime.mock") }}</span>
        <span class="grow" />
        <button class="ibtn" :aria-label="t('common.close')" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="panel-body">
        <section class="pblock">
          <div class="field-label">{{ t("settings.language") }}</div>
          <div class="segmented">
            <button
              v-for="item in languages"
              :key="item.value"
              class="segment"
              :class="{ 'is-active': preferences.language === item.value }"
              @click="updatePreferences({ language: item.value })"
            >
              {{ item.label }}
            </button>
          </div>
        </section>

        <section class="pblock">
          <div class="field-label">{{ t("settings.theme") }}</div>
          <div class="segmented">
            <button
              v-for="item in themes"
              :key="item.value"
              class="segment"
              :class="{ 'is-active': preferences.theme === item.value }"
              @click="updatePreferences({ theme: item.value })"
            >
              <AppIcon :name="item.icon" size="14" /> {{ item.label }}
            </button>
          </div>
        </section>

        <section class="pblock">
          <div class="field-label">{{ t("settings.updateSource") }}</div>
          <div class="segmented">
            <button
              v-for="item in sources"
              :key="item.value"
              class="segment"
              :class="{ 'is-active': preferences.updateSource === item.value }"
              @click="updatePreferences({ updateSource: item.value })"
            >
              {{ item.label }}
            </button>
          </div>
          <div class="inline wrap">
            <button class="tbtn" @click="probeUpdateSources">
              <AppIcon name="globe" />{{ t("update.probe") }}
            </button>
            <span class="hint">
              {{ t("update.probeGitee") }}: {{ probeText("gitee") }} ·
              {{ t("update.probeGithub") }}: {{ probeText("github") }}
            </span>
          </div>
          <div v-if="app.update.probe?.degraded" class="notice notice-warn">
            <AppIcon name="alert" />
            <span>{{ t("update.offlineFallback") }}</span>
          </div>
        </section>

        <section class="pblock">
          <div class="field-label">{{ t("settings.closeWindow") }}</div>
          <div class="segmented">
            <button
              v-for="item in closeActions"
              :key="item.value"
              class="segment"
              :class="{ 'is-active': preferences.closeAction === item.value }"
              @click="updatePreferences({ closeAction: item.value })"
            >
              <AppIcon :name="item.icon" size="14" /> {{ item.label }}
            </button>
          </div>
          <div class="hint">{{ t("settings.closeHint") }}</div>
        </section>

        <div class="divider" />

        <section class="pblock">
          <h3 class="section-title flush">{{ t("update.title") }}</h3>
          <div class="hint">
            {{ t("update.currentVersion", { v: app.update.currentVersion || "—" }) }} ·
            {{ t("update.betaChannel") }}
          </div>

          <div v-if="!app.update.updaterConfigured" class="notice notice-warn">
            <AppIcon name="alert" />
            <span>{{ t("update.pubkeyMissing") }}</span>
          </div>

          <div class="inline wrap">
            <button
              class="tbtn"
              :class="{ 'is-primary': !app.update.checking }"
              :disabled="app.update.checking"
              @click="checkUpdate(preferences.updateSource)"
            >
              <AppIcon name="refresh" />
              {{ app.update.checking ? t("update.checking") : t("update.check") }}
            </button>
            <button
              v-if="app.update.result?.available"
              class="tbtn"
              :disabled="app.update.installing"
              @click="installUpdate(preferences.updateSource)"
            >
              <AppIcon name="download" />
              {{ app.update.installing ? t("update.installing") : t("update.install") }}
            </button>
            <button v-if="app.update.result" class="tbtn" @click="openUpdateDialog()">
              <AppIcon name="info" />{{ t("update.dialogTitle") }}
            </button>
            <button
              v-if="app.update.result?.manualDownloadUrl"
              class="tbtn"
              @click="openExternalUrl(app.update.result.manualDownloadUrl)"
            >
              <AppIcon name="external" />{{ t("update.manualDownload") }}
            </button>
          </div>

          <div v-if="app.update.result" class="notice">
            <AppIcon name="info" />
            <div class="grow">
              <div v-if="app.update.result.error" class="tone-fail">
                {{ t("update.failed", { msg: app.update.result.error }) }}
              </div>
              <div v-else-if="app.update.result.available" class="tone-ok">
                {{ t("update.available", { v: app.update.result.version ?? "" }) }}
              </div>
              <div v-else>{{ t("update.upToDate") }}</div>
              <div v-if="app.update.result.source" class="hint">
                {{ t("update.sourceUsed", { s: app.update.result.source }) }}
              </div>
              <div v-if="preferences.ignoredUpdateVersion" class="hint">
                {{ t("update.ignoredNotice", { v: preferences.ignoredUpdateVersion }) }}
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>