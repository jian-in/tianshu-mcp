/**
 * Open Design 控件的选择器注册表与页面内解析函数。
 *
 * **选择器来源纪律**：本文件里的 `primary` **全部来自产品自身的产物证据**，不是截图目测——
 * 目测出来的坐标/类名会在第一次 UI 升级时静默漂移（issue #23 的教训）。证据来源有两类：
 *
 * 1. `data-testid`：Open Design 的 Web 前端（Next.js 产物
 *    `<安装目录>/resources/open-design-web-standalone/apps/web/.next/static/chunks/*.js`）
 *    系统性使用 `data-testid` 作为自动化钩子，且这些钩子带业务语义（`chat-send` /
 *    `working-dir-trigger` / `composer-design-system-trigger` …），是**产品作者为自动化预留的稳定接口**。
 * 2. 语义 role/aria：菜单项统一由 `aria-haspopup="listbox"` + `role="listbox"` + `role="option"` 承载，
 *    停止按钮没有 testid，带 `class="composer-send stop"` 与 `aria-label=<chat.stop>`。
 *
 * 采集/复核入口：`node scripts/probe-opendesign.mjs anchors`（只读盘点，输出各键命中数与文本）。
 * 证据表见 `docs/opendesign-cdp.md` §4（**真机 DOM 取证**）。
 *
 * **漂移兜底（两道）**：
 * - `missingSelectorKeys()` 在任一布局守卫键无值时让 `run.ts` 硬失败 `selector_drift`；
 * - `profile.gui.selectors` 支持按语义键热覆盖（UI 小改版时无需发版），且**覆盖即权威**（见 cssCandidates）。
 */

/** 选择器键：覆盖 12 步流程需要的全部锚点 */
export type OpenDesignSelectorKey =
  | "title"
  | "composer"
  | "inputBox"
  | "workingDirTrigger"
  | "selectDirItem"
  | "recentDirTrigger"
  | "recentDirItem"
  | "workingDirValue"
  | "modelTrigger"
  | "modelMenuItem"
  | "designSystemTrigger"
  | "designSystemSearch"
  | "designSystemItem"
  | "designDirectionTrigger"
  | "designDirectionItem"
  | "sendButton"
  | "stopButton"
  | "conversationText";

export interface OpenDesignSelectorSpec {
  /**
   * 主选择器（真机采集得到）。空串 = 尚未采集——**不写任何目测值**，
   * 让 fail-closed 门禁如实拦住派发，而不是用猜的选择器去点错地方。
   */
  primary: string;
  /** 语义化兜底候选（aria/role 等稳定语义，不含截图目测的类名） */
  fallbacks?: string[];
  /** 精确文本谓词（NFKC 归一后全等匹配） */
  texts?: string[];
  /** aria-label 精确匹配 */
  ariaLabels?: string[];
  /** aria-label 正则匹配 */
  ariaPatterns?: string[];
  /** 命中这些选择器的祖先即排除（避免点到容器） */
  excludes?: string[];
  /** 限定作用域的祖先选择器 */
  scope?: string;
}

/**
 * 布局守卫键：**必须全部有值**才允许开始操作。
 *
 * 只收两类锚点：
 * 1. 注册表层面「已采集」的键（任一为空即 `selector_drift`，见 `missingSelectorKeys`）；
 * 2. 页面层面「首页渲染完成就能看到」的锚点 —— 这里只放 `title / composer / inputBox / sendButton`
 *    四个**无条件存在**的键（首页 hero 与输入区）。
 *
 * 刻意**不含**下列键（放进守卫会造成大面积假阻塞）：
 * - 工作目录 / 模型 / 设计系统 / 设计方向触发器：它们由用户配置与页面形态决定是否渲染，
 *   缺失属于「该能力不可用」而不是「页面结构漂移」——这些键在**各自的步骤**里单独校验并给出
 *   精确失败原因（`no-trigger` / `no-menu` / `needs_user`），比在守卫里一刀切更如实；
 * - `selectDirItem` / `modelMenuItem` / `designSystemItem` / `designDirectionItem` /
 *   `designSystemSearch` / `stopButton`：`展开菜单/开始运行`之后才出现；
 * - `conversationText`：只在会话页存在，首页没有。
 */
export const OPEN_DESIGN_LAYOUT_GUARD_KEYS: readonly OpenDesignSelectorKey[] = [
  "title",
  "composer",
  "inputBox",
  "sendButton",
];

