/**
 * A6 状态跃迁甘特（纯函数，可单测）。
 *
 * 只看**状态跃迁事件**（`kind === "status"`）：把它们按时间顺序切成阶段
 * （`created → started → verify_start → fix_start → … → succeeded/failed`），
 * 每个阶段的结束时间 = **下一条状态事件的开始时间**；最后一条没有结束时间，如实留 `null`（界面标「进行中」）。
 *
 * 口径：
 * - 时间解析用 `parseUtcMillis`（只认 UTC `Z` 写法）；**任一端不可解析即 `ms = null`**，不编造时长；
 * - 阶段时长之和不等于「任务总时长」时如实分别展示，不做归一化；
 * - 不猜测缺失的状态（例如中间没记 `verify_start` 就不补一段）。
 */
import { parseUtcMillis } from "@/core/insights";
import type { TaskEvent } from "@/api/types";

export interface TimelineStage {
  /** 稳定 key（序号 + 事件名，同一任务内唯一） */
  key: string;
  /** 事件名（`created` / `started` / `verify_start` / `succeeded` …），文案由 i18n 的 `eventName.*` 提供 */
  name: string;
  /** 该阶段开始时的状态（`queued` / `running` / …） */
  state: string;
  startedAt: string;
  /** 下一条状态事件的开始时间；最后一条为 `null`（进行中 / 已停更） */
  endedAt: string | null;
  /** `endedAt - startedAt`（ms）；任一端不可解析或为负 → `null` */
  ms: number | null;
}

export function buildStages(events: TaskEvent[]): TimelineStage[] {
  const status = events.filter((event) => event.kind === "status");
  return status.map((event, index) => {
    const next = status[index + 1] ?? null;
    const startedAt = event.ts;
    const endedAt = next ? next.ts : null;
    return {
      key: `${index}:${event.event}`,
      name: event.event,
      state: event.state,
      startedAt,
      endedAt,
      ms: spanMs(startedAt, endedAt),
    };
  });
}

function spanMs(startedAt: string, endedAt: string | null): number | null {
  if (endedAt === null) return null;
  const start = parseUtcMillis(startedAt);
  const end = parseUtcMillis(endedAt);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

/** 阶段总时长（ms）：只累加可解析阶段；一个都没有时返回 `null`（不编造） */
export function totalMs(stages: TimelineStage[]): number | null {
  let sum = 0;
  let counted = 0;
  for (const stage of stages) {
    if (stage.ms === null) continue;
    sum += stage.ms;
    counted += 1;
  }
  return counted === 0 ? null : sum;
}

/** 各阶段在总时长里的占比（用于横向条宽）；时长不可得时为 `null`，由界面渲染成「进行中」段 */
export function stageShare(stage: TimelineStage, total: number | null): number | null {
  if (total === null || total <= 0 || stage.ms === null) return null;
  return stage.ms / total;
}
