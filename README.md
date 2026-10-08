<div align="center">

<img src="./assets/color.png" alt="预设工坊" width="112">

# 预设工坊 · Preset Workshop

**让每一个 Agent 都有自己的工作方式。**

查看人设与请求上下文，选择真正需要的工具和技能。<br>
把 pi 的极简理念再推进一步：**精简，可以由您自由组合。**

![Version](https://img.shields.io/badge/version-0.1-4d6bfe?style=flat-square)
![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-64748b?style=flat-square)
[![License](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](./LICENSE)

[功能](#功能) · [安装](#安装) · [使用](#使用) · [生效范围](#生效范围) · [兼容性](#兼容性) · [发布记录](https://github.com/Zai-G/dsh-preset-workshop/releases) · [更新路线](https://github.com/Zai-G/dsh-preset-workshop/blob/main/ROADMAP.md)

</div>

---

## 为什么做

Agent 可以执行命令、读写文件、调用网络，决定它行为的上下文却往往藏在界面之外。工具列表里有什么、系统提示词拼接了什么、哪些技能会被加载，这些内容关系到任务质量、权限与消耗，应当可以看清，也可以调整。

**预设工坊是 DeepSeek Harness 的透明预设工作台。** 每个预设独立保存人设、描述、系统段、工具与技能选择，不限制预设数量，也不接管其他插件创建的预设。

问答、编程、资料整理或专门工作流，各自保留需要的能力。减少无关工具与指令，让模型少一些选择负担，也让您更容易理解请求的组成。实际 token 与费用仍以模型供应商记录为准。

如果预设工坊对您有帮助，欢迎给仓库点一颗 **Star ⭐**，让更多人发现它。

## 功能

| | 您可以做什么 |
| :--- | :--- |
| **🗂 预设方案** | 新建、重命名、编辑描述、启停、删除与恢复默认；名称和描述同步到 DSH 原生预设 |
| **✍️ 系统提示词** | 编辑人设，查看实际变量，编辑、开关与排序宿主暴露的系统段；添加自定义内容 |
| **🔧 工具使用指令** | 整组排序与开关，逐段编辑；随着启用工具动态增减，与工具 JSON 描述独立 |
| **🧰 工具** | 默认八项按需开关；动态发现官方与第三方工具；重型能力按包选择 |
| **📝 工具描述** | JSON 弹窗编辑描述，保护调用名、参数类型、必填项与约束；错误明确提示 |
| **📚 技能** | 逐项绑定、全开或全不开；查看来源路径、诊断、描述、正文和加载后的补充 |
| **🔎 扫描** | 启动完整扫描一次，跟随来源晚注册更新；支持手动扫描与可选定时扫描 |
| **👁 预览** | 查看工具与技能、简化提示词、实际权限策略；选择会话或指定目录求值 |
| **📦 导入导出** | JSON / YAML，导出当前或全部；名称或 ID 重复时确认覆盖或修改后导入 |
| **↩️ 会话预设回退** | 停用、删除前检查引用并迁移；消息历史保留，失败保留原预设 |

界面跟随宿主语言与明暗主题，采用纵向卡片布局。

## 安装

npm 包名 `dsh-preset-workshop`，以下三种安装方式任选一种。

**从 npm 安装（推荐）**：在 DSH 对话中，请 Agent 使用宿主 `plugin_manager`（Creator 模式）安装该包：

```json
{
  "action": "install_bundle",
  "target": "dsh-preset-workshop"
}
```

命令行等价：`dsh plugin --profile <profile> add dsh-preset-workshop`。

**从本地目录安装**：下载或克隆本仓库，保留完整插件目录：

```json
{
  "action": "install_bundle",
  "target": "<插件目录的绝对路径>"
}
```

**从 GitHub 安装**：仓库地址 <https://github.com/Zai-G/dsh-preset-workshop>。本插件是原生 ESM、没有构建步骤，仓库里的源码就是运行代码，因此不需要 TypeScript 插件那样的 `prepare` 脚本，也不需要 `allowBuilds` 构建授权。

```json
{
  "action": "install_bundle",
  "target": "github:Zai-G/dsh-preset-workshop"
}
```

命令行等价：`dsh plugin --profile <profile> add github:Zai-G/dsh-preset-workshop`。可在末尾用 `#<commit>` 锁定到具体提交，避免仓库后续推送悄悄改变实际运行的代码，例如 `github:Zai-G/dsh-preset-workshop#<commit>`。DSH 会在安装前用 `git ls-remote` 确认仓库可达。

检查安装结果：`application: applied` 表示已应用；`restart-required` 表示需要重启。随后打开 **设置 → 预设工坊**。

安装与更新由宿主管理，请勿手写 profile 配置。

## 使用

1. **新建方案**：填写名称和 ID。ID 创建后不可改，名称与描述可以随时调整。
2. **编写人设**：初始为 `You are a helpful assistant.`。可写入宿主注册的 `{{cwd}}`、`{{model}}`、`{{provider}}` 等变量，在变量区查看实际值。`$ENV` 文本不会自动替换。
3. **组合能力**：选择工具、系统段与技能，按任务需要精简。绑定技能时会联动开启可用的 `skill` 工具，您仍可手动关闭。
4. **检查预览**：查看启用能力与最终提示词。默认读取当前打开的会话环境；没有会话时采用宿主的新会话默认权限。
5. **保存并使用**：「保存方案」保存全部草稿；提示词区「保存」只保存提示词；工具描述弹窗只保存该项。然后在 DSH 原生选择器中选用预设。

工坊的方案选择器切换编辑对象，不会擅自切换当前会话的预设。

默认八项为 `shell`、`read`、`edit`、`write`、`web_search`、`web_fetch`、`ask_user_question`、`todo_write`。macOS / Linux 使用 Bash，Windows 使用 PowerShell；具体可用性以宿主安装与扫描结果为准。升级保留已有预设的明确选择。

### 看清请求的组成

```text
# SYSTEM
You are a helpful assistant.

（官方系统段、工具使用指令、自定义内容与实际插件系统段）

## TOOL
read：Read a UTF-8 text file and return line-numbered content.

write：Create or fully replace a UTF-8 text file.

# USER
［用户第一句话 · 仅作占位显示，预设工坊不修改会话消息。］

## 环境策略
（宿主渲染的实际权限与审批策略）

## SKILL
（官方技能目录：名称、摘要与加载规则）

## AGENT［全局］
（当前预设的全局指令）

## AGENT［目录］
（宿主自动载入的工作区指令；没有内容时不显示）
```

这是便于阅读的分组视图。工具仅展示顶层描述，完整 schema 仍进入实际请求。AGENT、环境策略和技能目录属于 User 上下文；标题不改变消息角色，也不复刻已有会话的完整历史。token 按字符数估算，不是计费账单。

## 生效范围

| 修改 | 已开始会话中的生效时机 |
| :--- | :--- |
| 人设、系统段、工具使用指令及其顺序 | 下一次模型请求 |
| 已挂载工具的开关与描述 | 下一次请求；宿主其他限制继续有效 |
| 技能绑定 | 下一次目录发布与技能加载 |
| 全局 AGENT 覆盖或关闭 | 下一次请求追加替代旧全局指令的说明，目录指令保留 |
| 新增重型工具或更换工具来源／参数结构 | 释放并恢复会话后挂载；界面提示待恢复能力 |
| 停用或删除预设 | 空白会话立即重绑；已开始会话下次恢复时使用回退预设 |

已发出的请求与已执行的操作不会被回写或撤销。

<details>
<summary><b>提示词、技能与扫描的边界</b></summary>

- **系统段**：编辑宿主实际暴露的 section；数量与来源不限。工具使用指令按原生段编辑，随着工具选择变化；工具 JSON 只修改 schema 描述。
- **AGENT**：全局项覆盖官方 `<DSH_HOME>/AGENTS.md`，只作用于当前预设，不写原文件。不存在全局文件时仍可为该预设填写内容；目录指令由宿主自动载入，独立保留并只读展示。官方 `<system-reminder>` 包装沿用宿主渲染器。
- **技能**：借用真实 provider，不复制或改写源文件。同名来源按宿主规则解析；列表、详情与调用保持一致。目录只发布摘要，正文与 provider 补充在调用 `skill` 后加载。
- **权限**：读取宿主实际策略，不替代权限设置。所选会话策略变化或默认策略变化后，预览会自动更新；扫描也重新求值。
- **第三方能力**：只能列出宿主已注册的工具。来源插件关闭、未注册的工具需先在那里启用。
- **代理层**：（如`billion-context`） 在代理转发层追加的压缩指令没有暴露 DSH 读取／覆盖接口，工坊会提示该边界，不能预览、编辑或排序这一层。扫描不等于完整供应商 HTTP 抓包。

</details>

## 兼容性

目标宿主为官方 **DeepSeek Harness `0.2.0-rc.2`**。插件复用宿主的文件系统、shell、权限、技能和 Web 设置服务，无额外前端构建步骤。

工具和技能随各平台实际安装的官方包及第三方来源变化。使用 `dsh web` 或官方桌面端打开工作台。官方 headless／SDK／ACP 默认未挂载本插件依赖的预设服务，不属于本插件的适用入口。

## 数据与卸载

业务数据与插件仓库分离：

```text
<DSH_HOME>/preset-workshop/
├── config.json                设置与预设索引
├── catalog.json               工具发现快照
└── presets/<id>/
    ├── preset.json            名称、描述、状态、技能
    ├── prompt.json            人设与系统段覆盖
    └── tools.json             工具选择与描述覆盖
```

路径跟随宿主 `DSH_HOME`，支持 home 缩写；未设置时使用 `~/.dsh`。保存使用文件锁、原子替换和 journal 恢复，revision 冲突会阻止覆盖。分享导出文件前，请检查其中的人设、指令、路径与技能名称。

卸载前，请先把引用本插件预设的会话迁移到仍可解析的宿主预设，再使用 `plugin_manager` 的 `remove_bundle`。直接卸载可能导致这些历史会话无法恢复；卸载保留业务数据，需要清理时请先备份。

## 使用提醒与免责声明

> [!WARNING]
> 修改提示词、工具描述或技能会影响 Agent 的判断与操作。请在理解内容和权限后使用，并保留重要资料备份。保存、取消和恢复默认无法撤销已经发生的操作。由修改系统提示词与工具描述造成的后果，包括误删或覆盖文件、隐私泄露和额外费用等，由您自行承担。

权限与审批由 DSH 和来源插件执行。预设工坊不能保证模型行为或第三方插件安全，也不能替代您的判断、备份和账单核对。本插件按 [MIT 许可](./LICENSE) 的“现状”提供；**作者不对使用造成的损失承担责任，请确保您了解LLM与提示词机制后在使用本插件创建一个属于您专属AI预设，否则建议您仅使用官方预设**。

## 版本与更新

当前公开版本为 **v0.1.0**，已发布到 [npm](https://www.npmjs.com/package/dsh-preset-workshop)。[GitHub Releases](https://github.com/Zai-G/dsh-preset-workshop/releases) 和 [更新日志](https://github.com/Zai-G/dsh-preset-workshop/blob/main/CHANGELOG.md) 记录每版功能、兼容性及升级注意事项。

近期优先处理 `0.1.x` 的稳定性、真实桌面端与 Windows / Linux 验收；后续再推进宿主版本适配及导入诊断。具体维护优先级见 [更新路线](https://github.com/Zai-G/dsh-preset-workshop/blob/main/ROADMAP.md)，计划能力与已实现功能分别标明。

## 源码

```text
src/                 Host 服务、请求策略、存储与原生客户端
assets/              黑白导航图标与彩色品牌图标
cordis.patch.yml     Bundle 入口
```

---

<div align="center">

**更少的无关上下文，更清楚的工作方式。**<br>
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [MIT](./LICENSE)

</div>