/**
 * 选择器表。每个 `primary` 都是**产品产物证据**中的真实钩子（见文件头说明），
 * 注释里写明证据出处，便于 UI 升级后核对。
 *
 * 命中语义是**并集**（primary + fallbacks 全部参与 querySelectorAll），所以 fallbacks
 * 只放「同一控件在另一形态下的钩子」，不放宽泛容器型候选（会让唯一命中判据失效）。
 */
export const OPEN_DESIGN_SELECTORS: Record<OpenDesignSelectorKey, OpenDesignSelectorSpec> = {
  /**
   * 页面框架锚点。首页 hero 容器 = `data-testid="home-hero"`（已渲染首页的权威标志）。
   * 会话页没有 hero，故补 `home-view` / 标题元素作为跨形态兜底。
   */
  title: {
    primary: '[data-testid="home-hero"]',
    fallbacks: ['[data-testid="home-view"]', "header h1", "main h1"],
  },
  /** 输入区容器：会话页 `chat-composer`，首页 `home-hero-composer-card`（同一控件的两种形态） */
  composer: {
    primary: '[data-testid="chat-composer"]',
    fallbacks: [
      '[data-testid="home-hero-composer-card"]',
      '[data-testid="pending-chat-composer-shell"]',
      "[data-od-chat-area=composer]",
    ],
  },
  /**
   * 任务书输入框（Lexical 富文本，contenteditable）。
   * 首页编辑器显式带 `data-testid="home-hero-input"`；会话页编辑器在 `chat-composer` 内。
   */
  inputBox: {
    primary: '[data-testid="home-hero-input"]',
    fallbacks: ['[data-testid="chat-composer"] [contenteditable=true]', "[contenteditable=true]"],
  },
  /** 「工作目录」触发器（`working-dir-picker` 内的按钮，带 aria-expanded） */
  workingDirTrigger: {
    primary: '[data-testid="working-dir-trigger"]',
    fallbacks: ['[data-testid="composer-plus-working-dir"]'],
  },
  /**
   * 「选择目录」菜单项：首页工作目录面板内是 `working-dir-pick`，
   * composer「+」菜单内是 `composer-plus-working-dir-pick`（同一动作的入口）。
   */
  selectDirItem: {
    primary: '[data-testid="working-dir-pick"]',
    fallbacks: ['[data-testid="composer-plus-working-dir-pick"]'],
    texts: ["选择目录", "选择文件夹…", "修改工作目录"],
  },
  /**
   * 「最近使用的目录」入口：纯 DOM 点击即可切换工作目录，**比 Win32 原生对话框稳得多**。
   * 真机 2026-09-27：原生路线在两次运行间时好时坏（一次成功、多次「对话框正常关闭但目录没变」），
   * 而面板里确实有这一项（探针实测 `working-dir-recent|最近使用的目录`）。
   */
  recentDirTrigger: {
    primary: '[data-testid="working-dir-recent"]',
    texts: ["最近使用的目录"],
  },
  /**
   * 最近目录列表项：无稳定 testid（探针只在**点开前**采集过面板），故用宽选择器 + **文本精确匹配**
   * （`exactMatchPointExpression` 负责 NFKC 归一后的全等，多命中即拒绝）。
   */
  recentDirItem: {
    primary: '[role="menuitem"]',
    fallbacks: ['[role="option"]', '[data-testid="working-dir-recent-item"]'],
  },
  /** 工作目录显示值：回读触发器上的标签文本（绑定是否生效的唯一权威判据） */
  workingDirValue: {
    primary: '[data-testid="working-dir-trigger"]',
  },
  /**
   * 模型触发器：会话页内联切换器 chip；新建项目弹窗内是 `model-picker-trigger`。
   * 两者互斥出现（不同形态），并集不会同时命中。
   */
  modelTrigger: {
    primary: '[data-testid="inline-model-switcher-chip"]',
    fallbacks: ['[data-testid="model-picker-trigger"]', '[data-testid="inline-model-switcher"]'],
  },
  /** 模型菜单项：listbox 形态的 `role="option"`（触发器 `aria-haspopup="listbox"`） */
  modelMenuItem: {
    primary: '[role="option"]',
    fallbacks: ['[role="menuitemradio"]', '[role="menuitem"]'],
  },
  /** 设计系统触发器：composer 图标形态 / 首页 footer 形态 / 项目选择器入口 */
  designSystemTrigger: {
    primary: '[data-testid="composer-design-system-trigger"]',
    fallbacks: [
      '[data-testid="home-hero-design-system-trigger"]',
      '[data-testid="design-system-trigger"]',
      '[data-testid="project-ds-picker-trigger"]',
    ],
  },
  /** 设计系统搜索框（面板打开后才出现） */
  designSystemSearch: {
    primary: '[data-testid="design-system-search"]',
    fallbacks: [".ds-picker-search", '[data-testid="model-picker-search"]'],
  },
  /** 设计系统列表项（同一面板内也是 listbox 形态） */
  designSystemItem: {
    primary: '[role="option"]',
    fallbacks: ['[role="menuitemradio"]', '[role="listitem"]'],
  },
  /**
   * 设计方向（界面上的「创建类型」选择器）：`home-hero-template-picker` 内含
   * `home-hero-template-trigger`（`aria-haspopup="listbox"`）。
   */
  designDirectionTrigger: {
    primary: '[data-testid="home-hero-template-trigger"]',
    fallbacks: ['[data-testid="home-hero-template-picker"] [aria-haspopup=listbox]'],
  },
  /** 设计方向菜单项 */
  designDirectionItem: {
    primary: '[role="option"]',
    fallbacks: ['[role="menuitemradio"]', '[role="menuitem"]'],
  },
  /**
   * 发送按钮：会话页 `chat-send`（`aria-label=<chat.send>`），首页 `home-hero-submit`。
   * 发送中态另有 `chat-send-pending`（disabled），刻意**不**收进来——它不是可点击的发送按钮。
   */
  sendButton: {
    primary: '[data-testid="chat-send"]',
    fallbacks: ['[data-testid="home-hero-submit"]'],
    ariaLabels: ["发送", "Send"],
  },
  /**
   * 停止按钮：**运行中的权威信号**。该控件没有 testid，产品用
   * `class="composer-send stop"` + `aria-label=<chat.stop>` 标识；
   * 这里以 class 为 primary（不随语言变化），aria 只作诊断性兜底。
   */
  stopButton: {
    primary: "button.composer-send.stop",
    ariaPatterns: ["^(停止|停止生成|Stop|Stoppen|停止する)$"],
  },
  /** 对话正文容器：`chat-log`（产品自己的滚动/取证锚点，语义极稳定） */
  conversationText: {
    primary: '[data-testid="chat-log"]',
    fallbacks: ["[class*=chat-log i]"],
  },
};

