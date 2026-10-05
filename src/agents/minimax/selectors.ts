/**
 * MiniMax Code 选择器规范。
 *
 * 真机实测（2026-10-05，MiniMax Code 3.1.0 / Chromium 148.0.7778.280 / Electron 42.8.0，Windows 10.0.19045）：
 *
 * 1) 主窗口有 **58 个 `data-testid`**（实测清单见 docs/minimax-evidence/main-window-testids.txt），
 *    是本适配器的主判据——比 class 名稳定（class 含 Tailwind 工具类，会随构建变化）。
 *
 * 2) **双渲染进程**（结构同 Kimi Code）：主窗口 `MiniMax Code`（`app://./archon`）承载侧栏/会话/
 *    composer/输入框/发送；**模型弹层**渲染在独立的 `Model menu` 窗口
 *    （`file://.../resources/app.asar/dist/model-menu/index.html`）。
 *    实测反证：主窗口点 `model-selector-trigger` 后，主窗口 `data-testid` 数**仍为 58**（新增 0）、
 *    `role="group"` 数 **0**、`role="menuitemradio"` 数 **0**、`innerText` 不含「推理等级」。
 *    因此这里维护两张表：`MM_MAIN_SELECTORS`（主窗口）与 `MM_MENU_SELECTORS`（弹层窗口）。
 *
 * 3) **推理等级 / 上下文窗口在二级子菜单里**（关键偏离：产品产物的源码常量显示它们是平铺的
 *    `role="group"`，真机实测**只有悬停某个模型项后**才展开）：
 *    - 带 `aria-haspopup="menu"` 的模型项 → 悬停 → `aria-expanded` 变 `"true"` → 出现第二层
 *      `role="menu"`，其中才是 `role="group"[aria-label="推理等级"]` 与
 *      `role="group"[data-testid="model-context-control"]`；
 *    - 实测：`M3.1-Flash-Preview` / `M3` / `deepseek-v4.1-flash` 有子菜单；
 *      `M2.7-highspeed` / `M2.7` **没有**（`aria-haspopup` 为 null）。
 *    选模型必须走「悬停展开 → 选档位 → 选窗口」三步，否则档位集合永远读不到。
 *
 * 4) 模型项的名称在 **`.sr-only` span** 里（`aria-label` 为 `null`）。项内还有 aria-hidden 的
 *    省略号分段（`M3.1-Flash` + `-Preview`），所以**绝不能**用 `innerText` 当模型名——
 *    实测 `innerText` 是 `"M3.1-Flash-Preview M3.1-Flash -Preview"` 这种重复拼接。
 *
 * 5) 输入框是 **tiptap ProseMirror**（`div.tiptap.ProseMirror[contenteditable=true]`），
 *    实测 `Input.insertText` 可用（写入后 `innerHTML` 变 `<p class="rich-text-paragraph">…</p>`）；
 *    清空后 `innerHTML` 保留 `<p class="… is-empty is-editor-empty"><br></p>`，
 *    故空态判定必须走 `innerText.trim()`，不能用 `length === 0`。
 *
 * 6) 发送按钮是 **DIV**（不是 button），可用性走 `aria-disabled`：
 *    输入框空时 `aria-disabled="true"`，有内容时为 `null`。**没有 `disabled` 属性**。
 *
 * 7) 停止按钮 `data-testid="stop-button"`（从产品产物 `app.asar` 提取；
 *    真机发送后态未能采集——账号额度受限，故列为待验证项，见 docs/minimax-cdp.md）。
 */

export interface MinimaxSelectorSpec {
  /** 主 CSS 选择器 */
  primary: string;
  /** 回退 CSS 选择器 */
  fallbacks: string[];
  /** 精确可见文本（归一化后比较，中英双语） */
  texts?: string[];
  /** 精确 aria-label（归一化后比较，中英双语） */
  ariaLabels?: string[];
  /** aria-label 正则源串（用于含动态名称的模板） */
  ariaPatterns?: string[];
  /** 排除选择器：命中任一（自身或祖先 closest）的候选被剔除 */
  excludes?: string[];
  /** 作用域选择器：仅保留落在其匹配元素内的候选；作用域元素不存在时返回空集 */
  scope?: string;
  /** 实测校验的客户端版本 */
  verifiedVersion: string;
  note: string;
}

