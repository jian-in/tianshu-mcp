/**
 * MiniMax Code 模型 / 推理等级 / 上下文窗口（三件套）。
 *
 * 真机实测（2026-10-05，MiniMax Code 3.1.0）确立的两条硬事实：
 *
 * 1) **档位与窗口不是平铺项，而在二级子菜单里**。产品前端产物里的源码常量
 *    （`role:"group","aria-label":<模型名>+" 上下文窗口"` 等）显示它们是平铺渲染的，
 *    但真机 DOM 探测**只在悬停某个模型项之后**才出现：带 `aria-haspopup="menu"` 的项
 *    悬停后 `aria-expanded` 变 `"true"`，窗口里出现第二个 `role="menu"`，
 *    其中才是 `role=group[aria-label=推理等级]` 与 `[data-testid=model-context-control]`。
 *    → 因此「选模型 → 读档位/窗口」必须走「悬停展开 → 选档位/窗口」三步；
 *      直接点模型项会**立即提交切换并关闭菜单**（实测），什么也读不到。
 *
 * 2) **不是每个模型都有子菜单**。实测 `M3.1-Flash-Preview` / `M3` / `deepseek-v4.1-flash`
 *    带 `aria-haspopup="menu"`；`M2.7-highspeed` / `M2.7` **不带**（`aria-haspopup` 为 null）。
 *    → 指定了 `reasoningLevel`/`contextWindow` 却选到无子菜单的模型时，必须在发送前
 *      响亮报错（fail-closed），绝不静默沿用界面当前档。
 *
 * 实测档位集合：`default` / `low` / `medium` / `high` / `xhigh` / `max`（六档）。
 * 实测上下文窗口候选：`512K` / `1M`（`1M` 带「用量较高」标记）。
 *
 * 全部比较一律 NFKC 归一 + 折叠空白 + 大小写不敏感；**精确**匹配是硬要求：
 * `M3` 与 `M3.1-Flash-Preview` 并存，前缀命中会把任务派到不同模型上。
 */

/** MiniMax Code 实测的推理档位（六档；界面文本即 `default`/`low`/…/`max`） */
export type MinimaxLevel = "default" | "low" | "medium" | "high" | "xhigh" | "max";

/** 档位的规范顺序（读到的标签集合按此排序，便于比较与展示） */
const CANONICAL_LEVEL_ORDER: MinimaxLevel[] = ["default", "low", "medium", "high", "xhigh", "max"];