/**
 * 合并 profile 覆盖后的 CSS 候选。
 *
 * **覆盖是权威的**：`profile.gui.selectors[key]` 一旦给出，就**只**用该值，不再混入内置 fallbacks。
 * 理由（真机教训）：内置 fallbacks 里有 `[aria-haspopup]` 这类宽泛语义候选，页面上一屏往往有多个；
 * 混进来会让「唯一命中」判据必然失败——于是热修复选择器反而把功能彻底关掉，表现为
 * `no-panel：触发器无法唯一定位`。运维期望的语义是「我指定这个键就用它」，不是「在其上追加」。
 */
export function cssCandidates(
  spec: OpenDesignSelectorSpec,
  overrides: Record<string, string> = {},
  key?: string,
): string[] {
  const override = key ? overrides[key]?.trim() : undefined;
  if (override) return [override];
  return [
    ...new Set([spec.primary, ...(spec.fallbacks ?? [])].filter((v): v is string => Boolean(v))),
  ];
}

/**
 * 未采集到的**布局守卫键**（返回空数组 = 可以开始操作）。
 * 由 `run.ts` 在连接后立即调用；非空即 `selector_drift` 硬失败并回显缺失键。
 */
export function missingSelectorKeys(
  overrides: Record<string, string> = {},
): OpenDesignSelectorKey[] {
  return OPEN_DESIGN_LAYOUT_GUARD_KEYS.filter((key) => {
    const override = overrides[key]?.trim();
    if (override) return false;
    return !OPEN_DESIGN_SELECTORS[key].primary.trim();
  });
}

/**
 * 生成页面内 resolve 函数源码：按 CSS 候选 + 文本/aria 谓词解析元素（文档顺序去重）。
 * 与 `kimicode/selectors.ts` 的 `__kimicodeResolve` **同构但独立命名**：
 * 两套表达式在同一页面里语义一致、互不干扰（测试也各认各的标记）。
 * 调用形式：`__opendesignResolve(css, texts, arias, pats, excl, scope)` 或单数组形式。
 */