/** 主窗口语义键（侧栏 / 会话 / composer） */
export type MinimaxSelectorKey =
  | "newTask"
  | "createProject"
  | "sessionList"
  | "sessionGroup"
  | "sessionGroupNewTask"
  | "projectHeaderActions"
  | "projectFilterTrigger"
  | "userMenu"
  | "chatInput"
  | "attachButton"
  | "modelTrigger"
  | "permissionTrigger"
  | "permissionLabel"
  | "projectTrigger"
  | "projectClear"
  | "sendButton"
  | "stopButton"
  | "messageArea"
  | "userCopyButton"
  | "errorRetryButton"
  | "questionDialog"
  | "questionSubmit"
  | "busyBanner"
  | "userGate";

/** 弹层（`Model menu` 独立窗口）语义键：模型列表 / 推理等级 / 上下文窗口 */
export type MinimaxMenuSelectorKey =
  | "menuRoot"
  | "modelOption"
  | "modelName"
  | "effortGroup"
  | "effortOption"
  | "contextGroup"
  | "contextOption"
  | "higherUsageTag"
  | "separator"
  | "submenuRoot";

export const MM_MAIN_SELECTORS: Record<MinimaxSelectorKey, MinimaxSelectorSpec> = {
  newTask: {
    primary: '[data-testid="sidebar-shortcut-task.new"]',
    fallbacks: ['[data-testid="sidebar-session-group-new-task"]'],
    ariaLabels: ["新建任务", "New task", "在该项目中新建任务"],
    verifiedVersion: "3.1.0",
    note: "侧栏顶部「新建任务」。**testid 挂在 `<kbd>` 上（显示 Ctrl+N），真正的可点击元素是它的祖先 button[aria-label='新建任务']**——点击必须用 closest('button')，直接点 kbd 无效。分组内的同名入口是回退项（多分组时天然多命中 → 用 clickFirst）",
  },
  createProject: {
    primary: '[data-testid="sidebar-create-project-trigger"]',
    fallbacks: [],
    ariaLabels: ["新建项目", "New project", "Add project"],
    verifiedVersion: "3.1.0",
    note: "「新建项目」→ 触发 Win32 原生文件夹对话框（#32770）",
  },
  sessionList: {
    primary: '[data-testid="sidebar-session-list"]',
    fallbacks: ["aside [data-testid='sidebar-session-list']"],
    verifiedVersion: "3.1.0",
    note: "会话列表容器（`data-view-mode=\"projects\"`）",
  },
  sessionGroup: {
    primary: '[data-testid="sidebar-session-group"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "**项目分组**：带 `data-workspace-dir=\"D:\\\\Trae项目\\\\tianshu-mcp\"` 与 `data-project-key=\"workspace:<dir>\"` —— 这是**项目绑定的权威判据**（完整绝对路径），比名称匹配可靠。会话锚点也从这里采集",
  },
  sessionGroupNewTask: {
    primary: '[data-testid="sidebar-session-group-new-task"]',
    fallbacks: [],
    ariaLabels: ["在该项目中新建任务", "New task in this project"],
    verifiedVersion: "3.1.0",
    note: "「在该项目中新建任务」（每个分组的头上有），多分组时天然多命中 → 必须用 clickFirst",
  },
  projectHeaderActions: {
    primary: '[data-testid="sidebar-project-header-actions"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "项目分组的操作区（点开有重命名/移除/在该项目中新建任务等）。依赖已登记项目——空项目态不渲染",
  },
  projectFilterTrigger: {
    primary: '[data-testid="sidebar-project-filter-trigger"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "侧栏项目过滤（本适配器不使用，保留用于诊断）",
  },
  userMenu: {
    primary: '[data-testid="sidebar-user-menu-trigger"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "左下角用户菜单（本适配器不使用，保留用于登录态诊断）",
  },
  chatInput: {
    primary: '[data-testid="message-textarea"]',
    fallbacks: ['div.tiptap.ProseMirror[contenteditable="true"]', '[data-testid="message-input"] .ProseMirror'],
    ariaLabels: ["输入消息... (输入 / 唤起命令)", "Message input"],
    verifiedVersion: "3.1.0",
    note: "tiptap ProseMirror 富文本输入框（`div.tiptap.ProseMirror.rich-text-editor[contenteditable=true]`）；必须走 CDP 真实输入管线（Input.insertText），不能设 value。清空后 innerHTML 保留 `<p class=\"is-empty is-editor-empty\"><br></p>` → 空态判定用 innerText.trim()",
  },
  attachButton: {
    primary: '[data-testid="attach-button"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "附件入口（本适配器不使用，保留用于诊断）",
  },
  modelTrigger: {
    primary: '[data-testid="model-selector-trigger"]',
    fallbacks: ['button.mavis-model-selector-trigger'],
    verifiedVersion: "3.1.0",
    note: "模型触发器（文本 = 当前模型名，实测 `M2.7-highspeed`；选定有子菜单的模型后文本变成两行 `M3.1-Flash-Preview\\ndefault` = 模型 + 档位）。点击后弹层渲染在**独立 Model menu 窗口**。带 aria-expanded 表示菜单是否展开",
  },
  permissionTrigger: {
    primary: '[data-testid="permission-mode-trigger"]',
    fallbacks: ['button.ant-dropdown-trigger[aria-label]'],
    verifiedVersion: "3.1.0",
    note: "权限模式触发器（文本/aria-label 实测「始终授权」）。菜单是 **ant-dropdown**（主窗口内 portal），不是独立窗口——与模型弹层不同",
  },
  permissionLabel: {
    primary: '[data-testid="permission-mode-label"]',
    fallbacks: ['span.permission-mode-trigger-label'],
    verifiedVersion: "3.1.0",
    note: "权限模式文本（实测「始终授权」）",
  },
  projectTrigger: {
    primary: '[data-testid="project-selector-trigger"]',
    fallbacks: ['button.ant-dropdown-trigger[class*="max-w"]'],
    verifiedVersion: "3.1.0",
    note: "输入区上方的项目触发器（文本 = 当前项目名，实测 `.appdata`）。点开是 ant-dropdown，实测含「最近」分组（列出历史项目）+「选择新项目 Ctrl+O」+「不需要项目 Ctrl+Alt+O」",
  },
  projectClear: {
    primary: '[data-testid="project-selector-clear"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "清除项目选择（本适配器不使用，保留用于诊断）",
  },
  sendButton: {
    primary: '[data-testid="send-button"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "发送按钮是 **DIV**（`div.select-none.flex.size-[30px]`，**不是 `<button>`**）。可用性必须读 `aria-disabled`：输入框空时为 `\"true\"`，有内容时为 `null`。**没有 `disabled` 属性**（读 `e.disabled` 恒为 undefined）",
  },
  stopButton: {
    primary: '[data-testid="stop-button"]',
    fallbacks: [],
    verifiedVersion: "3.1.0（产物提取，待真机发送后态复验）",
    note: "**权威运行信号**：生成期间出现、完成后消失。来源为产品产物 app.asar 的 testid 常量提取（`stop-button`），本次真机探测未采到发送后态（账号额度受限）——降级为待验证项，缺失时三信号自动降级为「发送双态 + 文本稳定」（见 liveness.ts）",
  },
  messageArea: {
    primary: '[data-testid="message-list"]',
    fallbacks: ['[data-testid="chat-main-column-busy-banner-slot"]', "main"],
    verifiedVersion: "3.1.0",
    note: "对话正文容器（消息列表）。文本稳定兜底判定与错误文案提取都用它。**不要用 body**（会混入侧栏、推荐位与标题）",
  },
  userCopyButton: {
    primary: '[data-testid="message-copy-button"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "消息复制按钮（回复落地的辅助证据，不作为完成判据）",
  },
  errorRetryButton: {
    // 与 userGate 同一决策：**默认留空**。产品产物里有 queue-paused-send-* 等重试相关 testid，
    // 但「模型请求失败后界面上到底出现哪个可点元素」未真机验证（额度受限造不出失败态）。
    // 绝不内置猜测型选择器——误配会把正常运行判成失败。
    primary: "",
    fallbacks: [],
    verifiedVersion: "未内置（按配置启用）",
    note: "失败重试入口；默认禁用，仅当 agent-profiles.json 配置 gui.selectors.errorRetryButton 后才参与判定。未配置时失败态由 messageArea 的失败文案正则兜底",
  },
  questionDialog: {
    primary: '[data-testid="question-dialog"]',
    fallbacks: ['[data-testid="questionnaire-composer"]'],
    verifiedVersion: "3.1.0（产物提取，待真机复验）",
    note: "**等待用户输入**的对话框（产品产物实测含 question-dialog / question-submit / question-reject / questionnaire-*）。来源为 app.asar 常量提取，未真机复验——因此 poll() 里该字段只作**辅助证据**，needs_user 的主判据仍是「无运行信号 + 文本已变化 + 问句结尾」的保守启发式",
  },
  questionSubmit: {
    primary: '[data-testid="question-submit"]',
    fallbacks: ['[data-testid="questionnaire-submit"]'],
    verifiedVersion: "3.1.0（产物提取，待真机复验）",
    note: "用户提问对话框的提交按钮（同上，产物提取）",
  },
  busyBanner: {
    primary: '[data-testid="desktop-busy-banner"]',
    fallbacks: ['[data-testid="mavis-page-busy-banner-slot"]'],
    verifiedVersion: "3.1.0（产物提取，待真机复验）",
    note: "页面忙碌横幅（产物提取）。**只作诊断证据**，不参与运行判定——它是全局 UI 状态，与「本轮 turn 是否在跑」不等价",
  },
  userGate: {
    // 与 codex/kimicode 的既有做法一致：**默认禁用**，只有 profile 显式配置后才参与判定。
    // 绝不内置猜测型选择器——误配会把正常运行误判为 needs_user。
    primary: "",
    fallbacks: [],
    verifiedVersion: "未内置（按配置启用）",
    note: "「等待用户」界面检测；默认禁用，配置 gui.selectors.userGate 后 poll().userGateVisible 才可能为真",
  },
};

