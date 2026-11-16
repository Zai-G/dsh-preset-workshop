// Native DSH client module; React is supplied by the host.
window.__ModuleLoader__.load({
  id: 'dsh-preset-workshop',
  factory: require => {
    const React = require('react');
    const html = __WORKSHOP_HTML__, css = __WORKSHOP_CSS__;
    const NS = 'preset-workshop';
    const BUILTINS = ['bash', 'read', 'edit', 'write', 'web_search', 'web_fetch', 'ask_user_question', 'todo_write'];
    const AGENT = 'workshop:agent-instructions';
    const DIRECTORY_AGENT = 'workshop:directory-instructions';
    const USER_DIRECTORY = 'workshop:user-directory';
    const USER_CWD = 'workshop:user-cwd';
    const names = { todo_write: 'todo' };
    const toolIcons = { bash: 'terminal', pwsh: 'terminal', read: 'file', edit: 'edit', write: 'file-plus', web_search: 'globe', web_fetch: 'globe', ask_user_question: 'chat', subagent: 'agent', todo_write: 'jobs', glob: 'search', grep: 'search', skill: 'skill', present: 'present', job_list: 'jobs', job_output: 'jobs', job_kill: 'jobs', subagent_fork: 'agent', list_mcp_resources: 'cloud', list_mcp_resource_templates: 'cloud', read_mcp_resource: 'cloud', load_workspace_dependencies: 'dependencies', list_subagent_models: 'model-search', list_agents: 'agent', send_message: 'message-route', interrupt_agent: 'pause', wait: 'hourglass', wait_agent: 'hourglass', team_task_create: 'plus', team_task_get: 'eye', team_task_list: 'jobs', team_task_update: 'edit', set_working_directory: 'folder-arrow', get_working_directory: 'folder-arrow', working_directory: 'folder-arrow', str_replace_editor: 'edit', workflow: 'workflow', apply_patch: 'patch', cordis_inspect_list: 'catalog', cordis_inspect_query: 'search', get_goal: 'jobs', create_goal: 'plus', update_goal: 'edit', read_image: 'file', schedule_create: 'plus', schedule_list: 'jobs', schedule_view: 'eye', schedule_edit: 'edit', session_search: 'search', session_event_search: 'search', session_trace: 'workflow', session_event_trace: 'workflow', session_event_read: 'file' };
    Object.assign(toolIcons, { office_convert: 'file-convert', office_recalculate: 'calculator', office_render: 'file-render' });
    const equal = (a, b) => a === b || Boolean(a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key])));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const staticCopy = {
      '预设工坊': 'Preset Workshop', '让您的每一个 Agent 都有自己的工作方式。': 'Give each of your Agents its own way of working.',
      '导入': 'Import', '导出': 'Export', '预设方案': 'Presets', '已保存': 'Saved', '预设 ID': 'Preset ID', '提示词': 'Prompts',
      '新建': 'New', '重命名': 'Rename', '启用': 'Enabled', '删除': 'Delete', '描述': 'Description',
      '回退目标': 'Fallback preset', '恢复默认': 'Reset', '保存方案': 'Save preset', '系统提示词': 'System prompt',
      '扫描': 'Scan', '自动扫描': 'Auto scan', '上次扫描：': 'Last scan: ', '尚未扫描': 'Not scanned yet',
      '每': 'Every', '秒': 'seconds', '人设': 'Persona', '变量': 'Variables', '只读 · 实际值': 'Read only · Actual values',
      '拼接': 'Supplemental instructions', '宿主': 'Host', '宿主说明': 'About the host', '取消': 'Cancel', '保存': 'Save', '工具': 'Tools', '内置': 'Built in',
      '可选': 'Optional', '官方': 'Official', '第三方': 'Third party', '同名': 'Same-name', '工具说明随开关同步更新': 'Tool instructions follow tool visibility',
      '技能绑定': 'Skills', '技能': 'Skills', '未绑定技能': 'No skills selected', '未选择技能': 'No skills selected', '检测到的技能': 'Discovered skills', '全开': 'Select all', '全不开': 'Clear all', 'MCP服务': 'MCP services', '未发现 MCP 服务': 'No MCP services detected', '新建 MCP 服务器': 'New MCP server', '添加 MCP': 'Add MCP',
      '绑定技能时同步开启 skill 工具；若未开启 skill 工具，User段SKILL不会进入上下文，可能会出现AI不自主选择技能使用；手动给出技能路径不受影响': 'Selecting skills also enables the skill tool. If it is off, the User SKILL catalog is omitted and AI may not select skills on its own. Providing a skill path manually still works.',
      '绑定技能时同步开启 skill 工具': 'Selecting skills also enables the skill tool', '若未开启 skill 工具，User 段 SKILL 不会进入上下文，会出现 AI 不主动选择技能': 'Without the skill tool, the User SKILL catalog is omitted and AI may not select skills on its own', '手动给出技能路径不受影响': 'Providing a skill path manually still works.',
      '部分插件注入的提示词未向 DSH 暴露读取或覆盖接口，此层不包含在工坊预览中。但实际仍会进入上下文': 'Some plugins inject prompts without a DSH read or override interface. Those prompts are outside this preview but still enter the context.',
      '预览': 'Preview', '查看': 'View', '查看预览': 'View preview', '展开预览': 'Expand preview', '预览环境': 'Preview context', '工作目录': 'Working directory',
      '工具与技能': 'Tools and skills', '最终提示词': 'Final prompt', '复制提示词': 'Copy prompt', '兼容': 'Compatibility', '兼容内容': 'Compatibility content', '已安装': 'Installed', '发现': 'Discovered', '外部 Agent 预设': 'External Agent presets', '计划中': 'Planned',
      '当前预设的实际组成与请求上下文估算': 'Preset composition and request context estimate', '预留兼容入口。后续制定统一标准与暴露接口，让 Claude Code、Codex 等 Agent 预设可在 DSH 中独立展示和使用。': 'Reserved for external presets. A shared format and API are needed before Claude Code, Codex and other Agent presets can be listed and used independently in DSH.', '尚未发现外部 Agent 预设。': 'No external Agent presets found.',
      '工具仅展示顶层描述；工作目录等环境、AGENTS 和技能目录通过 User 消息注入。预览不含实际对话历史；token 为字符数估算。': 'Tools show top-level descriptions. Environment (including working directory), AGENTS and skills enter as User messages. Conversation history is omitted; tokens are character-based estimates.',
      '请确保您了解 AI 与提示词的机制，否则请不要修改系统提示词与工具描述；您的任何修改导致的后果由您个人承担。': 'Only edit system prompts and tool descriptions if you understand their effect on AI behavior. You are responsible for the consequences of your changes.',
      '停用或删除预设时，引用它的会话将回退到此预设。会话的消息历史不会改变。': 'Sessions referencing a disabled or deleted preset fall back to this preset. Message history is preserved.',
      '在提示词中写入 {{provider}}、{{model}} 或 {{cwd}}，将替换为当前会话的实际值。变量只读，无需在此编辑。': 'Use {{provider}}, {{model}} or {{cwd}} to insert actual values. Variables are read only.',
      '描述这个预设的用途…': 'Describe what this preset is for…', '关闭弹窗': 'Close dialog',
      '创建后不可修改，可选择复制': 'Immutable after creation; select to copy', '预设 ID（创建后不可修改）': 'Preset ID (immutable)',
      '当前预设': 'Current preset', '选择预设': 'Choose preset', '启用预设': 'Enable preset', '预设描述': 'Preset description', '内置预设不可删除': 'The built-in preset cannot be deleted', '预览内容': 'Preview content',
      '保存后用作 Agent 预设卡片的描述': 'Shown on the Agent preset card after saving',
      '扫描工具、插件注入提示词和技能': 'Scan tools, injected prompt sections and skills',
      '自动扫描间隔': 'Auto scan interval', '人设提示词': 'Persona prompt', '回退目标说明': 'About the fallback preset',
      '第三方仅列出宿主实际注册的工具；源插件中关闭的工具需先在该插件启用。': 'Third-party tools must be registered by the host. Tools disabled at the source must first be enabled in their own plugin.',
      '同名工具说明': 'About same-name tools', '当出现同名工具，但工具描述不同时，本层会显示；本层最多同时显示2个工具，若您想启用其他同名工具，可调整工具来源插件的顺序或关闭其插件。': 'Tools with the same name and different descriptions appear here, with up to two alternatives. To use another source, reorder or disable its source plugins.',
      '变量说明': 'About variables', '可用变量': 'Available variables', '预览工作目录': 'Preview working directory',
      '使用宿主已注册的 {{变量名}}，请求时替换为实际值。$ENV 形式不会自动替换。': 'Use host-registered {{variable_name}} references to insert actual values at request time. $ENV references are not interpolated.',
      '新建内容': 'New content',
      '快照': 'Snapshots', '分组': 'Group', '技能分组': 'Skill groups', '开启快照': 'Enable snapshots', '快照说明': 'About snapshots', '保存份数': 'Snapshots per preset', '份数限制': 'Snapshot limit', '份数限制：1-9': 'Limit: 1–9', '减少保存份数': 'Decrease limit', '增加保存份数': 'Increase limit', '版本记录': 'Version history', '选择有快照的预设': 'Choose a preset with snapshots', '有快照的预设': 'Presets with snapshots',
      '开启后，保存预设方案或恢复默认时保存上个版本；关闭时不自动保存。已有快照仍可查看和还原。': 'When enabled, saving or resetting a preset keeps its previous version. Existing snapshots remain available when disabled.',
      '列表可滚动；到达边缘后继续滚动页面。': 'Scroll the list; scrolling continues through the page at its edges.',
    };

    async function mount(root, ctx, signal) {
      let english = ctx.locale.getSnapshot().active?.startsWith('en') ?? false;
      const t = (zh, en) => english ? en : zh;
      const globalAgentDescription = () => t('官方全局 AGENTS.md · 仅覆盖当前预设，保留项目与子目录指令，不修改原文件。', 'Official global AGENTS.md · Overrides only this preset; project and subdirectory instructions remain active, and the source file is unchanged.');
      const directoryAgentDescription = () => t('项目级 AGENTS.md，请在对应目录进行修改', 'Project AGENTS.md; edit it in the corresponding directory.');
      const request = async (action, input = {}) => {
        const response = await fetch('/preset-workshop/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, action }), signal });
        const data = await response.json();
        if (!response.ok) throw Object.assign(Error(data.detail || data.error), { code: data.error, details: data });
        return data;
      };
      const style = document.createElement('style'); style.textContent = css;
      root.innerHTML = html; root.prepend(style);
      const main = root.querySelector('.main');
      main.inert = true; main.setAttribute('aria-busy', 'true');
      const copyNodes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, text = node.textContent.trim();
        if (staticCopy[text]) copyNodes.push([node, text]);
      }
      const copyAttrs = [];
      root.querySelectorAll('[title],[aria-label],[placeholder]').forEach(el => {
        for (const key of ['title', 'aria-label', 'placeholder']) { const text = el.getAttribute(key); if (staticCopy[text]) copyAttrs.push([el, key, text]); }
      });
      function localize() {
        copyNodes.forEach(([node, text]) => { node.textContent = t(text, staticCopy[text]); });
        copyAttrs.forEach(([el, key, text]) => el.setAttribute(key, t(text, staticCopy[text])));
      }
      localize();
      const initial = await request('snapshot');
      if (signal.aborted) return () => {};
      english = ctx.locale.getSnapshot().active?.startsWith('en') ?? false;
      if (/Win/i.test(navigator.userAgentData?.platform || navigator.platform || '')) root.host.classList.add('windows-platform');
      const $ = id => root.getElementById(id);
      // Inline symbol contents avoid document-wide fragment IDs in shadow DOM.
      const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${root.querySelector('#i-' + name)?.innerHTML || ''}</svg>`;
      root.querySelectorAll('svg:has(use)').forEach(svg => { const name = svg.querySelector('use').getAttribute('href').slice(3); svg.setAttribute('viewBox', '0 0 24 24'); svg.innerHTML = root.querySelector('#i-' + name)?.innerHTML || ''; });
      let collapseState = {};
      const collapseKey = 'dsh-preset-workshop:collapse:v1';
      try { collapseState = JSON.parse(localStorage.getItem(collapseKey) || '{}') || {}; } catch {}
      root.querySelectorAll('[data-ui-collapse]').forEach(details => {
        const key = details.dataset.uiCollapse;
        if (typeof collapseState[key] === 'boolean') details.open = collapseState[key];
        details.addEventListener('toggle', () => { collapseState[key] = details.open; try { localStorage.setItem(collapseKey, JSON.stringify(collapseState)); } catch {} });
      });
      let state = initial, base, draft, preview, sourceSkills = [], completeSkills = true, busy = false, dialogPending = false;
      let timer, previewTimer, toastTimer, previewVersion = 0, submit, dragged, sessionId = ctx.get?.('uiSession')?.current.getSnapshot().key || '', cwd = '', previewQueue = Promise.resolve();
      let closePolicy = 'normal', dialogEdited = false, skillGroupId = 'all', historyPresetId = '', selectedSnapshotId = '';
      let historyDetail;
      const selected = () => state.presets.find(p => p.id === state.config.selectedPresetId) || state.presets[0];
      const dirty = () => !equal(draft, base);
      const context = () => ({ ...(sessionId ? { sessionId } : cwd ? { cwd } : {}), language: english ? 'en' : 'zh' });
      const scrollTimers = new Map();
      function onScroll(event) { const el = event.target; if (!el.classList) return; el.classList.add('is-scrolling'); clearTimeout(scrollTimers.get(el)); scrollTimers.set(el, setTimeout(() => { el.classList.remove('is-scrolling'); scrollTimers.delete(el); }, 800)); }
      root.addEventListener('scroll', onScroll, true);
      root.addEventListener('pointermove', event => {
        const el = event.target.closest('.choice-name,.id-field output');
        if (!el || el.scrollWidth <= el.clientWidth) return;
        const rect = el.getBoundingClientRect();
        el.scrollLeft = (el.scrollWidth - el.clientWidth) * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      });
      const report = error => { if (signal.aborted) return; $('operation-error').textContent = error.message; };
      function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3400); }
      async function run(task) {
        if (busy || signal.aborted) return false;
        busy = true; $('operation-error').textContent = ''; $('save-state').textContent = t('处理中…', 'Working…');
        root.querySelector('.main').inert = true;
        try { return await task(); } catch (error) { report(error); return false; }
        finally { busy = false; root.querySelector('.main').inert = false; status(); }
      }
      function status() {
        if (!draft) return;
        const changed = dirty(); $('save-state').classList.toggle('dirty', changed);
        $('save-state').innerHTML = (changed ? icon('edit') : '<span class="status-dot"></span>') + t(changed ? '有未保存修改' : '已保存', changed ? 'Unsaved changes' : 'Saved');
        $('persona-count').textContent = t(`${draft.prompt.persona.length.toLocaleString()} 字符`, `${draft.prompt.persona.length.toLocaleString()} characters`);
        const activeTools = preview?.tools.filter(tool => !tool.function.name.startsWith('mcp__')).length ?? draft.tools.enabled.filter(name => !name.startsWith('mcp__')).length;
        $('tools-count').textContent = t(`已启动 ${activeTools} 个工具`, `${activeTools} tools started`);
        $('skills-summary').textContent = draft.skills.length ? t(`已选择 ${draft.skills.length} 个技能`, `${draft.skills.length} skills selected`) : t('未选择技能', 'No skills selected');
      }
      const choice = p => `<span class="choice-name">${esc(p.name)}</span>${p.builtin ? `<span class="pill">${t('内置', 'Built in')}</span>` : !p.enabled ? `<span class="pill neutral-pill">${t('已停用', 'Disabled')}</span>` : ''}`;
      function pickers() {
        for (const [kind, id] of [['preset', draft.id], ['fallback', state.config.fallbackPresetId]]) {
          const all = state.presets.filter(p => kind === 'preset' || p.enabled), current = all.find(p => p.id === id) || all[0];
          $(kind + '-select').innerHTML = choice(current) + icon('down');
          $(kind + '-menu').innerHTML = all.map(p => `<button class="select-option" type="button" role="option" aria-selected="${p.id === current.id}" data-${kind}-value="${esc(p.id)}">${choice(p)}<span class="choice-check">${p.id === current.id ? icon('tick') : ''}</span></button>`).join('');
        }
      }
      function closePickers() { root.querySelectorAll('.select-card[open]').forEach(el => { el.open = false; }); }
      function scanStatus() {
        $('auto-scan').checked = state.config.polling; $('interval-field').hidden = !state.config.polling; $('scan-interval').value = state.config.scanInterval;
        const at = state.catalog.scannedAt, count = state.catalog.tools.filter(tool => tool.available && tool.kind !== 'mcp').length;
        $('tools-discovered-count').textContent = t(`发现 ${count} 个工具`, `${count} tools discovered`);
        $('scan-time').textContent = at ? new Date(at).toLocaleString(english ? 'en-US' : 'zh-CN', { hour12: false }) : t('尚未扫描', 'Not scanned yet');
        $('scan-time').dateTime = at || '';
        $('scan-summary').textContent = scanSentence();
      }
      function scanCounts() {
        const counts = state.catalog.counts || {};
        return { promptSections: counts.promptSections ?? 0, tools: counts.tools ?? state.catalog.tools.filter(tool => tool.available && tool.kind !== 'mcp').length, mcpServers: counts.mcpServers ?? 0, mcpTools: counts.mcpTools ?? 0, skills: counts.skills ?? 0, presets: 0, complete: counts.complete !== false };
      }
      function scanSentence(skipEmpty = false) {
        const counts = scanCounts();
        const items = [['promptSections', `${counts.promptSections} ${t('个提示词段', 'prompt sections')}`], ['tools', `${counts.tools} ${t('个工具', 'tools')}`], ['mcpServers', t(`${counts.mcpServers} 个MCP（${counts.mcpTools} 个工具）`, `${counts.mcpServers} MCP (${counts.mcpTools} tools)`)], ['skills', `${counts.skills} ${t('个技能', 'skills')}`], ['presets', `${counts.presets} ${t('个预设', 'presets')}`]].filter(([key]) => !skipEmpty || counts[key] > 0).map(([, value]) => value);
        return t('扫描完成：', 'Scan complete: ') + (items.length ? items.join(t('、', ', ')) : t('未发现可用内容', 'nothing detected')) + (counts.complete ? t('。', '.') : t('（技能扫描未完整）。', ' (skill discovery incomplete).'));
      }
