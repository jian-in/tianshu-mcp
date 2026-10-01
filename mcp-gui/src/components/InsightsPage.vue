<script setup lang="ts">
/**
 * 洞察页（A1 效能看板 / A2 失败归因 / A3 时间趋势）。
 *
 * 数据只来自 `app.insights`（经 `@/api` 的 `getInsights`），本页不做取数逻辑；
 * 比率 / TopN / 趋势补齐 / 周历聚合全部走 `@/core/insights` 的纯函数（计划 D4）。
 * 口径（UTC 日期、周一为周始、一次通过 = 成功且 1 轮、返修 = `roundsUsed > 1`）
 * 在副标题与分区标题里显式标注——不猜、不含糊。
 */
import { computed, onMounted, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useI18n } from "@/i18n";
import { avg, fillTrend, rate, reworkRate, sortGroups, toWeeks, topN } from "@/core/insights";
import { formatDuration } from "@/core/format";
import { app, loadInsights } from "@/stores/app";
import type { InsightsDay, InsightsGroup, InsightsReasonKind } from "@/api/types";

const { t } = useI18n();

type Section = "board" | "reasons" | "trend";
type TrendBucket = InsightsDay & { key: string };

const section = ref<Section>("board");
const trendMode = ref<"day" | "week">("day");
/** 归因每类展示的条数（其余折叠计数，不静默丢弃） */
const TOP_N = 10;

const SECTIONS: { key: Section; labelKey: string }[] = [
  { key: "board", labelKey: "insights.sectionBoard" },
  { key: "reasons", labelKey: "insights.sectionReasons" },
  { key: "trend", labelKey: "insights.sectionTrend" },
];

const REASON_KINDS: InsightsReasonKind[] = [
  "errorType",
  "failedCheck",
  "blockingIssue",
  "signal",
];

const data = computed(() => app.insights.data);

onMounted(() => {
  // 计划 D12：进页加载一次（已有数据则不重复请求），刷新走页内按钮
  if (!app.insights.data) void loadInsights();
});

/* ---------------- 展示格式化 ---------------- */

function pct(value: number | null): string {
  return value === null ? t("common.notAvailable") : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null, digits = 2): string {
  return value === null ? t("common.notAvailable") : value.toFixed(digits);
}

function ms(value: number | null): string {
  return value === null ? t("common.notAvailable") : formatDuration(value);
}

interface GroupRow {
  key: string;
  total: string;
  successRate: string;
  avgRounds: string;
  onePassRate: string;
  avgVerify: string;
  reportsMissing: string;
}

function toRow(group: InsightsGroup): GroupRow {
  const s = group.summary;
  return {
    key: group.key === "" ? t("insights.unknownKey") : group.key,
    total: String(s.total),
    successRate: pct(rate(s.succeeded, s.total)),
    avgRounds: num(avg(s.roundsSum, s.total)),
    onePassRate: pct(rate(s.onePassCount, s.total)),
    avgVerify: ms(avg(s.verifyMsSum, s.verifyMsCount)),
    reportsMissing: String(s.reportsMissing),
  };
}

const agentRows = computed<GroupRow[]>(() => sortGroups(data.value?.agents ?? [], "total").map(toRow));
const projectRows = computed<GroupRow[]>(() =>
  sortGroups(data.value?.projects ?? [], "total").map(toRow),
);

const reasonGroups = computed(() =>
  REASON_KINDS.map((kind) => {
    const items = (data.value?.reasons ?? []).filter((r) => r.kind === kind);
    const total = items.reduce((sum, r) => sum + r.count, 0);
    return {
      kind,
      total,
      hidden: Math.max(0, items.length - TOP_N),
      rows: topN(items, TOP_N).map((r) => ({
        key: r.key,
        count: r.count,
        share: total > 0 ? r.count / total : 0,
      })),
    };
  }),
);

/* ---------------- 趋势（按天 / 按周，纯内联 SVG，不引图表库） ---------------- */

const trendBuckets = computed<TrendBucket[]>(() => {
  const days = data.value?.days ?? [];
  if (trendMode.value === "week") {
    return toWeeks(days).map((week) => ({ ...week, key: week.weekStart }));
  }
  return fillTrend(days, app.insights.from, app.insights.to).map((d) => ({ ...d, key: d.date }));
});

const CHART_W = 100;
const CHART_H = 34;
const CHART_PAD = 2;

const trendMax = computed(() => trendBuckets.value.reduce((max, b) => Math.max(max, b.total), 0));

