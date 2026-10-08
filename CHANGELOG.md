# 更新日志 · Changelog

本文件记录已发布版本。尚未完成的工作见 [更新路线](./ROADMAP.md)；每次发布会在 [GitHub Releases](https://github.com/Zai-G/dsh-preset-workshop/releases) 中列出变化、兼容性和升级注意事项。

## v0.1.0 · 2026-10-08

预设工坊首次公开发布，npm 包为 [`dsh-preset-workshop@0.1.0`](https://www.npmjs.com/package/dsh-preset-workshop/v/0.1.0)，采用 MIT 许可。

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

后续优先处理 `0.1.x` 的使用反馈、兼容性与实机验收；具体计划见 [ROADMAP.md](./ROADMAP.md)。
