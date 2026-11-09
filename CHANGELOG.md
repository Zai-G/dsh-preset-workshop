# 更新日志 · Changelog

本文件记录已发布版本。每次发布会在 [GitHub Releases](https://github.com/Zai-G/dsh-preset-workshop/releases) 中列出变化、兼容性和升级注意事项。

## v0.3.1 · 2026-11-09

适配 DSH `0.2.2-rc.1`，最低支持版本同步提升至该版本：AGENTS 指令改由宿主官方渲染器统一产出并合并为单条 User 消息，官方工具改为逐项清单加按需挂载来源，工作目录成为预设级开关；同时修复 schema 覆盖绕过来源准入、旧包级选择迁移、同名来源切换后存量会话状态错配等问题。

### 新功能

- **工作目录预设级开关**：新增受管段 `workshop:user-cwd`（`src/core.js:17`），默认开启、只读、不可排序，重置预设即恢复默认。关闭时 `src/scope.js:16-22` 在该预设的上下文层为 `working-directory:current` 包一层求值器，命中关闭状态返回空串；`src/scope.js:138-141` 同时从实际请求的 contexts 中移除该条。只抑制本预设的注入，不注销宿主 `workingDirectory` 服务，也不影响其他预设；重新开启后按当前会话目录取值。扫描计数同步按开关口径统计（`src/index.js:554`），仅启用环境时不再把工作目录算作有效提示词段。
- **官方工具逐项呈现**：扫描结果改为「工具级清单 + 隔离探测」两级：只有探测出 `entries` 的包才进入候选，`executor-native`、`executor-ptc`、`executor-testkit` 等非工具包从扫描中排除（`src/catalog.js:13` `NON_TOOL_PACKAGES`），探测失败、空包不再显示，也不再触发空工具预览失败。启用重型工具时，`packages` 仅由已启用工具推导并在当前预设内挂载所需来源；工具全部关闭时仍保留工具级列表，不回退为包级开关。

### 变更与优化

- **AGENTS 走官方渲染器**：预览与真实请求统一取 `instructions.renderAgentInstructions(files, { maxBytes }).text`；`src/index.js:504-506` 把全局文件与 `discoverBaselineInstructionFiles` 得到的目录文件合并渲染为 `requestText`，作为**单条** User 消息发出，取代 0.3.0 中由插件分头拼接的 `preset-workshop-directory-instructions` 消息。User 注入顺序改为 AGENTS(-2) → 工作目录(-1) → 环境(0) → 技能目录(100) → 时间与时区(200)（`src/scope.js:125`），预览中 AGENTS 段位于工作目录之上。
- **预览正文去包装**：新增 `plainInstructionContent()`，从宿主渲染结果中剥掉 `<system-reminder>` 外壳与 `Instructions from: <path>` 头，仅对已知 `displayPath` 生效，正文里普通的 `Instructions from:` 文本不再被误删；预览不再重复展示宿主生成的包装。
- **同名工具来源**：`catalog.withAlternates()` 为单工具包生成最多两个候选，按 `sameToolSchema` 过滤 schema 完全一致的冗余候选；`tools.sources[name]` 记录选中来源，主卡显示 `source-note` 并可直接关闭，候选卡只读，`openTool(name, source)` 仅展示其 schema；同名区与官方工具区统一为两列布局。
- **工具来源推导与清理**：保存时由 `tools.enabled` 与 `tools.sources` 反推 `tools.packages`（`src/index.js:890-904`），关闭工具即从 `sources` 删除条目，不再残留悬空来源；`syncToolOverrides()` 对未启用、无来源或无覆盖的工具直接 `dispose()` 其注册。
- **图标与主题**：设置页导航图标改为注册宿主原生 `settings.section.icon` 槽位（`src/client.js:811`，`mask-image` 指向 `/preset-workshop/icon.png` 并跟随 `currentColor`），不再自绘；人设与宿主标题旁的提示图标以 `align-self:center` 与负外边距贴齐标题；深色模式开关轨道改用 `color-mix` 提升对比。
- **投影接口迁移**：`sessionProjections` 由读取已弃用的 `stateOf` 改为包装 `register(definition)`，返回的 handle 同时提供 `stateOf` 与 `readerFor`（`src/scope.js:27-45`）；`apply` 改为 `async` 并等待 `timeModule.apply` 完成注册。
- **扫描口径**：空 `mcp:<name>` 段不再计入提示词段数，自定义 User 段按启用且有正文才计数（`src/index.js:550-558`）。

### 修复

**宿主兼容（`0.2.2-rc.1`）**

- 预览会话改由 `Session.create(id, undefined, { version: sessionFormatVersion, id, createdAt, cwd, isSeeded: false, agentPreset })` 建立，`sessionFormatVersion` 取自 `@deepseek-ai/dsh-session`，修复新版会话格式下预览构造失败。
- 时间上下文预览按新签名传入 `{ agent: { session }, turn, step, signal }`，并从包装后的 `register` 句柄取状态，修复预览读数为空。
- 提示词装配适配 context 层：`transformPrompt(assembly, preset, catalog, definitions, admittedTools)` 新增准入集合，未准入的 `tool:` 段与工具不再进入系统提示词与工具表。

**工具 schema 与来源**

- 工具覆盖注册时保留宿主来源的激活条件：`toolActivation()` 从 `ctx.tools.layers.chainLayers(scope)` 读取 `registration.when`，`toolSourceAdmitted()` 先逐层校验 `admits(name)` 再求值 `when`（`src/index.js:315-322`），覆盖后的 schema 不再绕过来源、模型与 Agent 身份准入。
- 修复关闭工具后自定义 schema 仍进入请求的问题：`syncToolOverrides()` 以 `enabled` 为准注销覆盖注册。
- 修复切换同名来源后继承旧 schema 覆盖的问题：保存时若来源改变且覆盖与上一版逐字相等，丢弃该覆盖，只保留独立的 `prompt` / `promptEnabled`（`src/index.js:908-919`）。
- 修复 `bash` 与 `bash-persistent` 等同名终端来源在逐项选择后状态失配：终端名归一化后按来源区分，隐藏的终端包不再进入清单（`src/catalog.js:15,83`），勾选状态以 `sources[name] || canonicalSource(name)` 判定，切换时同步写入或清理 `sources` 与 `packages`。
- 旧包级选择迁移：`migrateLegacyPackageSelection()` 把包内工具展开为逐项选择，启动时 `migrateStoredToolSelections()` 对存量预设逐个校验并写回（变更则 `revision + 1`，失败记录 `tool-migration-failed` 警告而不阻断加载）。
- 修复同名来源切换后存量会话未提示待迁移：`toolSourceMatches()` 改为比较选中来源包与实际挂载包，并按 `sameToolSchema` 核对 schema；`pendingTools()` 据此列出需要恢复会话的能力（`src/index.js:225-245,292`）。

**AGENTS 与工作目录**

- 修复目录 AGENTS 重新开启后丢失宿主消息包装：合并路径统一由官方渲染器产出，不再手工拼接提醒文本。
- 修复原生 AGENTS 非基线增量更新被合并逻辑误删：过滤 `agent-instructions` 消息时只移除 `baseline === true` 的替换基线，保留宿主追加的增量消息（`src/scope.js:97-99`）。
- 修复仅启用环境时仍注入工作目录的问题（`src/scope.js:138-141`）；关闭后再次开启工作目录，按当前目录重新求值。

### 兼容性与验证

- peer `@deepseek-ai/dsh-scope` 提升为 `>=v0.2.2-rc.1`，仍不设上限；低于该版本的宿主不再满足声明。声明门槛同时体现在 README 的版本徽章。
- 在 DSH Desktop `0.2.2-rc.1` 解包运行时上通过 `npm run check`、`npm test`（28 项）、`test:host`、`test:portability`、`test:adaptation`、`test:offline`。
- `tools/offline-mock.js` 对齐新版装配：System 层只保留工具使用指引与 MCP 资源服务器两行，工作目录改由 `transformPrompt` 的准入集合处理，并按同一方法生成 `estimatedTokenRange`。
- 未验项：供应商与远端 MCP、冷盘计时、Windows / Linux 实机，以及本版的真实桌面端交互验收。

## v0.3.0 · 2026-11-02

设置页整体重构：配置区改为前端分段切换与预览摘要卡，预览与编辑弹窗同构，User 上下文按固定顺序分层；宿主门槛提升至 DSH `v0.2.1-rc.5`。本节覆盖 2026-10-25 以来的累计变更。

### 新功能

- **配置分段切换**：`config-tabs`（`role="tablist"`）承载提示词、工具、MCP、技能、兼容五个 `config-pane`（`role="tabpanel"`），切换时同步 `aria-selected`、`active` 与 `hidden`，只呈现当前面板；工具、MCP、技能列表各自保留内部滚动位置，不再需要纵向长滚。
- **预览摘要卡**：`#preview-launch` 常驻「预设方案」下方，`#preview-summary` 显示 `N 个工具 · N 个MCP · N 个技能 · 约 min–max token`；「查看」打开预览弹窗，生成中或草稿变更后禁用。编辑后经 350 ms 防抖重新生成。
- **预览弹窗**：标题加副标题「当前预设的实际组成与请求上下文估算」；摘要、预览环境选择、工作目录与「工具与技能 / 最终提示词」两个分段固定在滚动区上方，最终提示词按 System → User → 工具（TOOL、MCP）分层，滚动只发生在弹窗正文。
- **扫描迁入兼容页**：`#scan-tools`、自动扫描开关与间隔（默认 300 秒）合并为兼容页扫描条；`scanSentence()` 汇总提示词段、工具、MCP（含工具数）、技能与预设数量；结果分为「已安装 / 发现 / 快照」。
- **User 层工作目录独立成项**：`displayPrompt` 新增 `{ name: '工作目录', order: -1 }`，与运行时环境快照分开阅读；仅为展示拆分，不改变实际注入的 User 消息结构。
- **token 估算区间**：`estimatedTokenRange = { min, max, method }`；CJK（Han / Hiragana / Katakana / Hangul）按每字 1–2 token、其余字符按约 4 字符/token 计算，摘要与弹窗显示区间，并按 System、User、工具与 MCP 分色。

### 变更与优化

- **提示词区重排**：人设为独立卡片并默认展开；「宿主」卡片分 System 与 User 两层，System 段可编辑、开关，排序仅从四点手柄启动并支持方向键，User 顺序固定且不提供排序手柄。
- **工具列表限高**：官方 / 第三方列表按实测行高取「前 8 行 + 第 9 行一半」，超过 8 项才启用 `is-capped` 与 `overflow-y`；折叠或展开其他分组时不撤掉测量中的 `max-height`，当前滚动位置不再跳回顶部。
- **弹窗同构**：编辑与预览统一为「标题 + 副标题 + 单块正文」，内容名移入副标题，正文只保留内容块；副标题复用列表短名，不再暴露 `context:file-reference` 等内部 id（`labels` / `sectionName` 提升到 mount 作用域）。
- **AGENTS 短名**：编辑行与最终提示词统一为 `AGENTS「全局」`、`AGENTS「目录」`，级别说明只留在弹窗副标题；目录 AGENTS 弹窗副标题为「项目级 AGENTS.md，请在对应目录进行修改」。
- **输入框自适应**：人设与工具使用指令按内容自适应并限高，超高后在框内滚动；取消拖拽拉伸，重新打开后高度稳定。
- **MCP 连接超时**：`MCP_CONNECT_TIMEOUTS = { stdio: 120000, 'streamable-http': 30000 }`（`src/scope.js:5`），超时统一返回 `timeout`，与 `error` 区分。
- **图标与样式**：分类按钮补齐线条图标，说明图标改为问号，悬停只改变文字颜色，移除多余边框与灰底。
- **技能全选**：操作固定在右侧，文案为「全选/全不选」（`Select all` / `Deselect all`）。
- **兼容页占位**：「正在开发中...」改为只包住文字的淡黄描边胶囊，字色与底色对比度由 2.74:1 提升到约 5.9:1（AA）。
- **宿主门槛**：peer `@deepseek-ai/dsh-scope` 由 `>=0.2.0-rc.2` 提升为 `>=v0.2.1-rc.5`，仍不设上限。

### 修复

**上下文与 System**

- 修复预设内关闭环境段后仍注入可选运行时上下文的问题；宿主 `required` 的工作目录上下文继续保留。
- 修复关闭环境后 `harness:source` 与 `app:web-surface` 仍进入 System prompt 的问题（`src/scope.js:132`）。
- 修复关闭环境提示后开关行随文本消失、无法再次启用的问题。
- 修复最终提示词重复展示所选会话工具清单，以及为插件注入提示词硬编码来源名称的问题。
- 修复 AGENTS 在最终提示词里仍使用长句描述、与列表短名不一致的问题。

**全局 AGENTS**

- 修复全局 AGENTS 预览只显示用户正文的问题，改取 `renderAgentInstructions()` 的 `renderedText`，与真实请求同源。
- 修复 `Instructions from:` 被换成本机绝对路径的问题；统一显示 `~/.dsh/AGENTS.md`（设置 `DSH_HOME` 时为 `$DSH_HOME/AGENTS.md`）。

**工具与技能**

- 修复跨平台终端处理导致默认工具数变成七项的问题：不再按平台猜测并隐藏另一终端工具，默认仍选择平台终端；官方禁用插件工具继续从官方池过滤。
- 修复 Host 扫描遇到同一工具包同时存在启用与停用来源时，把整个包误判为停用的问题。
- 修复工坊预设隔离挂载沿用全局禁用标志、导致预设技能工具无法进入请求的问题。
- 修复折叠或展开另一工具分组时测高过程移除列表高度约束、当前滚动位置跳回顶部的问题。

**MCP**

- 修复 MCP 超时被显示为普通连接失败的问题。

**界面**

- 修复人设旁「变量说明」浮层跑出窗口、鼠标移向浮层即消失的问题。
- 修复工具区没有外框、多个分组紧贴在一起的问题。
- 修复宿主卡片带副标题时文字偏上、下方空出一大块的问题。
- 修复预览窗口层层嵌套滚动、内容被挤在中间一小条的问题。
- 修复人设与工具使用指令编辑框可被拖拽拉长、重新打开后高度不稳定的问题。
- 修复预览弹窗与编辑弹窗排版错位、内容名以小灰字出现在正文里的问题。
- 修复扫描结果里工具数与 MCP 工具数重复计算的问题。

### 兼容性与验证

- peer 依赖 `@deepseek-ai/dsh-scope` 改为 `>=v0.2.1-rc.5`：低于该版本的宿主不再满足声明，升级前请先确认 DSH 版本。
- 在 DSH Desktop `0.2.1-rc.5` 解包运行时上通过 `npm run check`、`npm test`、`test:host`、`test:portability`、`test:adaptation`、`test:offline`。
- 新增 `test/css.test.mjs`：校验 `client.css` 括号平衡、基础层未被 `@container` 吞掉、层级单元格主题变量、容器查询层级与类名覆盖；`npm test` 覆盖增至 24 项。
- `tools/offline-mock.js` 对齐宿主的 `system-reminder` 包装与 `AGENTS「全局」` / `AGENTS「目录」` 段标题；`test:offline` 默认使用仓库内参考页，缺文件时跳过并成功退出。
- 未验项：供应商与远端 MCP、冷盘计时、Windows / Linux 实机，以及本版的真实桌面端交互验收。

## v0.2.0 · 2026-10-25

MCP 与预设编排更新，协议转入 Apache 2.0。本节覆盖 2026-10-8 以来的累计变更。

### 新功能

- **预设级 MCP 服务**：在当前预设内新建、编辑、删除 `stdio` 与 `streamable-http` 服务器，可配置命令、参数、环境变量与 HTTP 请求头。配置写入该预设的 `preset.json` 并编译进其自身的 `plugins` 组合；`serverName` 编辑期间固定、单个预设内唯一，并拒绝与环境中的服务器重名。环境服务器只读，不提供编辑/删除。预设停用/删除时组合注销，连接与子进程随之释放。
- **MCP 连接检测**：「检测」在临时 scope 内连接服务器并读取工具数，15 秒超时后释放 scope；不调用任何工具、不写配置。服务开关关闭时同样可用；环境服务检测按内部配置读取，不向前端回传连接密钥。
- **MCP 每预设开关**：自建服务对应 `mcp[].enabled`，环境服务对应 `mcpEnabled[serverName]`，旧配置未写开关时默认开启。有选中工具时禁止关闭服务——后端保存与草稿预览同样拒绝该矛盾配置；工具归属按最长服务器名前缀匹配。关闭服务后，`mcp:<serverName>` 与 `mcp-resource-servers` 名单一并从实际 System 与编辑池过滤，空名单不显示。
- **MCP 预览**：显示服务器名称、连接方式与对应配置项；HTTP 请求头默认遮蔽，每个值可独立切换显隐，不修改保存配置。连接未就绪时保留服务器配置，已保存且仍启用的工具如实标记「不可用」，不伪造可调用 schema。
- **「时间与时区」按预设开关**：工坊预设局部挂载官方 `dsh-time-context` hook，`prompt.sections["time-context"].enabled` 控制下一请求是否注入；text 留空且不进入 System；保留官方默认 10 分钟刷新间隔。detached 会话上直接运行官方 hook 生成预览样本。
- **User 区会话实况（只读）**：显示所选活会话已注入的时间与时区原文；同时显示 tool-management 经 `agent/pre-step` 注入的会话实况——从公开 `session.surface.nodes` + `eventAt(seq)` 读取最新 `source.kind=prompt-manager-catalog` 原文并标注来源；最新 `form=notice` 代表已清空。
- **System / User 编辑分组**：System 段支持编辑、开关与排序，仅可从四点手柄启动拖拽并支持方向键；User 展示环境、技能目录、AGENTS（全局级）/ AGENTS（目录级），其中全局级可在当前预设内编辑，目录级与权限由宿主管理。「AGENT」标签更名。所有空原生段（含默认空 suffix）不进入编辑池。
- **导出增强**：支持从已有预设中多选导出，默认全不选，提供全选/全不选；格式选择改为卡片式。
- 扫描摘要同时汇报 MCP 服务数与工具数；技能绑定的「全开/全不开」合并为单个状态按钮。

### 变更与优化

- **兼容声明放宽**：peer 依赖 `@deepseek-ai/dsh-scope` 改为 `>=0.2.0-rc.2`（无上限；已验证至 `0.2.1-rc.3`），避免宿主升级时被版本上限锁定。
- **适配 `0.2.0-rc.2` ~ `0.2.1-rc.3`**：新版工作目录并入 User 环境，随 `workingDirectory` 会话目录变化更新；旧 `{{cwd}}` 模板按本预设局部变量兼容，不再重复输出。
- **预览阅读结构**：`displayPrompt` 顺序固定为 System → TOOL 顶层摘要 → MCP 服务器 → User 占位 → 环境 → 时间与时区 → SKILL → AGENTS（全局级）→ AGENTS（目录级），仅显示实际有内容的分组；MCP 工具从 `TOOL` 拆入独立 `MCP` 区、按服务器分组并逐工具开关，官方 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 留在「工具 → 官方」管理。TOOL 摘要不是额外 System 消息，完整工具 schema 仍独立参与请求。
- **MCP 连接生命周期**：保存后由 `src/mcp.js` 在后台启动真实宿主行（15 秒超时停该子树），状态 connecting / ready / error；配置完全相同的草稿复用已挂载连接（策略以 JSON 字符串传给 binding，防止环境变量/请求头表达式提前求值）；删除立即发起取消，owner 卸载等待传输收尾，不再阻塞页面操作。修改连接后旧 Agent 隐藏原执行器并提示恢复会话（pendingTools）。
- **MCP 界面**：按服务器分组、工具双列，工具列表限 `min(360px, 48dvh)`、服务总列表限 `min(640px, 72dvh)` 并内部滚动；图标复用第三方工具通用图标；切换工具开关保留展开状态；显示服务器来源（环境 / 自建 / 当前工具）与已启用工具数；环境服务始终排在自建之前；主面板与服务默认折叠并记忆展开状态。
- **MCP 表单中文化**：连接方式改为平行按钮切换，切换时保留另一方式的草稿；提供「表单 / JSON」两种填写方式。
- **弹窗尺寸**：MCP 配置/预览、提示词编辑/阅读按内容与视口设定尺寸上限，正文超限时内部滚动、底部按钮保持固定可见。
- **回退迁移**：停用或删除预设后，仍停留在该预设的空白会话即时迁移到回退预设。
- **扫描与技能目录**：最多四个并发槽位导入/探测；同时读取技能来源与来源版本变更，按名册顺序合并，不使用过期缓存；环境 MCP 只收集无 scope、未禁用且 fiber 已激活的条目；已撤销的第三方工具移出库存。
- 工具卡片与描述弹窗移除工具来源展示；官方 package 仍用于组合、来源校验与重型包启停。
- 提示词编辑：专业段落改用易读名称（「文件引用」「MCP 资源服务器」「交付文件引用」等）；排序仅可从四点手柄启动，拖动时保留卡片可见。
- 悬浮说明：代理层边界说明统一放在「拼接」旁，变量说明移到「人设」旁；悬浮区带透明接续区域可将鼠标移入正文，不因点击误折叠父区。
- GitHub 入口改实心图标；版本 SVG 放大为 22×8px、与 22×22px 图标同宽固定置于下方，组合在标题行内居中。
- 导入导出上限提高至 8 MiB（JSON 请求与导入文本同限）；导入前若存在未保存修改，先提示是否丢弃；覆盖冲突须校验目标 revision。
- 「待挂载工具」提示改为按实际情况列出具体工具名单或给出通用提示。
- 版本协议更新为 Apache 2.0；保留纵向卡片、两列工具、主题 token 与自绘选择器等既有界面形态。

### 修复

**时间与时区**

- 修复工坊预设缺少官方时间与时区注入、以及只能在官方预设发送消息后才能读到时间段的问题。
- 修复关闭期间收到请求、随后重新开启时，原生刷新间隔阻止首条新读数的问题：重新开启后的首个请求立即注入，之后恢复原生间隔。
- 修复更改工作目录后预览仍读取会话初始目录的问题。

**MCP**

- 修复修改或移除 MCP 连接后，已开始会话继续使用旧连接与资源工具的问题；需要重新挂载的能力会提示恢复。
- 修复相同草稿复用时遗漏 MCP 资源工具的问题。
- 修复环境变量或 HTTP 请求头表达式导致已保存连接被误判为未保存的问题。
- 修复同前缀服务名称在草稿中串用工具或重复注册的问题。
- 修复 MCP 服务关闭时预览「检测」不可用的问题；检测不改变开关或不写配置。
- 修复 MCP 预览缺少连接信息且 HTTP 请求头明文显示的问题（现默认遮蔽、逐项显隐）。
- 修复 MCP 工具开关导致所属服务卡片折叠，以及添加、编辑、删除时误提示「丢弃未保存修改」的问题；连接编辑后保留其他未保存草稿与服务开关。
- 修复 MCP 编辑/删除按钮悬浮时出现白色边框的问题。
- 修复空的 `mcp:<服务器名>` 段进入提示词预览、MCP 资源服务器占位、以及待挂载工具为空时提示含空名称的问题。

**工具与技能**

- 修复晚注册的同名第三方工具覆盖官方工具定义的问题。
- 修复 `0.2.1-rc.2` 下技能目录与 AGENTS 服务依赖缺失、以及旧 `{{cwd}}` 文本导致预览或请求失败的问题。
- 修复上下文压缩后全局 AGENTS 未重新进入上下文的问题；判重只依据 surface 可见消息及本步待发送消息。
- 修复已选技能无法加载时静默缺失的问题：预览列出缺失项，真实请求明确报错。
- 修复全局 AGENTS 未同时覆盖宿主 `DSH_HOME/AGENTS.md` 与共享 agents 目录全局文件的问题。

**会话与预设**

- 修复从工坊预设切换到宿主原生预设时，会话沿用旧工具名单导致策略不正确的问题。

**界面**

- 修复打开设置页时 `AGENT_SECTION is not defined` 报错及部分操作按钮无文字的问题。
- 修复 Windows 下预设「已保存」状态点与内置标记颜色不稳定的问题。
- 修复英文 Description 标签与输入框重叠、部分弹窗过大/过小或切换连接方式时高度与按钮位置跳动的问题。
- 修复点击变量悬浮正文误触人设折叠、以及 System 拼接区代理层边界说明重绘后消失的问题（统一为「拼接」旁悬浮说明）。
- 修复空的「补充指令」与当前未启用来源残留在拼接区的问题（空原生段不再进入编辑池，来源未注册的旧覆盖保留在配置但不凭空注入）。
- 若干文案与版式微调：代理转发层说明与工具名称间距等界面细节。

### 兼容性与验证

- 协议由 MIT 转为 Apache 2.0（自本版本起）。
- 已完成 `npm run check`、基础测试 18/18、新旧两版完整 host / adaptation / portability 回归，以及提供 `STUDIO_REFERENCE_HTML` 的 offline 与差异空白检查。
- 「时间与时区」回归覆盖：关闭期间请求、重新开启后的即时读数、随后恢复原生间隔。
- 实机未验：真实 Desktop 安装、供应商/远端 MCP、冷盘计时与 Windows / Linux 平台；发布前请关注 GitHub Releases 补充说明。

## v0.1.0 · 2026-10-08

预设工坊发布，npm 包为 [`dsh-preset-workshop@0.1.0`](https://www.npmjs.com/package/dsh-preset-workshop/v/0.1.0)，采用 MIT 许可。

### 主要功能

- 多预设管理：独立保存名称、描述、人设、系统段、工具选择与技能绑定，支持启停、恢复默认及 JSON / YAML 导入导出。
- 系统提示词编辑：修改、开关、排序宿主暴露的系统段，添加自定义内容，查看变量的实际值。
- 动态工具使用指令：逐原生段编辑、整组排序与开关，成员跟随启用工具变化；与工具 JSON 描述分别保存。
- 工具与技能组合：默认八项工具，扫描官方与已注册第三方能力；编辑 schema 描述时保留参数结构和约束，技能详情区分目录摘要、正文与加载后的补充。
- 会话环境预览：默认选择当前会话，展示请求的分组组成、工具顶层描述、技能目录、AGENT 指令及宿主实际权限策略。
- 生效时机提示：已挂载能力的策略在下一次请求读取；新增重型工具或更换工具来源、参数结构时提示释放并恢复会话。
- 数据保存与回退：业务数据独立存储，写入使用文件锁、revision 校验、原子替换与 journal 恢复；停用或删除预设时检查会话引用并迁移。
- 原生设置界面：支持宿主语言、明暗主题、窄面板与弹窗内部滚动，无前端构建步骤。

### 兼容性与验证

- 目标宿主：官方 DeepSeek Harness `0.2.0-rc.2` 的 Web 工作台与桌面端入口。官方 headless / SDK / ACP 默认缺少所需预设服务，不属于适用入口。
- 已完成语法检查、13 项轻量回归，以及隔离宿主、安装与界面验证。macOS 上以官方 CLI 在隔离 Web profile 验证安装；Windows / Linux 的路径与平台分支经过模拟测试，实机验收仍待完成。
- 预览展示宿主暴露的请求组成，不代表完整供应商 HTTP 历史。代理转发层追加且未暴露接口的指令（如 `billion-context` 压缩内容）不能在工坊中编辑或排序。

### 安装与升级

- npm 安装：`dsh plugin --profile <profile> add dsh-preset-workshop`。
- GitHub 安装：`dsh plugin --profile <profile> add github:Zai-G/dsh-preset-workshop`；需要固定版本时可使用对应发布提交。
- 安装后打开「设置 → 预设工坊」，并按宿主的 `application` 结果决定是否重启。
- 从此前本地试用的 `dsh-preset-studio` 切换时，旧名称的数据目录与 v1 导出文件不会自动迁移。请保留原数据备份；本次公开发行使用 `preset-workshop` 命名空间。