const bars = computed(() => {
  const buckets = trendBuckets.value;
  if (buckets.length === 0) return [];
  const inner = CHART_W - CHART_PAD * 2;
  const slot = inner / buckets.length;
  // 柱宽随档位数收缩，但**设上限**：只有 1–2 个桶时按比例会撑成一整块（viewBox 只有 100 宽）
  const barW = Math.min(slot * 0.6, 4);
  const scale = Math.max(1, trendMax.value);
  return buckets.map((bucket, i) => {
    const h = (bucket.total / scale) * (CHART_H - CHART_PAD * 2);
    return {
      key: bucket.key,
      total: bucket.total,
      x: CHART_PAD + slot * i + (slot - barW) / 2,
      y: CHART_H - CHART_PAD - h,
      w: barW,
      h,
    };
  });
});

/** 折线点串；比率为 `null`（该桶无任务）时**断开**，不补 0 假装跌到 0% */
function linePoints(pick: (bucket: InsightsDay) => number | null): string {
  const buckets = trendBuckets.value;
  if (buckets.length === 0) return "";
  const inner = CHART_W - CHART_PAD * 2;
  const slot = inner / buckets.length;
  const points: string[] = [];
  buckets.forEach((bucket, i) => {
    const value = pick(bucket);
    if (value === null) return;
    const x = CHART_PAD + slot * i + slot / 2;
    const y = CHART_H - CHART_PAD - value * (CHART_H - CHART_PAD * 2);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  return points.join(" ");
}

const successLine = computed(() => linePoints((b) => rate(b.succeeded, b.total)));
const reworkLine = computed(() => linePoints((b) => reworkRate(b)));
</script>

<template>
  <div class="page ins">
    <header class="ins-head">
      <div class="ins-title">
        <AppIcon name="insights" size="16" />
        <span class="ins-title-text">{{ t("insights.title") }}</span>
      </div>
      <p class="ins-sub">{{ t("insights.subtitle") }}</p>

      <div class="ins-bar">
        <div class="segmented" role="tablist" :aria-label="t('insights.title')">
          <button
            v-for="item in SECTIONS"
            :key="item.key"
            class="segment"
            :class="{ 'is-active': section === item.key }"
            role="tab"
            :aria-selected="section === item.key"
            @click="section = item.key"
          >
            {{ t(item.labelKey) }}
          </button>
        </div>
        <span class="grow" />
        <span v-if="data" class="hint ins-scale">
          {{
            t("insights.scale", {
              tasks: data.scannedTasks,
              reports: data.scannedReports,
              bad: data.badReports,
            })
          }}
        </span>
        <button class="tbtn" :disabled="app.insights.loading" @click="loadInsights()">
          <AppIcon name="refresh" size="12" />
          {{ app.insights.loading ? t("common.loading") : t("common.refresh") }}
        </button>
      </div>
    </header>

    <div v-if="!data" class="empty">
      {{ app.insights.loading ? t("common.loading") : t("insights.empty") }}
    </div>

    <div v-else class="ins-body">
      <!-- A1 效能看板 -->
      <template v-if="section === 'board'">
        <section class="ins-block">
          <h2 class="ins-block-title">{{ t("insights.boardAgents") }}</h2>
          <p class="ins-block-hint">{{ t("insights.boardHint") }}</p>
          <div class="ins-table" role="table">
            <div class="ins-tr ins-th" role="row">
              <span role="columnheader">{{ t("insights.colName") }}</span>
              <span role="columnheader">{{ t("insights.colTotal") }}</span>
              <span role="columnheader">{{ t("insights.colSuccessRate") }}</span>
              <span role="columnheader">{{ t("insights.colAvgRounds") }}</span>
              <span role="columnheader">{{ t("insights.colOnePassRate") }}</span>
              <span role="columnheader">{{ t("insights.colAvgVerify") }}</span>
              <span role="columnheader">{{ t("insights.colReportsMissing") }}</span>
            </div>
            <div v-for="row in agentRows" :key="row.key" class="ins-tr" role="row">
              <span class="ins-key" role="cell">{{ row.key }}</span>
              <span role="cell">{{ row.total }}</span>
              <span role="cell">{{ row.successRate }}</span>
              <span role="cell">{{ row.avgRounds }}</span>
              <span role="cell">{{ row.onePassRate }}</span>
              <span role="cell">{{ row.avgVerify }}</span>
              <span role="cell">{{ row.reportsMissing }}</span>
            </div>
          </div>
        </section>

        <section class="ins-block">
          <h2 class="ins-block-title">{{ t("insights.boardProjects") }}</h2>
          <div class="ins-table" role="table">
            <div class="ins-tr ins-th" role="row">
              <span role="columnheader">{{ t("insights.colName") }}</span>
              <span role="columnheader">{{ t("insights.colTotal") }}</span>
              <span role="columnheader">{{ t("insights.colSuccessRate") }}</span>
              <span role="columnheader">{{ t("insights.colAvgRounds") }}</span>
              <span role="columnheader">{{ t("insights.colOnePassRate") }}</span>
              <span role="columnheader">{{ t("insights.colAvgVerify") }}</span>
              <span role="columnheader">{{ t("insights.colReportsMissing") }}</span>
            </div>
            <div v-for="row in projectRows" :key="row.key" class="ins-tr" role="row">
              <span class="ins-key" role="cell">{{ row.key }}</span>
              <span role="cell">{{ row.total }}</span>
              <span role="cell">{{ row.successRate }}</span>
              <span role="cell">{{ row.avgRounds }}</span>
              <span role="cell">{{ row.onePassRate }}</span>
              <span role="cell">{{ row.avgVerify }}</span>
              <span role="cell">{{ row.reportsMissing }}</span>
            </div>
          </div>
        </section>
      </template>

      <!-- A2 失败归因 -->
      <template v-else-if="section === 'reasons'">
        <section v-for="group in reasonGroups" :key="group.kind" class="ins-block">
          <h2 class="ins-block-title">
            {{ t(`insights.reasonKind.${group.kind}`) }}
            <span class="tag">{{ group.total }}</span>
          </h2>
          <p v-if="group.rows.length === 0" class="hint">{{ t("insights.reasonEmpty") }}</p>
          <ul v-else class="ins-reasons">
            <li v-for="row in group.rows" :key="row.key" class="ins-reason">
              <code class="ins-reason-key">{{ row.key }}</code>
              <span class="ins-reason-bar">
                <span class="ins-reason-fill" :style="{ width: `${(row.share * 100).toFixed(1)}%` }" />
              </span>
              <span class="ins-reason-count">{{ row.count }}</span>
            </li>
          </ul>
          <p v-if="group.hidden > 0" class="hint">
            {{ t("insights.reasonHidden", { n: group.hidden }) }}
          </p>
        </section>
      </template>

      <!-- A3 时间趋势 -->
      <template v-else>
        <section class="ins-block">
          <h2 class="ins-block-title">{{ t("insights.sectionTrend") }}</h2>
          <p class="ins-block-hint">
            {{ trendMode === "week" ? t("insights.trendWeekHint") : t("insights.trendUtcHint") }}
          </p>

          <div class="ins-bar">
            <div class="segmented">
              <button
                class="segment"
                :class="{ 'is-active': trendMode === 'day' }"
                @click="trendMode = 'day'"
              >
                {{ t("insights.trendByDay") }}
              </button>
              <button
                class="segment"
                :class="{ 'is-active': trendMode === 'week' }"
                @click="trendMode = 'week'"
              >
                {{ t("insights.trendByWeek") }}
              </button>
            </div>
            <span class="grow" />
            <span class="ins-legend">
              <span class="ins-legend-item"><i class="ins-dot ins-dot-total" />{{ t("insights.trendTasks") }}</span>
              <span class="ins-legend-item"><i class="ins-dot ins-dot-success" />{{ t("insights.trendSuccessRate") }}</span>
              <span class="ins-legend-item"><i class="ins-dot ins-dot-rework" />{{ t("insights.trendReworkRate") }}</span>
            </span>
          </div>

          <p v-if="trendBuckets.length === 0" class="hint">{{ t("insights.trendEmpty") }}</p>
          <template v-else>
            <svg
              class="ins-chart"
              :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
              preserveAspectRatio="none"
              role="img"
              :aria-label="t('insights.sectionTrend')"
            >
              <rect
                v-for="bar in bars"
                :key="bar.key"
                class="ins-bar-rect"
                :x="bar.x"
                :y="bar.y"
                :width="bar.w"
                :height="bar.h"
              >
                <title>{{ `${bar.key} · ${t("insights.trendTasks")} ${bar.total}` }}</title>
              </rect>
              <polyline v-if="successLine" class="ins-line ins-line-success" :points="successLine" />
              <polyline v-if="reworkLine" class="ins-line ins-line-rework" :points="reworkLine" />
            </svg>

            <div class="ins-xaxis">
              <span>{{ trendBuckets[0]?.key }}</span>
              <span>{{ trendBuckets[trendBuckets.length - 1]?.key }}</span>
            </div>

            <div class="ins-table ins-trend-table" role="table">
              <div class="ins-tr ins-th" role="row">
                <span role="columnheader">{{ t("insights.colBucket") }}</span>
                <span role="columnheader">{{ t("insights.colTotal") }}</span>
                <span role="columnheader">{{ t("insights.colSuccessRate") }}</span>
                <span role="columnheader">{{ t("insights.trendReworkRate") }}</span>
              </div>
              <div v-for="bucket in trendBuckets" :key="bucket.key" class="ins-tr" role="row">
                <span class="ins-key" role="cell">{{ bucket.key }}</span>
                <span role="cell">{{ bucket.total }}</span>
                <span role="cell">{{ pct(rate(bucket.succeeded, bucket.total)) }}</span>
                <span role="cell">{{ pct(reworkRate(bucket)) }}</span>
              </div>
            </div>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>