export const MM_MENU_SELECTORS: Record<MinimaxMenuSelectorKey, MinimaxSelectorSpec> = {
  menuRoot: {
    primary: '[role="menu"][aria-label="选择模型"]',
    fallbacks: ['[role="menu"]'],
    ariaLabels: ["选择模型", "Select model"],
    verifiedVersion: "3.1.0",
    note: "模型菜单根（`div[role=menu][aria-label=选择模型]`）。菜单窗口只有一个顶层 menu 时用它；二级子菜单是**另一个** `role=menu`（无此 aria-label），故 submenuRoot 必须用「不含该 aria-label 的 menu」判据",
  },
  modelOption: {
    primary: 'button[role="menuitemradio"][aria-haspopup="menu"]',
    fallbacks: ['[role="menu"] button[role="menuitemradio"]'],
    verifiedVersion: "3.1.0",
    note: "**带子菜单的模型项**（`aria-haspopup=\"menu\"`）——只有这些项能展开推理等级/上下文窗口。实测 M3.1-Flash-Preview / M3 / deepseek-v4.1-flash 带；M2.7-highspeed / M2.7 不带。当前模型 `aria-checked=\"true\"`",
  },
  modelName: {
    primary: 'button[role="menuitemradio"] span.sr-only',
    fallbacks: ['button[role="menuitemradio"] span[title]'],
    verifiedVersion: "3.1.0",
    note: "**模型名的唯一可靠来源**：`span.sr-only`（无障碍名）。项内另有 aria-hidden 的省略号分段（`M3.1-Flash` + `-Preview`），故 innerText 是重复拼接（`\"M3.1-Flash-Preview M3.1-Flash -Preview\"`）——**绝不能用 innerText 当模型名**",
  },
  effortGroup: {
    primary: 'div[role="group"][aria-label="推理等级"]',
    fallbacks: ['[role="group"][aria-label*="推理"]'],
    ariaLabels: ["推理等级"],
    verifiedVersion: "3.1.0",
    note: "推理等级组（在**二级子菜单**里，悬停模型项后才出现）。组内 `button[role=menuitemradio]`，当前档 `aria-checked=\"true\"`。实测档位：default/low/medium/high/xhigh/max。**注意：这些 button 没有 aria-label，档位文本在 `span.min-w-0.flex-1.truncate` 里**",
  },
  effortOption: {
    primary: 'div[role="group"][aria-label="推理等级"] button[role="menuitemradio"]',
    fallbacks: ['[role="group"][aria-label*="推理"] button[role="menuitemradio"]'],
    verifiedVersion: "3.1.0",
    note: "推理等级候选（default/low/medium/high/xhigh/max）",
  },
  contextGroup: {
    primary: '[data-testid="model-context-control"]',
    fallbacks: ['div[role="group"][aria-label*="上下文窗口"]'],
    ariaPatterns: ["上下文窗口", "context window"],
    verifiedVersion: "3.1.0",
    note: "上下文窗口组（**二级子菜单**里，`data-testid=\"model-context-control\"`）。**aria-label 含动态模型名**（实测 `\"M3.1-Flash-Preview 上下文窗口\"`）→ 匹配必须用 ariaPatterns 而不是精确 ariaLabels",
  },
  contextOption: {
    primary: '[data-testid="model-context-control"] button[role="menuitemradio"]',
    fallbacks: ['div[role="group"][aria-label*="上下文窗口"] button[role="menuitemradio"]'],
    verifiedVersion: "3.1.0",
    note: "上下文窗口候选（实测 `512K` / `1M`）。**这些 button 有 aria-label**（就是候选文本），当前项 `aria-checked=\"true\"`。`1M` 带「用量较高」标记",
  },
  higherUsageTag: {
    primary: '[data-testid="model-context-higher-usage-tag"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "「用量较高」标记（实测挂在 `1M` 项内）。**只作诊断**——不参与选择逻辑",
  },
  separator: {
    primary: '[role="separator"]',
    fallbacks: [],
    verifiedVersion: "3.1.0",
    note: "子菜单内上下文窗口组与推理等级组之间的分隔线（**诊断用**：可用于确认二层结构已渲染）",
  },
  submenuRoot: {
    // 二级子菜单**没有** aria-label（顶层才是「选择模型」）→ 用 :not() 精确排除顶层。
    primary: '[role="menu"]:not([aria-label="选择模型"])',
    fallbacks: ['[role="menu"] [role="group"][aria-label*="上下文窗口"]'],
    verifiedVersion: "3.1.0",
    note: "二级子菜单根（悬停模型项后出现的第二个 `role=menu`）。判据：`[role=menu]:not([aria-label=选择模型])`——比「index 取最后一个」稳健（顺序会随渲染变化）",
  },
};

