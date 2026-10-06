# v0.7.10 — 视觉内容判定的外发闸门语义精确化（issue #29）

> 详见 [CHANGELOG](../CHANGELOG.md#0710---2026-10-06)。

## 背景

issue #29 报告：`allowRemote=false`（默认）时，内容判定规则用 `<image:base64:file>` 会被 schema
拒绝，但把同一张被检图片改用 `<image:path>` 交付则**不受任何约束**；而 `SECURITY.md` 的措辞
（「MCP 的强制力仅在契约层」）会让读者以为契约层**封死了「把图交给命令」的所有形态**。issue 建议
「把 `<image:path>`、`<expect:file>` 一并纳入 `allowRemote` 门控」。

本版**没有原样采纳该建议**，理由用两条实测钉死：

## 为什么不门控 `<image:path>`

### 1. 零安全收益（反证探针实测）

判定命令的 `cwd` 就在**项目目录内**（`src/visual/content.ts` 的 `projectFile(ctx.project, effective.cwd)`，
默认 `"."`），而被检图片（`contents[].files[]`）本身也是**项目内文件**。于是：

```
project(cwd) = D:\Trae项目\tianshu-mcp
被检文件(项目相对) = package.json
argv 中是否含占位符 = false
exitCode = 0
输出 = {"passed":true,"confidence":1,"reason":"READ 4187 bytes with zero placeholders"}
```

**命令在零占位符下就能读到项目内文件的字节。**门控 `<image:path>` 只是让用户「开 `allowRemote`
才能拿到本来就能读的路径」，不增加任何安全性。

### 2. 反向扩大外发面

「必须开 `allowRemote` 才能过 schema」会把用户推向一个更宽的配置——`allowRemote=true` 会**连带放行**
`<image:base64:file>`（内联字节）。即：为了门控路径通道，反而打开了真正的内联字节通道。

### 3. `<expect:file>` 根本不是图片通道

它交付的是**期望文本**临时文件（用户自写的描述），不含被检图片字节。issue 在此处把两个性质不同的
占位符归并了——本版在文档里显式澄清，避免读者继续沿用该误读。

## 本版实际做了什么

`allowRemote` 的真实定位是**防无意/防误配的内联外发**，它不是「防有意外发」，也**不是**系统层拦截
（后者 `SECURITY.md` 早有如实声明）。现状是**有意识的取舍**，缺的只是把取舍说清。所以：

| 改动 | 位置 |
|---|---|
| 新增 `contentChannelUsage()` 作为**通道语义的单一来源**（门控判定与展示共用，防分叉） | `src/visual/schema.ts` |
| `visual doctor` 逐规则输出**实际使用的占位符通道**与是否 `GATED by allowRemote` | `src/visual/runtime.ts` |
| `visual content probe` 输出新增 `egressConstrained` / `pathChannels` | `src/visual/manage.ts` |
| 双语文档措辞精确化 + `<expect:file>` 性质澄清 | `SECURITY.md`/`.en.md`、`docs/visual-acceptance.md`/`.en.md`、`skills/tianshu-mcp/SKILL.md` |

修复后 `visual doctor` 的输出形如：

```
logo: judge -> /usr/bin/judge; allowRemote=false (constrains only <image:base64:file>);
channels used: <image:path>, <expect:file> — NOT gated by allowRemote
```

**通道是可见的，不是隐藏的。**

## 行为边界（未变）

- `allowRemote=false` 仍**拒绝** `<image:base64:file>`（schema 直接拒绝，不是运行期提示）。
- `<image:path>` / `<expect:file>` 仍不受 `allowRemote` 约束——这是刻意的，理由见上。
- 契约层仍**不是**对图片外发的完备拦截；图片是否离开本机取决于用户自备命令的行为。

## 验证

- 新增 5 个通道/准入契约用例 + 2 个 doctor 通道语义用例；probe 字段断言同步。
- 全量 `npm test`：**1582 passed / 12 skipped，0 失败**。
- `typecheck` / `lint` / `build` / `pack:check` / `check:stdio` 全绿。

## 已知限制

- 若用户确实需要「`pages[].content` 场景（截图落在项目外的任务目录）也硬门控 `<image:path>`」，
  那是**破坏性变更**（同占位符在两类规则中语义不一致 + 需批量迁移配置），issue #29 中已列为待定项，
  本版不做。
- `visual doctor` 的通道可见性是**告知**，不是**阻止**。
