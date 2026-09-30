export interface ZcodeSelectorSpec {
  primary: string;
  fallbacks: string[];
  verifiedVersion: string;
  note: string;
}

export type ZcodeSelectorKey =
  | "chatInput"
  | "sendButton"
  | "stopButton"
  | "newTask"
  | "newTaskSidebar"
  | "messageList"
  | "assistantMessage"
  | "questionCard"
  | "runningCard"
  | "toolCall"
  | "projectItem"
  | "projectMenuItem"
  | "projectPath"
  | "projectTrigger"
  | "addProject"
  | "chooseFolder"
  | "modelTrigger"
  | "providerOption"
  | "modelOption"
  | "modelValue"
  | "permissionTrigger"
  | "permissionValue"
  | "permissionOption"
  | "thoughtLevelTrigger"
  | "thoughtLevelOption"
  | "workOutsideProject"
  | "loginPage";

export const ZCODE_SELECTORS: Record<ZcodeSelectorKey, ZcodeSelectorSpec> = {
  chatInput: {
    primary: '[data-testid="v4-composer-input"][contenteditable="true"]',
    fallbacks: [
      'textarea[placeholder*="消息"]',
      'textarea[placeholder*="message"]',
      '[contenteditable="true"][role="textbox"]',
    ],
    verifiedVersion: "3.11.x",
    note: "任务输入框",
  },
  sendButton: {
    primary: 'button[data-testid="v4-composer-send"]',
    fallbacks: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]'],
    verifiedVersion: "3.11.x",
    note: "发送按钮",
  },
  stopButton: {
    primary: 'button[data-testid="v4-composer-stop"]',
    fallbacks: ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]'],
    verifiedVersion: "3.11.x",
    note: "权威运行信号",
  },
  newTask: {
    primary: 'button[data-testid="conversation-new-task"]',
    fallbacks: [
      'button[aria-label*="新建任务"]',
      'button[aria-label*="New task"]',
      '[data-testid="task-new-button"]',
    ],
    verifiedVersion: "3.11.x",
    note: "当前窗口顶部的新建会话按钮；避免命中其他工作区挂载的 task-new-button",
  },
  newTaskSidebar: {
    primary: '[data-testid="task-new-button"]',
    fallbacks: [],
    verifiedVersion: "3.11.2-macOS",
    note: "macOS 实测兜底：conversation-new-task 会命中首页底部惰性图标（trusted 点击无响应），侧栏大按钮才是真正入口；仅在 newTask 点击后 composer 未打开时使用",
  },
  messageList: {
    primary: '[data-testid="v4-timeline"]',
    fallbacks: ['[class*="message-list"]', "main"],
    verifiedVersion: "3.11.x",
    note: "消息列表",
  },
  assistantMessage: {
    primary: '[data-testid^="v4-row-"][class*="assistant-row"]',
    fallbacks: [
      '[data-message-role="assistant"]',
      '[data-role="assistant"]',
      '[class*="assistant-message"]',
    ],
    verifiedVersion: "3.11.x",
    note: "助手消息；3.11.2 使用 v4-row-* 和 assistant-row",
  },
  questionCard: {
    primary: '[role="listbox"][aria-label]:has([role="option"])',
    fallbacks: ['[data-testid*="question"]', '[class*="ask-user"]', '[class*="question-card"]'],
    verifiedVersion: "3.11.x",
    note: "AskUserQuestion 待用户回答控件；优先使用可访问语义，不依赖本地化按钮文本",
  },
  runningCard: {
    primary: '[data-state="loading"]',
    fallbacks: ['[class*="loading-card"]', '[aria-busy="true"]'],
    verifiedVersion: "3.11.x",
    note: "权威运行信号",
  },
  toolCall: {
    primary: '[data-testid*="tool-call"][data-state="running"]',
    fallbacks: ['[class*="tool-call"][class*="running"]'],
    verifiedVersion: "3.11.x",
    note: "活动工具调用",
  },
  projectItem: {
    primary: '[data-testid^="workspace-item-"]',
    fallbacks: ['[class*="project-item"]', '[class*="workspace-item"]'],
    verifiedVersion: "3.11.x",
    note: "3.11.x 的项目列表项。ZCode 3.14.x 已删除该契约（app.asar 扫描 0 命中），改用 projectMenuItem。",
  },
  projectMenuItem: {
    primary: '[role="menuitemcheckbox"]',
    fallbacks: [],
    verifiedVersion: "3.14.x",
    note: "工作区下拉中的项目项：textContent 即项目显示名，aria-checked 表示是否为当前绑定。3.14.x 下 workspace-item-* 与 data-project-path 均已不存在，这是唯一可用的绑定证据来源；仅在项目菜单展开时有效。",
  },
  projectPath: {
    primary: "[data-project-path]",
    fallbacks: ['[title*="/"][class*="project"]', '[title*="\\\\"][class*="project"]'],
    verifiedVersion: "3.11.x",
    note: "当前项目路径",
  },
  projectTrigger: {
    primary: '[data-testid="composer-workspace-trigger"]',
    fallbacks: [
      'button[aria-label="选择项目"]',
      'button[aria-label="Select project"]',
      'button[aria-label="Choose project"]',
    ],
    verifiedVersion: "3.11.x",
    note: "项目菜单",
  },
  addProject: {
    primary: 'button[data-testid="project-add"]',
    fallbacks: ['button[aria-label*="添加项目"]', 'button[aria-label*="Add project"]'],
    verifiedVersion: "3.11.x",
    note: "打开添加项目菜单",
  },
  chooseFolder: {
    primary: '[role="menu"] [role="menuitem"]',
    fallbacks: ['button[aria-label*="选择文件夹"]', 'button[aria-label*="Choose folder"]'],
    verifiedVersion: "3.11.x",
    note: "添加项目菜单中的打开文件夹项；必须按本地化标签唯一匹配",
  },
  modelTrigger: {
    primary: '[data-testid="chat-model-select-trigger"]',
    fallbacks: ['button[aria-label*="模型"]', 'button[aria-label*="Model"]'],
    verifiedVersion: "3.11.x",
    note: "模型菜单",
  },
  providerOption: {
    primary: '[data-testid^="chat-model-select-group-provider:"]',
    fallbacks: [
      '[data-testid^="chat-model-select-group-registry-provider:"]',
      '[data-testid^="chat-model-select-group-family:"]',
      '[role="option"][data-provider]',
    ],
    verifiedVersion: "3.11.x",
    note: "3.11.2 分组前缀漂移为 family；3.14.3 真机实测为 registry-provider（如 chat-model-select-group-registry-provider:new-provider）。模型项在分组的二级子菜单里，必须 hover 分组才渲染（click 会选中/收起）",
  },
  modelOption: {
    primary: '[data-testid^="chat-model-select-item-"][role="menuitemradio"]',
    fallbacks: ['[data-testid^="chat-model-select-item-"]', '[role="option"][data-model]'],
    verifiedVersion: "3.11.x",
    note: "3.11.2 模型平铺于家族标签下，testid 形如 chat-model-select-item-custom:…",
  },
  modelValue: {
    primary: '[data-testid="chat-model-select-trigger"]',
    fallbacks: ['[class*="model-trigger"]'],
    verifiedVersion: "3.11.x",
    note: "当前模型回读",
  },
  permissionTrigger: {
    primary: '[data-testid="chat-mode-select-trigger"]',
    fallbacks: [
      'button[aria-label="切换模式"]',
      'button[aria-label*="权限"]',
      'button[aria-label*="Permission"]',
    ],
    verifiedVersion: "3.11.x",
    note: "权限菜单",
  },
  permissionValue: {
    primary: '[data-testid="chat-mode-select-trigger"]',
    fallbacks: ['[class*="permission-trigger"]'],
    verifiedVersion: "3.11.x",
    note: "权限回读",
  },
  permissionOption: {
    primary: '[data-testid^="chat-mode-select-item-"][role="option"]',
    fallbacks: [
      // 3.14.3 真机实测：权限项 role 是 menuitemradio/menuitemcheckbox（不是 option），
      // 加 role 限制会 0 命中；与 modelOption 一样保留无 role 的兜底候选。
      '[data-testid^="chat-mode-select-item-"]',
      '[role="option"][data-permission]',
    ],
    verifiedVersion: "3.14.3-Windows",
    note: "权限候选。真机 testid 形如 chat-mode-select-item-{plan,build,edit,yolo}，可见名是项内的直接文本节点（如「完全访问」），其后还跟着一句说明文本",
  },
  thoughtLevelTrigger: {
    primary: '[data-testid="chat-thought-level-select-trigger"]',
    fallbacks: ['[role="combobox"][aria-label*="思考"]', '[role="combobox"][data-state]'],
    verifiedVersion: "3.14.3-Windows",
    note: "思考档位触发器（combobox）。真机实测（2026-09-30，模型 step-plan/step-5-preview）：存在且可见，文本为当前档位（如「开启」）；档位选项只在菜单展开后挂载",
  },
  thoughtLevelOption: {
    primary: '[data-testid^="chat-thought-level-select-item-"]',
    fallbacks: ['[role="option"][data-thought-level]'],
    verifiedVersion: "3.14.3-Windows",
    note: "思考档位选项。真机实测：testid 后缀为 enabled/disabled（开启/关闭），aria-checked 表示当前档位；档位集合随模型变化，因此集合的唯一判据是这里实际渲染出来的选项",
  },
  workOutsideProject: {
    primary: '[data-testid="composer-work-outside-project"]',
    fallbacks: [
      '[role="menuitemcheckbox"][aria-label*="不在项目中"]',
      '[role="menuitemcheckbox"][aria-label*="outside a project"]',
    ],
    verifiedVersion: "3.11.2-Windows",
    note: "工作区下拉中的「不在项目中工作」项：进入 ZCode default（无项目）工作区。真机实测：点击后触发器回读为占位词「选择项目」",
  },
  loginPage: {
    primary: '[data-testid="login-page"]',
    fallbacks: ['button[aria-label="登录"]', 'button[aria-label="Sign in"]'],
    verifiedVersion: "3.11.x",
    note: "登录/引导页",
  },
};

export function candidates(
  key: ZcodeSelectorKey,
  overrides: Record<string, string> = {},
): string[] {
  return [
    ...new Set(
      [overrides[key], ZCODE_SELECTORS[key].primary, ...ZCODE_SELECTORS[key].fallbacks].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  ];
}

export function candidateExpr(
  key: ZcodeSelectorKey,
  overrides: Record<string, string> = {},
): string {
  return JSON.stringify(candidates(key, overrides));
}