/** 界面档位文本 → 内部档位：**就是同名小写**（实测界面直接渲染 default/low/medium/high/xhigh/max）。 */
const LEVEL_TOKENS: Record<string, MinimaxLevel> = {
  default: "default",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * 调用方可能传来的档位别名 → 内部档位。
 *
 * **刻意只接受界面实际存在的六档 + 中英同义词**：
 * - `中`/`medium` → medium（界面确实有 medium，这是本产品与 Kimi Code 的关键差异）；
 * - `极高` → xhigh；`最大` → max；`关闭思考` → 不映射（本产品无该档，交给 unsupported 报错）。
 * 未列出的值一律 unsupported（fail-closed），静默丢弃会让「传了不支持的值」变成「沿用当前档」。
 */
const LEVEL_ALIASES: Record<string, MinimaxLevel> = {
  default: "default",
  默认: "default",
  low: "low",
  低: "low",
  medium: "medium",
  中: "medium",
  high: "high",
  高: "high",
  xhigh: "xhigh",
  极高: "xhigh",
  max: "max",
  最大: "max",
};

/** 报错时的「收到」写法：中英对照，让用户能对上自己传的那个值 */
const LEVEL_RECEIPT: Record<string, string> = {
  默认: "「默认」（default）",
  default: "「默认」（default）",
  低: "「低」（low）",
  low: "「低」（low）",
  中: "「中」（medium）",
  medium: "「中」（medium）",
  高: "「高」（high）",
  high: "「高」（high）",
  极高: "「极高」（xhigh）",
  xhigh: "「极高」（xhigh）",
  最大: "「最大」（max）",
  max: "「最大」（max）",
};

export function normalizeKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** UI 文本归一比较（NFKC + 折叠空白 + 大小写不敏感） */
export function exactUiName(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

/** 界面 token → 档位；无法识别返回 undefined */
export function levelOfToken(token: string): MinimaxLevel | undefined {
  return LEVEL_TOKENS[normalizeKey(token)];
}

/**
 * 请求值归一：`中/medium → medium` 等。无法识别的值原样放在 unsupported 里供调用方报错。
 */
export function normalizeReasoningLevel(value: string | undefined): {
  level?: MinimaxLevel;
  unsupported?: string;
} {
  const raw = value?.normalize("NFKC").trim() ?? "";
  if (!raw) return {};
  const level = LEVEL_ALIASES[normalizeKey(raw)];
  return level ? { level } : { unsupported: raw };
}

export interface MinimaxModelSpec {
  model: string;
  level?: MinimaxLevel;
  /** 请求了但界面档位集合不支持的原始值（用于报错） */
  unsupported?: string;
  /** 请求的上下文窗口（界面候选文本，如 `1M`）；未指定为 undefined（不切换） */
  contextWindow?: string;
}

/** 界面档位集合（读不到时为 unknown，fail-closed） */
export interface MinimaxTierSet {
  tiers: MinimaxLevel[];
  kind: "known" | "unknown";
}

/**
 * 由界面实际档位标签集合判定档位集合。
 * 一个可识别的档位都读不到 → unknown（调用方据此拒绝猜测）。
 */
export function tierSetOf(labels: string[]): MinimaxTierSet {
  const levels = new Set<MinimaxLevel>();
  for (const label of labels) {
    const level = levelOfToken(label);
    if (level) levels.add(level);
  }
  const tiers = CANONICAL_LEVEL_ORDER.filter((level) => levels.has(level));
  return { tiers, kind: tiers.length ? "known" : "unknown" };
}

/** 档位集合的界面写法（实测 `default/low/medium/high/xhigh/max`） */
export function tierLabels(tiers: MinimaxTierSet): string {
  return tiers.tiers.join("/") || "（空）";
}

function receiptOf(value: string): string {
  return LEVEL_RECEIPT[normalizeKey(value)] ?? `「${value}」`;
}

/**
 * 校验请求档位是否落在**界面实际档位集合**内。
 * 读不到档位标签（unknown）一律 fail-closed：宁可报错也不要按内置名单猜，
 * 否则模型切换/UI 升级后会把不支持的值"成功"发出去。
 */
export function assertLevelSupported(spec: MinimaxModelSpec, tiers: MinimaxTierSet): void {
  if (tiers.kind === "unknown")
    throw new Error(
      `无法从界面读到模型 ${spec.model} 的推理等级标签（读到 ${tierLabels(tiers)}），拒绝猜测档位；请检查 MiniMax Code 版本与选择器`,
    );
  const labels = tierLabels(tiers);
  if (spec.unsupported !== undefined)
    throw new Error(`模型 ${spec.model} 的推理等级仅支持 ${labels}，收到${receiptOf(spec.unsupported)}`);
  if (spec.level && !tiers.tiers.includes(spec.level))
    throw new Error(`模型 ${spec.model} 的推理等级仅支持 ${labels}，收到${receiptOf(spec.level)}`);
}

/**
 * 校验请求的上下文窗口是否落在**界面实际候选**内。
 * 候选为空（子菜单没展开/选择器失效）一律 fail-closed——绝不静默沿用当前窗口，
 * 否则「我要 1M」会变成「悄悄用了 512K」。
 */
export function assertContextWindowSupported(
  spec: MinimaxModelSpec,
  candidates: string[],
): void {
  if (!spec.contextWindow) return;
  const available = candidates.filter(Boolean);
  if (!available.length)
    throw new Error(
      `无法从界面读到模型 ${spec.model} 的上下文窗口候选，拒绝猜测（请求值 ${spec.contextWindow}）；请检查 MiniMax Code 版本与选择器`,
    );
  const hit = available.find((c) => exactUiName(c, spec.contextWindow!));
  if (!hit)
    throw new Error(
      `模型 ${spec.model} 的上下文窗口仅支持 ${available.join("/")}，收到「${spec.contextWindow}」`,
    );
}

/** 界面上的档位/窗口精确匹配（NFKC + 折叠空白 + 大小写不敏感） */
export function optionMatches(uiLabel: string, wanted: string): boolean {
  return exactUiName(uiLabel, wanted);
}

/**
 * 解析模型触发器文本。
 *
 * 实测两种形态：
 * - 无子菜单的模型：单行模型名（`M2.7-highspeed`）；
 * - 选定带子菜单的模型后：两行「模型名 + 档位」（实测 `"M3.1-Flash-Preview\ndefault"`）。
 *
 * 模型名自身可能含空格与连字符（`M3.1-Flash-Preview`）且**不含**中点分隔符，
 * 所以按**换行**切分，而不是按空格或中点（Kimi Code 用中点，本产品不用）。
 */
export function parseTriggerValue(text: string): { model: string; levelToken?: string } {
  const flat = text.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (!flat) return { model: "" };
  const parts = flat
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    // 单行：整串即模型名（档位后缀不存在）。若该行恰好是档位 token 则说明触发器只剩档位，
    // 这种异常形态按「无模型名」处理，交给调用方报错，绝不猜。
    return { model: levelOfToken(parts[0]!) ? "" : parts[0]! };
  }
  const [head, ...rest] = parts;
  const tail = rest[rest.length - 1]!;
  return levelOfToken(tail) ? { model: head!, levelToken: tail } : { model: parts.join(" ") };
}

/**
 * 校验模型参数：model 必填（MiniMax Code 无「默认模型」语义，界面当前值不可作为任务语义）。
 */
export function parseMinimaxModel(
  model: string | undefined,
  level: string | undefined,
  contextWindow?: string,
): MinimaxModelSpec {
  const trimmed = (model ?? "").trim();
  if (!trimmed) throw new Error("MiniMax Code 必须指定 model（如「M3.1-Flash-Preview」）");
  const normalized = normalizeReasoningLevel(level);
  const windowValue = contextWindow?.normalize("NFKC").trim() ?? "";
  return {
    model: trimmed,
    level: normalized.level,
    unsupported: normalized.unsupported,
    contextWindow: windowValue || undefined,
  };
}

/** 机构调用方（handlers）在无界面档位集合时能报出的取值错误文案 */
export function describeLevelValueError(spec: MinimaxModelSpec): string | undefined {
  if (spec.unsupported === undefined) return undefined;
  return `MiniMax Code 的推理等级不支持${receiptOf(spec.unsupported)}：仅支持 default、低/low、中/medium、高/high、极高/xhigh、最大/max，且必须落在所选模型的界面档位集合内`;
}