export function resolveFnSource(): string {
  return `function __opendesignResolve(a,b,c,d,e,f){
    var raw=Array.isArray(a)?a:[a,b,c,d,e,f];
    // specArgs() 产出的是 JSON 字符串（页面内直接内联），裸数组也要支持。
    // 少了这一步，JSON 字符串会被当成 css 候选去 querySelectorAll → 永远零命中（静默失效）。
    if(typeof raw[0]==='string'){try{const parsed=JSON.parse(raw[0]);if(Array.isArray(parsed))raw=parsed}catch(_){}}
    // 单选择器简写：spec 首元素仍是字符串 → 把 css 包成数组，**保留其余位置**
    // （曾写成 raw=[[raw[0]]]，把 texts/arias 全丢掉，导致坏 CSS 时回退候选被误当文本谓词）
    if(typeof raw[0]==='string')raw=[[raw[0]],raw[1],raw[2],raw[3],raw[4],raw[5]];
    var css=raw[0]||[],texts=raw[1]||[],arias=raw[2]||[],pats=raw[3]||[],excl=raw[4]||[],scopeSel=raw[5]||'';
    // spec 形态错误要**响亮**：css 不是数组时返回哨兵节点，由探针报 count=-1。
    // 静默返回 [] 会把「表达式拼错」伪装成「页面没这个元素」，是最难查的一类故障。
    if(!Array.isArray(css))return[{__odSpecError:'spec css is not an array'}];
    var roots=null;
    if(scopeSel){roots=document.querySelectorAll(scopeSel);if(!roots.length)return[]}
    const inScope=(el)=>{if(!roots)return true;for(const r of roots){if(r===el||r.contains(el))return true}return false};
    const out=[];
    const push=(el)=>{if(!el||out.indexOf(el)>=0)return;if(!inScope(el))return;if(excl.some((s)=>{try{return el.closest(s)}catch(_){return false}}))return;out.push(el)};
    // 候选按**优先级**排列（primary → fallbacks）：命中即停，取第一个有命中的候选。
    // 旧实现把各候选的命中去重合并进同一个数组，于是「primary 命中 1 个（真控件）
    // + fallback 命中 1 个（容器 div / 无 testid 的按钮）」，同一个语义键就成了 2 个命中，
    // singlePointExpression 判「多命中」拒绝点击 —— 真机 2026-09-27 就是这样把
    // modelTrigger（inline-model-switcher-chip vs inline-model-switcher 外层 div）与
    // designDirectionTrigger 报成「选择器漂移」，卡死在「确认模型」这一步的。
    for(const s of css){
      const before=out.length;
      try{for(const el of document.querySelectorAll(s))push(el)}catch(_){}
      if(out.length>before)break;
    }
    if(texts.length||arias.length||pats.length){
      const norm=(s)=>(s||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toLocaleLowerCase();
      const tset=texts.map(norm);const aset=arias.map(norm);
      const regs=pats.map((p)=>{try{return new RegExp(p,'i')}catch(_){return null}}).filter(Boolean);
      const scan='[aria-label],button,a,label,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="tab"],[role="option"],[role="listitem"],[role="menu"],div[class]';
      const textHits=[];
      for(const el of document.querySelectorAll(scan)){
        const aria=el.getAttribute('aria-label')||'';
        if(aset.indexOf(norm(aria))>=0){push(el);continue}
        if(regs.some((r)=>r.test(aria))){push(el);continue}
        if(tset.indexOf(norm(el.innerText||el.textContent||''))>=0)textHits.push(el)
      }
      // 文本命中去重：只保留最内层（避免祖先 div 因包含同一文案而命中）
      for(const el of textHits){if(!textHits.some((o)=>o!==el&&el.contains(o)))push(el)}
    }
    return out;
  }`;
}

/** 页面内 spec 的 JSON 参数（[css, texts, ariaLabels, ariaPatterns, excludes, scope]） */
export function specArgs(
  spec: OpenDesignSelectorSpec,
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

/** 语义键的 spec 解析（含 profile.gui.selectors 覆盖） */
export function selectorSpec(
  key: OpenDesignSelectorKey,
  overrides: Record<string, string> = {},
): string {
  return specArgs(OPEN_DESIGN_SELECTORS[key], overrides, key);
}
