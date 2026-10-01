<script setup lang="ts">
/**
 * 「MCP 能力」整页：展示 tianshu-mcp 当前的工具面（只读镜像）。
 *
 * 数据源 `@/core/capabilities`（内嵌清单，由 `scripts/check-schema-parity.mjs` 与
 * `src/mcp/tools.ts` 对齐）；说明文案取自 i18n 的 `capabilities.tools.<name>`。
 * 本页**不读文件系统、不连 MCP**，是纯静态展示——打开即有内容，与数据目录无关。
 */
import AppIcon from "./AppIcon.vue";
import {
  CAPABILITY_FAMILIES,
  MCP_TOOLS,
  toolsInFamily,
  type ToolCapability,
} from "@/core/capabilities";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const FAMILY_LABEL: Record<ToolCapability, string> = {
  read: "capabilities.familyRead",
  write: "capabilities.familyWrite",
  execute: "capabilities.familyExecute",
};
const FAMILY_HINT: Record<ToolCapability, string> = {
  read: "capabilities.familyReadHint",
  write: "capabilities.familyWriteHint",
  execute: "capabilities.familyExecuteHint",
};
</script>

<template>
  <div class="page caps">
    <header class="caps-head">
      <div class="caps-title">
        <AppIcon name="terminal" size="16" />
        <span class="caps-title-text">{{ t("capabilities.title") }}</span>
        <span class="tag">{{ t("capabilities.count", { n: MCP_TOOLS.length }) }}</span>
      </div>
      <p class="caps-sub">{{ t("capabilities.subtitle") }}</p>
    </header>

    <div class="caps-body">
      <section v-for="fam in CAPABILITY_FAMILIES" :key="fam" class="caps-group">
        <div class="caps-group-head">
          <span class="caps-fam" :class="`fam-${fam}`">{{ t(FAMILY_LABEL[fam]) }}</span>
          <span class="caps-hint">{{ t(FAMILY_HINT[fam]) }}</span>
        </div>

        <ul class="caps-list">
          <li v-for="tool in toolsInFamily(fam)" :key="tool.name" class="caps-item">
            <div class="caps-item-head">
              <code class="caps-name">{{ tool.name }}</code>
              <span class="caps-approval" :class="tool.requireApproval ? 'is-need' : 'is-free'">
                {{ tool.requireApproval ? t("capabilities.approvalRequired") : t("capabilities.approvalFree") }}
              </span>
            </div>
            <p class="caps-desc">{{ t(`capabilities.tools.${tool.name}`) }}</p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.caps {
  overflow: auto;
  padding: var(--sp-6) var(--sp-6) var(--sp-8);
  gap: var(--sp-5);
}

.caps-head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.caps-title {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-family: var(--font-display);
  font-size: var(--fs-18);
  color: var(--fg);
}

.caps-title-text {
  font-weight: 600;
}

.caps-sub {
  margin: 0;
  font-size: var(--fs-12);
  color: var(--fg-dim);
  line-height: var(--lh-body);
}

.caps-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.caps-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.caps-group-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line-hair);
}

/* 族名：eyebrow 风格（大写 + 字距），与全站区段标题一致 */
.caps-fam {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  padding: 2px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-tag);
  color: var(--fg-dim);
}

.caps-fam.fam-read {
  border-color: var(--accent-line);
  color: var(--accent);
}

.caps-fam.fam-write {
  border-color: color-mix(in srgb, var(--tone-warn) 45%, transparent);
  color: var(--tone-warn);
}

.caps-fam.fam-execute {
  border-color: color-mix(in srgb, var(--tone-info) 45%, transparent);
  color: var(--tone-info);
}

.caps-hint {
  font-size: var(--fs-12);
  color: var(--fg-faint);
}

.caps-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.caps-item {
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--line-hair);
  border-radius: var(--r-1);
  background: var(--bg-panel);
}

.caps-item-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.caps-name {
  font-family: var(--font-mono);
  font-size: var(--fs-13);
  color: var(--fg);
}

.caps-approval {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  padding: 1px var(--sp-2);
  border-radius: var(--r-tag);
  border: 1px solid var(--line);
  color: var(--fg-dim);
}

.caps-approval.is-need {
  border-color: color-mix(in srgb, var(--tone-warn) 45%, transparent);
  color: var(--tone-warn);
}

.caps-approval.is-free {
  border-color: var(--accent-line);
  color: var(--accent);
}

.caps-desc {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-12);
  color: var(--fg-dim);
  line-height: var(--lh-body);
}
</style>