/** 合并 profile 覆盖后的 CSS 候选（去重，覆盖优先） */
export function cssCandidates(
  spec: MinimaxSelectorSpec,
  overrides: Record<string, string> = {},
  key?: string,
): string[] {
  const override = key ? overrides[key] : undefined;
  return [
    ...new Set([override, spec.primary, ...spec.fallbacks].filter((v): v is string => Boolean(v))),
  ];
}

/**
 * 生成页面内 resolve 函数源码：按 CSS 候选 + 文本/aria 谓词解析元素（文档顺序去重）。
 * 调用形式：`__minimaxResolve(css, texts, arias, pats, excl, scope)` 或单数组形式。
 */
export function resolveFnSource(): string {
  return `function __minimaxResolve(a,b,c,d,e,f){
    var spec=Array.isArray(a)?a:[a,b,c,d,e,f];
    var css=spec[0]||[],texts=spec[1]||[],arias=spec[2]||[],pats=spec[3]||[],excl=spec[4]||[],scopeSel=spec[5]||'';
    var roots=null;
    if(scopeSel){roots=document.querySelectorAll(scopeSel);if(!roots.length)return[]}
    const inScope=(el)=>{if(!roots)return true;for(const r of roots){if(r===el||r.contains(el))return true}return false};
    const out=[];
    const push=(el)=>{if(!el||out.indexOf(el)>=0)return;if(!inScope(el))return;if(excl.some((s)=>{try{return el.closest(s)}catch(_){return false}}))return;out.push(el)};
    for(const s of css){try{for(const el of document.querySelectorAll(s))push(el)}catch(_){}}
    if(texts.length||arias.length||pats.length){
      const norm=(s)=>(s||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toLocaleLowerCase();
      const tset=texts.map(norm);const aset=arias.map(norm);
      const regs=pats.map((p)=>{try{return new RegExp(p,'i')}catch(_){return null}}).filter(Boolean);
      const scan='[aria-label],button,a,label,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="tab"],[role="option"],[role="listitem"],[role="menu"],[role="group"],div[class]';
      const textHits=[];
      for(const el of document.querySelectorAll(scan)){
        const aria=el.getAttribute('aria-label')||'';
        if(aset.indexOf(norm(aria))>=0){push(el);continue}
        if(regs.some((r)=>r.test(aria))){push(el);continue}
        if(tset.indexOf(norm(el.innerText||el.textContent||''))>=0)textHits.push(el)
      }
      for(const el of textHits){if(!textHits.some((o)=>o!==el&&el.contains(o)))push(el)}
    }
    return out;
  }`;
}

/** 页面内 spec 的 JSON 参数（[css, texts, ariaLabels, ariaPatterns, excludes, scope]） */
export function specArgs(
  spec: MinimaxSelectorSpec,
  overrides: Record<string, string> = {},
  key?: string,
): string {
  return JSON.stringify([
    cssCandidates(spec, overrides, key),
    spec.texts ?? [],
    spec.ariaLabels ?? [],
    spec.ariaPatterns ?? [],
    spec.excludes ?? [],
    spec.scope ?? "",
  ]);
}

/** 主窗口键的 spec 解析（含 profile.gui.selectors 覆盖） */
export function mainSpec(key: MinimaxSelectorKey, overrides: Record<string, string> = {}): string {
  return specArgs(MM_MAIN_SELECTORS[key], overrides, key);
}

/** 弹层键的 spec 解析（含 profile.gui.selectors 覆盖，键名前缀避免与主窗口同名键冲突） */
export function menuSpec(
  key: MinimaxMenuSelectorKey,
  overrides: Record<string, string> = {},
): string {
  return specArgs(MM_MENU_SELECTORS[key], overrides, `menu.${key}`);
}
