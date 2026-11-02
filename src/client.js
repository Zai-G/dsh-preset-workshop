// Native DSH client module; React is supplied by the host. No build step.
window.__ModuleLoader__.load({
  id: 'dsh-preset-workshop',
  factory: require => {
    const React = require('react');
    const NS = 'preset-workshop';
    const BUILTINS = ['bash', 'read', 'edit', 'write', 'web_search', 'web_fetch', 'ask_user_question', 'todo_write'];
    const AGENT = 'workshop:agent-instructions';
    const DIRECTORY_AGENT = 'workshop:directory-instructions';
    const USER_DIRECTORY = 'workshop:user-directory';
    const names = { ask_user_question: 'ask', todo_write: 'todo' };
    const toolIcons = { bash: 'terminal', pwsh: 'terminal', read: 'file', edit: 'edit', write: 'file-plus', web_search: 'globe', web_fetch: 'globe', ask_user_question: 'chat', subagent: 'agent', todo_write: 'jobs', glob: 'search', grep: 'search', skill: 'skill', present: 'present', job_list: 'jobs', job_output: 'jobs', job_kill: 'jobs', subagent_fork: 'agent', list_mcp_resources: 'cloud', list_mcp_resource_templates: 'cloud', read_mcp_resource: 'cloud' };
    const clone = value => structuredClone(value);
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
      '可选': 'Optional', '官方': 'Official', '第三方': 'Third party', '工具说明随开关同步更新': 'Tool instructions follow tool visibility',
      '技能绑定': 'Skills', '技能': 'Skills', '未绑定技能': 'No skills selected', '未选择技能': 'No skills selected', '检测到的技能': 'Discovered skills', '全开': 'Select all', '全不开': 'Clear all', 'MCP服务': 'MCP services', '未发现 MCP 服务': 'No MCP services detected', '新建 MCP 服务器': 'New MCP server', '添加 MCP': 'Add MCP',
      '绑定技能时同步开启 skill 工具；若未开启 skill 工具，User段SKILL不会进入上下文，可能会出现AI不自主选择技能使用；手动给出技能路径不受影响': 'Selecting skills also enables the skill tool. If it is off, the User SKILL catalog is omitted and AI may not select skills on its own. Providing a skill path manually still works.',
      '绑定技能时同步开启 skill 工具': 'Selecting skills also enables the skill tool', '若未开启 skill 工具，User 段 SKILL 不会进入上下文，会出现 AI 不主动选择技能': 'Without the skill tool, the User SKILL catalog is omitted and AI may not select skills on its own', '手动给出技能路径不受影响': 'Providing a skill path manually still works.',
      '部分插件注入的提示词未向 DSH 暴露读取或覆盖接口，此层不包含在工坊预览中。但实际仍会进入上下文': 'Some plugins inject prompts without a DSH read or override interface. Those prompts are outside this preview but still enter the context.',
      '预览': 'Preview', '展开预览': 'Expand preview', '预览环境': 'Preview context', '工作目录': 'Working directory',
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
      '变量说明': 'About variables', '可用变量，可滚动查看': 'Available variables; scroll to view', '预览工作目录': 'Preview working directory',
      '使用宿主已注册的 {{变量名}}，请求时替换为实际值。$ENV 形式不会自动替换。': 'Use host-registered {{variable_name}} references to insert actual values at request time. $ENV references are not interpolated.',
      '新建内容': 'New content',
      '列表可滚动；到达边缘后继续滚动页面。': 'Scroll the list; scrolling continues through the page at its edges.',
    };

    async function mount(root, ctx, signal) {
      let english = ctx.locale.getSnapshot().active?.startsWith('en') ?? false;
      const t = (zh, en) => english ? en : zh;
      const globalAgentDescription = () => t('官方全局 AGENTS.md · 仅覆盖当前预设，保留项目与子目录指令，不修改原文件。', 'Official global AGENTS.md · Overrides only this preset; project and subdirectory instructions remain active, and the source file is unchanged.');
      const directoryAgentDescription = () => t('项目级 AGENTS.md，请在对应目录进行修改', 'Project AGENTS.md; edit it in the corresponding directory.');
      const textResponse = async file => {
        const response = await fetch('/preset-workshop/' + file, { signal });
        if (!response.ok) throw Error(t('界面资源加载失败。', 'Unable to load UI resources.'));
        return response.text();
      };
      const request = async (action, input = {}) => {
        const response = await fetch('/preset-workshop/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, action }), signal });
        const data = await response.json();
        if (!response.ok) throw Object.assign(Error(data.detail || data.error), { code: data.error, details: data });
        return data;
      };
      const [html, css, initial] = await Promise.all([textResponse('client.html'), textResponse('client.css'), request('snapshot')]);
      if (signal.aborted) return () => {};
      const style = document.createElement('style'); style.textContent = css;
      root.innerHTML = html; root.prepend(style);
      const $ = id => root.getElementById(id);
      // Inline symbol contents avoid document-wide fragment IDs in shadow DOM.
      const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${root.querySelector('#i-' + name)?.innerHTML || ''}</svg>`;
      root.querySelectorAll('svg:has(use)').forEach(svg => { const name = svg.querySelector('use').getAttribute('href').slice(3); svg.setAttribute('viewBox', '0 0 24 24'); svg.innerHTML = root.querySelector('#i-' + name)?.innerHTML || ''; });
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
        const items = [['promptSections', `${counts.promptSections} ${t('个提示词段', 'prompt sections')}`], ['tools', `${counts.tools} ${t('个工具', 'tools')}`], ['mcpServers', `${counts.mcpServers} 个MCP（${counts.mcpTools} 个工具）`], ['skills', `${counts.skills} ${t('个技能', 'skills')}`], ['presets', `${counts.presets} ${t('个预设', 'presets')}`]].filter(([key]) => !skipEmpty || counts[key] > 0).map(([, value]) => value);
        return t('扫描完成：', 'Scan complete: ') + (items.length ? items.join(t('、', ', ')) : t('未发现可用内容', 'nothing detected')) + (counts.complete ? t('。', '.') : t('（技能扫描未完整）。', ' (skill discovery incomplete).'));
      }
      function toolEnabled(tool) { return tool.light === false ? draft.tools.packages.includes(tool.package) : draft.tools.enabled.includes(tool.name); }
      function toolCard(tool) {
        const toolIcon = tool.kind === 'mcp' ? 'box' : toolIcons[tool.name] || 'box';
        const unavailable = tool.unavailable || !tool.available;
        return `<div class="tool-card${toolEnabled(tool) ? '' : ' off'}">${icon(toolIcon)}<div class="tool-info"><div class="tool-name" title="${esc(tool.name)}">${esc(names[tool.name] || tool.name)}</div>${tool.schema ? `<button class="text-button" data-description="${esc(tool.name)}">${t('工具描述', 'Description')} ${icon('chevron')}</button>` : ''}${unavailable ? `<span class="unavailable">${t('不可用', 'Unavailable')}</span>` : ''}</div><label class="switch"><input type="checkbox" data-tool="${esc(tool.name)}" aria-label="${esc(t('启用 ', 'Enable ') + tool.name)}" ${toolEnabled(tool) ? 'checked' : ''} ${tool.serverDisabled || !tool.available && !tool.unavailable ? 'disabled' : ''}><span class="track"></span></label></div>`;
      }
      const toolSource = name => preview?.catalog.find(tool => tool.name === name) || state.catalog.tools.find(tool => tool.name === name);
      function fitToolLists() {
        for (const id of ['official-tools', 'thirdparty-tools']) {
          const list = $(id), cards = [...list.querySelectorAll(':scope > .tool-card')];
          if (!list.offsetParent) continue;
          list.classList.toggle('is-capped', cards.length > 8);
          if (cards.length <= 8 || !cards[8].getBoundingClientRect().height) { list.style.maxHeight = 'none'; continue; }
          const gap = parseFloat(getComputedStyle(list).rowGap) || 8;
          const top = card => Math.round(card.getBoundingClientRect().top);
          const rowTops = [...new Set(cards.map(top))], ninthRow = rowTops.indexOf(top(cards[8]));
          const rowHeight = index => Math.max(...cards.filter(card => top(card) === rowTops[index]).map(card => card.getBoundingClientRect().height));
          let maxHeight = rowHeight(ninthRow) / 2;
          for (let index = 0; index < ninthRow; index += 1) maxHeight += rowHeight(index) + gap;
          list.style.maxHeight = `${maxHeight}px`;
        }
      }
      function tools() {
        const officialScroll = $('official-tools').scrollTop, thirdScroll = $('thirdparty-tools').scrollTop;
        const all = state.catalog.tools.map(tool => toolSource(tool.name)).filter(Boolean), builtinNames = [all.some(tool => tool.name === 'pwsh' && tool.available) && !all.some(tool => tool.name === 'bash' && tool.available) ? 'pwsh' : 'bash', ...BUILTINS.slice(1)], visible = all.filter(tool => tool.kind !== 'mcp'), official = visible.filter(tool => !builtinNames.includes(tool.name) && tool.kind !== 'thirdparty'), third = visible.filter(tool => !builtinNames.includes(tool.name) && tool.kind === 'thirdparty');
        const builtinMarkup = builtinNames.map(name => all.find(tool => tool.name === name)).filter(Boolean).map(toolCard).join('');
        if ($('builtin-tools').innerHTML !== builtinMarkup) $('builtin-tools').innerHTML = builtinMarkup;
        const undiscovered = state.catalog.packages.filter(pkg => !pkg.light && !all.some(tool => tool.package === pkg.name));
        const officialMarkup = official.map(toolCard).join('') + undiscovered.map(pkg => `<div class="tool-card${draft.tools.packages.includes(pkg.name) ? '' : ' off'}">${icon('box')}<div class="tool-info"><div class="tool-name" title="${esc(pkg.name)}">${esc(pkg.name.replace('@deepseek-ai/dsh-tool-', ''))}</div><small class="${pkg.error ? 'unavailable' : 'muted'}">${esc(pkg.error || t('启用后检测工具', 'Discover tools on enable'))}</small></div><label class="switch"><input type="checkbox" data-package="${esc(pkg.name)}" aria-label="${esc(t('启用 ', 'Enable ') + pkg.name)}" ${draft.tools.packages.includes(pkg.name) ? 'checked' : ''} ${!pkg.available || pkg.error ? 'disabled' : ''}><span class="track"></span></label></div>`).join('');
        if ($('official-tools').innerHTML !== officialMarkup) $('official-tools').innerHTML = officialMarkup;
        $('thirdparty-tools').className = third.length ? 'tools-grid bounded-list' : 'bounded-list';
        const thirdMarkup = third.length ? third.map(toolCard).join('') : `<div class="empty-state">${icon('box')}<span>${t('未发现第三方工具', 'No third-party tools detected')}</span></div>`;
        if ($('thirdparty-tools').innerHTML !== thirdMarkup) $('thirdparty-tools').innerHTML = thirdMarkup;
        requestAnimationFrame(() => { $('official-tools').scrollTop = officialScroll; $('thirdparty-tools').scrollTop = thirdScroll; fitToolLists(); });
      }
      function mcp() {
        const list = $('mcp-list'), scrollTop = list.scrollTop, expanded = new Set([...list.querySelectorAll('.mcp-server[open]')].map(server => server.dataset.serverName)), toolScroll = new Map([...list.querySelectorAll('.mcp-server')].map(server => [server.dataset.serverName, server.querySelector('.mcp-tools')?.scrollTop ?? 0]));
        const rows = [...(preview?.mcp || [])].sort((a, b) => (a.source === 'preset') - (b.source === 'preset'));
        $('mcp-summary').textContent = rows.length ? t(`${rows.length} 个 MCP 服务`, `${rows.length} MCP services`) : t('未发现 MCP 服务', 'No MCP services detected');
        $('mcp-list').innerHTML = rows.length ? rows.map(server => {
          const selected = server.tools.filter(tool => draft.tools.enabled.includes(tool.function?.name ?? tool.name)).length;
          const label = server.source === 'unknown' ? t('来源未识别', 'Unidentified source') : (server.serverName || t('未知服务', 'Unknown service'));
          const enabled = server.source === 'preset' ? (draft.mcp || []).find(item => item.serverName === server.serverName)?.enabled !== false : draft.mcpEnabled?.[server.serverName] !== false;
          const lock = selected > 0, unknown = server.source === 'unknown';
          const connection = server.connection?.state, connectionLabel = !enabled ? t('已关闭', 'Disabled') : connection === 'connecting' ? t('连接中…', 'Connecting…') : connection === 'timeout' ? t('连接超时', 'Connection timed out') : connection === 'error' ? t('连接失败，请检查配置', 'Connection failed; check configuration') : connection === 'unsaved' ? t('保存后连接', 'Connects after saving') : `${selected}/${server.tools.length}`;
          const actions = `<div class="mcp-service-controls"><button type="button" class="text-button" data-mcp-preview="${esc(server.serverName)}">${icon('eye')}${t('预览', 'Preview')}</button>${server.source === 'preset' ? `<span class="mcp-actions"><button type="button" class="icon-button ghost" data-mcp-edit="${esc(server.serverName)}" aria-label="${esc(t('编辑 MCP 服务', 'Edit MCP service'))}" title="${esc(t('编辑', 'Edit'))}">${icon('edit')}</button><button type="button" class="icon-button ghost danger" data-mcp-delete="${esc(server.serverName)}" aria-label="${esc(t('删除 MCP 服务', 'Delete MCP service'))}" title="${esc(t('删除', 'Delete'))}">${icon('trash')}</button></span>` : ''}${!unknown ? `<label class="switch" title="${esc(lock ? t('先关闭该服务的全部工具，才能切换服务开关。', 'Disable all tools from this service before switching it.') : t('仅影响当前预设', 'Affects this preset only'))}"><input type="checkbox" data-mcp-enabled="${esc(server.serverName)}" aria-label="${esc(t('启用 MCP：', 'Enable MCP: ') + label)}" ${enabled ? 'checked' : ''} ${lock ? 'disabled' : ''}><span class="track"></span></label>` : ''}</div>`;
          return `<details class="mcp-server${enabled ? '' : ' off'}" data-server-name="${esc(server.serverName)}"><summary><span>${esc(label)}</span><small class="muted">${server.source === 'preset' ? t('当前工具', 'Current tool') : unknown ? t('未识别', 'Unidentified') : t('环境', 'Environment')} · ${esc(connectionLabel)}</small><svg class="icon chevron"><use href="#i-chevron"/></svg></summary>${actions}<div class="mcp-tools">${server.tools.length ? server.tools.map(tool => { const schema = tool.function ? tool : { type: 'function', function: tool }, definition = schema.function; return toolCard({ name: definition.name, kind: 'mcp', mcpServer: server.serverName, available: enabled, serverDisabled: !enabled, unavailable: Boolean(definition.unavailable), light: true, schema: definition.unavailable ? undefined : schema }); }).join('') : `<span class="muted">${t(enabled ? '尚未发现工具，可在预览中检测。' : '开启服务后检测工具。', enabled ? 'No tools yet; detect them in Preview.' : 'Enable the service to detect tools.')}</span>`}</div></details>`;
        }).join('') : `<div class="empty-state">${icon('cloud')}<span>${t('扫描后会显示全局 MCP；新建的 MCP 仅属于当前预设。', 'Global MCP services appear after scanning. New services belong only to this preset.')}</span></div>`;
        for (const server of list.querySelectorAll('.mcp-server')) { server.open = expanded.has(server.dataset.serverName); server.querySelector('.mcp-tools').scrollTop = toolScroll.get(server.dataset.serverName) ?? 0; }
        list.scrollTop = scrollTop;
      }
      function skills() {
        const all = [...sourceSkills];
        for (const name of draft.skills) if (!all.some(skill => skill.name === name)) all.push({ name, description: t('未在当前目录发现；保存的绑定仍保留。', 'Not found in this directory; the saved selection is preserved.') });
        $('skill-list').innerHTML = all.length ? all.map(skill => `<div class="skill-row${draft.skills.includes(skill.name) ? '' : ' off'}">${icon('skill')}<div class="skill-copy"><p>${esc(skill.name)}</p><small class="skill-description" title="${esc(skill.description)}">${esc(skill.description)}</small><button type="button" class="text-button" data-skill-detail="${esc(skill.name)}">${t('查看详细', 'View details')} ${icon('chevron')}</button></div><label class="switch"><input type="checkbox" data-skill="${esc(skill.name)}" aria-label="${esc(t('绑定 ', 'Select ') + skill.name)}" ${draft.skills.includes(skill.name) ? 'checked' : ''}><span class="track"></span></label></div>`).join('') : `<div class="empty-state">${icon('skill')}<span>${t('未发现技能', 'No skills detected')}</span></div>`;
        if (preview?.skillWarnings?.length) $('skill-list').insertAdjacentHTML('beforeend', `<p class="unavailable">${esc(t('以下绑定尚未进入 AI 上下文，请检查来源后重试：', 'These selected skills could not enter the AI context; check their sources and retry: ') + preview.skillWarnings.join('、'))}</p>`);
        if (!completeSkills) $('skill-list').insertAdjacentHTML('beforeend', `<p class="unavailable">${t('技能目录扫描尚未完整，现有选择已保留。', 'Skill discovery is incomplete. Existing selections are preserved.')}</p>`);
        const allSelected = all.length > 0 && all.every(skill => draft.skills.includes(skill.name));
        $('skills-all').textContent = t(allSelected ? '全不选' : '全选', allSelected ? 'Deselect all' : 'Select all');
      }
      function supplemental() {
        const actual = (preview?.editableSections || []).filter(section => section.role !== 'user' && section.managedBy !== 'tools' && (!section.name.startsWith('mcp:') || section.text?.trim()));
        const items = actual.filter(section => !section.custom || draft.prompt.sections[section.name]).map(section => {
          const edit = draft.prompt.sections[section.name];
          return { ...section, ...(section.managedBy === 'tool-guidance' ? edit ? { order: edit.order, enabled: edit.enabled } : {} : edit || {}), ...(section.name === 'mcp-resource-servers' ? { text: section.text } : {}) };
        });
        for (const [name, section] of Object.entries(draft.prompt.sections)) if (section.custom && !items.some(item => item.name === name)) items.push({ name, ...section });
        return items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      }
      const labels = { 'context:file-reference': t('文件引用', 'File references'), 'mcp-resource-servers': t('MCP资源服务器', 'MCP resource servers'), 'ui:deliverable-file-references': t('交付文件引用', 'Deliverable file references'), 'harness:source': t('宿主来源', 'Host source'), 'app:web-surface': t('网页界面', 'Web surface'), 'deployment:persona-suffix': t('补充指令', 'Supplemental instructions'), 'workshop:user-runtime': t('环境', 'Environment'), 'workshop:user-skill': t('技能目录', 'Skill catalog') };
      const sectionName = section => section.name === 'time-context' ? t('时间与时区', 'Time and time zone') : section.name === 'prompt-manager-catalog' ? t('提示词管理（会话实况）', 'Prompt manager (session context)') : section.name.startsWith('mcp:') ? t(`MCP：${section.name.slice(4)}`, `MCP: ${section.name.slice(4)}`) : section.name === 'workshop:tool-guidance' ? t('工具使用指令', 'Tool usage guidance') : labels[section.name] || section.name.replace(/\.md$/i, '');
      function sections() {
        const items = supplemental(), agent = preview?.agentInstructions;
        const row = (section, options = {}) => {
          const directory = options.directory || section.name === DIRECTORY_AGENT, guidance = section.managedBy === 'tool-guidance', isAgent = options.agent;
          const name = isAgent ? t('AGENTS「全局」', 'AGENTS (Global)') : directory ? t('AGENTS「目录」', 'AGENTS (Directory)') : sectionName(section), editable = isAgent ? agent.editable : section.editable !== false && !directory, reorderable = !directory && section.reorderable !== false;
          const source = section.custom ? t('自定义', 'Custom') : guidance ? t('随启用工具动态更新', 'Updates with enabled tools') : '';
          return `<div class="detected-row${dragged === section.name ? ' is-dragging' : ''}${section.enabled === false ? ' off' : ''}" data-section-id="${esc(section.name)}" data-order="${section.order ?? 0}" ${section.custom ? 'data-custom="true"' : ''} ${section.role ? `data-role="${section.role}"` : ''} ${reorderable ? `data-drag-section="${esc(section.name)}"` : ''}><div class="detected-source">${reorderable ? `<button type="button" class="drag-handle" draggable="true" title="${t('拖动排序；方向键可上移或下移', 'Drag to reorder; arrow keys move up or down')}" aria-label="${esc(t('调整顺序：', 'Reorder: ') + name)}">${icon('grip')}</button>` : icon('file')}<div class="detected-label"><span class="detected-name">${esc(name)}</span>${source ? `<small class="source-note">${esc(source)}</small>` : ''}</div></div><div class="actions">${section.text !== undefined ? `<button type="button" class="section-action" data-section-preview="${esc(section.name)}">${icon('eye')}${t('预览', 'Preview')}</button>` : ''}${editable ? `<button type="button" class="section-action" data-section-edit="${esc(section.name)}">${icon('edit')}${t('编辑', 'Edit')}</button>` : ''}${editable || section.toggleable ? `<label class="switch"><input type="checkbox" data-section-enabled="${esc(section.name)}" aria-label="${esc(t('启用 ', 'Enable ') + name)}" ${section.enabled ? 'checked' : ''}><span class="track"></span></label>` : ''}</div></div>`;
        };
        const system = items.filter(section => ![AGENT, DIRECTORY_AGENT].includes(section.name));
        const saved = name => draft.prompt.sections[name] || {};
        const user = [
          ...(preview?.runtimeContextWorkingDirectory ? [{ name: 'workshop:user-cwd', text: preview.runtimeContextWorkingDirectory }] : []),
          ...((preview?.runtimeContextSource || preview?.runtimeContext) ? [{ name: 'workshop:user-runtime', text: preview.runtimeContextEnvironmentSource, enabled: saved('workshop:user-runtime').enabled !== false, order: 0, toggleable: true, editable: false, reorderable: false }] : []),
          ...(preview?.skillPrompt ? [{ name: 'workshop:user-skill', text: preview.skillPrompt, editable: false, reorderable: false, order: 100 }] : []),
          ...(preview?.userSections || []).filter(section => section.name === 'time-context').map(section => ({ ...section, ...saved(section.name), order: 200, reorderable: false })),
          ...(preview?.userSections || []).filter(section => section.name !== 'time-context').map(section => ({ ...section, reorderable: false })),
          ...(agent ? [{ ...agent, ...saved(AGENT), name: AGENT, order: 300, reorderable: false }] : []),
          ...Object.entries(draft.prompt.sections).filter(([, section]) => section.custom && section.role === 'user').map(([name, section]) => ({ name, ...section, reorderable: false })),
          ...(agent?.directoryText ? [{ name: USER_DIRECTORY, text: agent.directoryText, enabled: saved(USER_DIRECTORY).enabled !== false, toggleable: true, editable: false, reorderable: false }] : []),
        ];
        const userRow = section => section.name === 'workshop:user-cwd' ? `<div class="detected-row" data-section-id="${section.name}"><div class="detected-source">${icon('file')}<div class="detected-label"><span class="detected-name">${t('工作目录', 'Working directory')}</span></div></div><div class="actions"><button type="button" class="section-action" data-section-preview="${section.name}">${icon('eye')}${t('预览', 'Preview')}</button></div></div>` : row(section, { agent: section.name === AGENT, directory: section.name === USER_DIRECTORY || section.name === DIRECTORY_AGENT });
        $('section-list').innerHTML = `<div class="section-level"><h4>System</h4>${system.map(section => row(section)).join('') || `<div class="empty-state">${icon('box')}<span>${t('未发现 System 内容', 'No System content detected')}</span></div>`}</div><div class="section-level user-level"><h4>User</h4>${user.map(userRow).join('') || `<div class="empty-state">${icon('box')}<span>${t('暂无 User 级上下文', 'No User context')}</span></div>`}</div>`;
      }
      function renderPreview() {
        if (!preview) return;
        const mcpRows = preview.mcp || [];
        const enabledMcp = mcpRows.length ? mcpRows.filter(server => server.source !== 'unknown' && (server.source === 'preset' ? (draft.mcp || []).find(item => item.serverName === server.serverName)?.enabled !== false : draft.mcpEnabled?.[server.serverName] !== false)).length : (draft.mcp || []).filter(server => server.enabled !== false).length + Object.values(draft.mcpEnabled || {}).filter(enabled => enabled !== false).length;
        const tokenRange = preview.estimatedTokenRange || { min: preview.estimatedTokens, max: preview.estimatedTokens };
        const summary = t(`${preview.tools.length} 个工具 · ${enabledMcp} 个MCP · ${preview.skills.length} 个技能 · 约 ${tokenRange.min.toLocaleString()}–${tokenRange.max.toLocaleString()} token`, `${preview.tools.length} tools · ${enabledMcp} MCP · ${preview.skills.length} skills · ~${tokenRange.min.toLocaleString()}–${tokenRange.max.toLocaleString()} tokens`);
        $('preview-summary').textContent = summary;
        $('preview-dialog-summary').textContent = summary;
        $('preview-open').disabled = false;
        const visibleTools = preview.tools.filter(tool => !tool.function.name.startsWith('mcp__'));
        const mcpTools = preview.tools.filter(tool => tool.function.name.startsWith('mcp__'));
        const fragment = (label, text, kind = '') => text ? `<section class="prompt-fragment ${kind}"><h4>${esc(label)}</h4><div class="prompt-fragment-body">${esc(text)}</div></section>` : '';
        const toolText = items => items.map(tool => `${tool.function.name}: ${tool.function.description}`).join('\n\n');
        const userSections = (preview.userSections || []).filter(section => section.text?.trim());
        const customUser = Object.entries(draft.prompt.sections).filter(([, section]) => section.custom && section.role === 'user' && section.enabled).map(([name, section]) => ({ name, text: section.text, order: section.order }));
        const workingDirectory = preview.runtimeContextWorkingDirectory || '';
        const environmentText = preview.runtimeContextEnvironment || '';
        const userParts = [
          fragment(t('用户消息', 'User message'), t('［用户第一句话 · 仅作占位，预设工坊不修改会话消息。］', '[First user message · Placeholder only; the preset workshop does not edit session messages.]'), 'message-fragment'),
          fragment(t('工作目录', 'Working directory'), workingDirectory, 'working-directory-fragment'),
          fragment(t('环境', 'Environment'), draft.prompt.sections['workshop:user-runtime']?.enabled === false ? '' : environmentText, 'environment-fragment'),
          fragment('SKILL', preview.skillPrompt, 'skill-fragment'),
          ...userSections.filter(section => section.enabled !== false).map(section => fragment(section.name === 'time-context' ? t('时间与时区', 'Time and time zone') : section.name === 'prompt-manager-catalog' ? t('提示词管理（会话实况）', 'Prompt manager (session context)') : section.name, section.text, section.name === 'time-context' ? 'time-fragment' : 'user-extra-fragment')),
          fragment(t('AGENTS「全局」', 'AGENTS (Global)'), preview.agentInstructions?.enabled ? preview.agentInstructions.renderedText : '', 'agent-fragment'),
          ...customUser.map(section => fragment(section.name, section.text, 'custom-fragment')),
          fragment(t('AGENTS「目录」', 'AGENTS (Directory)'), draft.prompt.sections[USER_DIRECTORY]?.enabled === false ? '' : preview.agentInstructions?.directoryText, 'agent-fragment'),
        ].filter(Boolean).join('');
        const toolParts = `${fragment('TOOL', toolText(visibleTools), 'tool-fragment')}${fragment('MCP', toolText(mcpTools), 'mcp-fragment')}`;
        $('preview-prompt').innerHTML = `<section class="prompt-major system-major"><h3>System</h3>${preview.prompt ? `<div class="prompt-major-content">${esc(preview.prompt)}</div>` : ''}</section><section class="prompt-major user-major"><h3>User</h3>${userParts}</section>${toolParts ? `<section class="prompt-major tool-major"><h3>${t('工具', 'Tools')}</h3>${toolParts}</section>` : ''}`;
        const pending = state.sessions.filter(session => session.preset === draft.id && session.pendingTools?.length), selectedPending = preview.runtime?.pendingTools || [];
        const pendingNames = [...new Set([...pending.flatMap(session => session.pendingTools), ...selectedPending])].filter(Boolean);
        $('runtime-note').hidden = !pending.length && !selectedPending.length;
        const restoreNotice = pendingNames.length
          ? t(`关闭并恢复会话后才能使用：${pendingNames.join('、')}。`, `Close and restore sessions to use: ${pendingNames.join(', ')}.`)
          : t('关闭并恢复相关会话后才能使用新增或替换的工具。', 'Close and restore the affected sessions to use newly added or replaced tools.');
        $('runtime-note').textContent = t(`预览为当前方案。${pending.length} 个已开始会话尚未挂载新增或替换工具；${restoreNotice}人设、已有工具过滤与描述、技能选择在下一次请求更新。`, `This preview shows the current preset. ${pending.length} started sessions have not mounted new or replaced tools; ${restoreNotice} Persona, existing-tool filters/descriptions and skill selections update on the next request.`);
        $('pane-overview').innerHTML = `<h3>${t('启用的工具', 'Enabled tools')}</h3><div class="chips">${preview.tools.filter(tool => !tool.function.name.startsWith('mcp__')).map(tool => `<span class="chip mono">${esc(tool.function.name)}</span>`).join('') || `<span class="muted">${t('尚未启用工具', 'No tools enabled')}</span>`}</div><h3 style="margin-top:12px">${t('MCP', 'MCP')}</h3><div class="chips">${(preview.mcp || []).flatMap(server => server.tools).filter(tool => draft.tools.enabled.includes(tool.function?.name ?? tool.name)).map(tool => `<span class="chip mono">${esc(tool.function?.name ?? tool.name)}</span>`).join('') || `<span class="muted">${t('尚未启用 MCP 工具', 'No MCP tools enabled')}</span>`}</div><h3 style="margin-top:12px">${t('绑定的技能', 'Selected skills')}</h3><div class="chips">${preview.skills.map(skill => `<span class="chip">${esc(skill.name)}</span>`).join('') || `<span class="muted">${t('尚未绑定技能', 'No skills selected')}</span>`}</div>${draft.skills.length && !preview.skillCatalog.length ? `<p class="source-note">${preview.tools.some(tool => tool.function.name === 'skill') ? t('所选技能目录尚未发布，请查看技能来源与扫描诊断。', 'The selected skill catalog is unavailable; check source and discovery diagnostics.') : t('尚未开启 skill 工具，技能摘要不会自动发布。', 'The skill tool is disabled, so its catalog is not automatically published.')}</p>` : ''}`;
        $('variable-list').innerHTML = Object.entries(preview.variables).map(([key, value]) => `<div class="variable-row"><code>{{${esc(key)}}}</code><span>${esc(value ?? t('当前未定义', 'Currently undefined'))}</span></div>`).join('');
        if (!cwd) { cwd = preview.cwd; $('preview-cwd').value = cwd; }
      }
      async function refreshPreview(withSkills = false) {
        const version = ++previewVersion, id = draft.id, input = { id, draft: clone(draft), ...context() };
        $('preview-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-dialog-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-open').disabled = true;
        $('copy-preview').disabled = true;
        previewQueue = previewQueue.then(async () => {
          if (version !== previewVersion || signal.aborted) return;
          try {
          const result = await request('preview', input);
          const source = withSkills ? await request('skills', { cwd: result.cwd }) : undefined;
          if (version !== previewVersion || signal.aborted || draft.id !== id) return;
          preview = result;
          $('copy-preview').disabled = false;
          $('operation-error').textContent = '';
          // The preview is a restricted preset view; keep the global scan inventory intact.
          preview.catalog = result.catalog;
          if (source) { sourceSkills = source.skills; completeSkills = source.complete; }
          renderPreview(); sections(); tools(); mcp(); skills(); status();
        } catch (error) {
          if (version !== previewVersion || signal.aborted) return;
          preview = undefined; $('preview-prompt').replaceChildren(); $('preview-summary').textContent = t('预览失败', 'Preview failed'); $('preview-dialog-summary').textContent = t('预览失败', 'Preview failed'); $('preview-open').disabled = true; report(error); status();
          }
        });
        return previewQueue;
      }
      function changed() { previewVersion++; clearTimeout(previewTimer); status(); $('preview-open').disabled = true; $('copy-preview').disabled = true; $('preview-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-dialog-summary').textContent = t('生成预览…', 'Generating preview…'); previewTimer = setTimeout(() => refreshPreview(), 350); }
      function renderContextOptions() {
        if (!state.sessions.some(session => session.id === sessionId)) sessionId = '';
        const current = state.sessions.find(session => session.id === sessionId), key = session => [session.cwd, session.provider, session.model, session.permissions?.sandbox, session.permissions?.approval].join('\0'), contexts = [...new Map(state.sessions.map(session => [key(session), session])).values()];
        $('preview-context').innerHTML = `<span class="choice-name">${esc(current ? (current.cwd || t('会话环境', 'Session context')) : t('默认模型与指定目录', 'Default model and chosen directory'))}</span>${icon('down')}`;
        $('preview-context-menu').innerHTML = [{ id: '', cwd: t('默认模型与指定目录', 'Default model and chosen directory') }, ...contexts].map(session => `<button type="button" class="select-option context-option" data-context-session="${esc(session.id)}" role="option" aria-selected="${current ? key(session) === key(current) : !session.id}"><span class="choice-name">${esc(session.cwd)}${session.model ? `<small>${esc(session.provider || '')} · ${esc(session.model)}${session.permissions?.sandbox ? ' · ' + esc(session.permissions.sandbox) + ' / ' + esc(session.permissions.approval || '') : ''}</small>` : ''}</span></button>`).join('');
        $('preview-cwd').readOnly = Boolean(sessionId); $('preview-cwd').value = current ? current.cwd || '' : cwd;
      }
      function render(reset = true) {
        if (reset) { base = clone(selected()); draft = clone(base); preview = undefined; }
        pickers(); $('preset-id').value = draft.id; $('preset-description').value = draft.description; $('persona').value = draft.prompt.persona; fitPromptEditor($('persona'));
        $('preset-enabled').checked = draft.enabled; $('preset-enabled').disabled = draft.builtin; $('delete-preset').disabled = draft.builtin;
        tools(); skills(); sections(); mcp(); scanStatus(); status(); renderContextOptions();
        const warning = state.roster.find(p => p.id === draft.id)?.broken;
        $('operation-error').textContent = warning || (state.nameConflicts.length ? t('存在与其他插件相同的预设显示名。', 'A preset display name is also used by another plugin.') : '');
      }
      async function save(changes, overrideName) {
        const before = clone(draft), result = await request('save', { id: base.id, revision: base.revision, changes });
        state = result; base = clone(state.presets.find(p => p.id === before.id)); draft = before;
        if (overrideName) draft.tools.overrides[overrideName] = clone(base.tools.overrides[overrideName]);
        else for (const key of Object.keys(changes)) draft[key] = clone(base[key]);
        draft.revision = base.revision;
        render(false); await refreshPreview(); toast(t('已保存。', 'Saved.'));
        return true;
      }
      function dialog(title, subtitle, body, handler, label = t('保存', 'Save'), beforeActions = '') {
        $('dialog-body').onclick = null; $('dialog-body').oninput = null;
        $('dialog-title').textContent = title; $('dialog-subtitle').textContent = subtitle; $('dialog-body').innerHTML = body;
        $('dialog-footer').innerHTML = `${beforeActions}<span></span><button type="button" id="dialog-cancel">取消</button><button type="submit" class="primary" id="dialog-save">${label}</button>`;
        $('dialog-save').hidden = false; $('dialog-cancel').hidden = false; submit = handler; closePickers(); $('editor-dialog').showModal();
        $('dialog-cancel').onclick = closeDialog;
      }
      function closeDialog() { if (dialogPending) return; $('editor-dialog').close(); submit = undefined; }
      $('editor-dialog').addEventListener('cancel', event => { event.stopPropagation(); if (dialogPending) event.preventDefault(); });
      $('dialog-close').onclick = closeDialog; $('dialog-cancel').onclick = closeDialog;
      // A conflict dialog reopens in a queued task; a queued close event from the
      // previous dialog must not clear the handler the new one just installed.
      $('editor-dialog').addEventListener('click', event => { if (event.target !== $('editor-dialog')) return; const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); });
      $('dialog-form').onsubmit = async event => {
        event.preventDefault(); if ($('dialog-save').disabled) return;
        dialogPending = true;
        for (const id of ['dialog-save', 'dialog-cancel', 'dialog-close']) $(id).disabled = true;
        try { if (await submit?.() !== false) { dialogPending = false; closeDialog(); } }
        catch (error) { const output = $('dialog-error'); if (output) { output.textContent = error.message; $('tool-json')?.setAttribute('aria-invalid', 'true'); output.scrollIntoView({ block: 'nearest' }); } else report(error); }
        finally { dialogPending = false; for (const id of ['dialog-save', 'dialog-cancel', 'dialog-close']) $(id).disabled = false; }
      };
      function openSection(id, edit) {
        if (id === 'workshop:user-cwd') { dialog(t('预览', 'Preview'), t('工作目录', 'Working directory'), `<pre class="preview-code section-preview">${esc(preview?.runtimeContextWorkingDirectory || '')}</pre>`, () => {}, t('关闭', 'Close')); $('dialog-cancel').hidden = true; return; }
        if (id === 'workshop:user-runtime') { dialog(t('预览', 'Preview'), t('环境', 'Environment'), `<pre class="preview-code section-preview">${esc(preview?.runtimeContextEnvironmentSource || '')}</pre>`, () => {}, t('关闭', 'Close')); $('dialog-cancel').hidden = true; return; }
        let section = id === AGENT ? { ...preview.agentInstructions, ...(draft.prompt.sections[AGENT] || {}) } : id === USER_DIRECTORY ? { text: preview.agentInstructions.directoryText, editable: false } : supplemental().find(item => item.name === id);
        if (id === 'workshop:user-runtime') section = { name: id, text: preview.runtimeContextEnvironmentSource, editable: false, toggleable: true, order: draft.prompt.sections[id]?.order ?? 0, enabled: draft.prompt.sections[id]?.enabled !== false };
        if (id === 'workshop:user-skill') section = { name: id, text: preview.skillPrompt, editable: false };
        section ||= preview.userSections?.find(item => item.name === id);
        if (!section) return;
        if (edit && (section.editable === false || section.managedBy === 'host')) return;
        const name = id === AGENT ? globalAgentDescription() : id === USER_DIRECTORY ? directoryAgentDescription() : sectionName({ name: id });
        const guidance = id === 'workshop:tool-guidance';
        const editor = guidance ? section.members.map((member, index) => `<label class="field">${esc(member.name)}<textarea class="guidance-editor" data-guidance-member="${index}" spellcheck="false" maxlength="200000">${esc(draft.prompt.sections[member.name]?.text ?? member.text)}</textarea></label>`).join('') : `<textarea class="section-modal-editor" id="section-content" spellcheck="false" maxlength="200000" aria-label="${esc(name)}">${esc(section.text)}</textarea>`;
        const title = edit ? t('编辑', 'Edit') : t('预览', 'Preview');
        const extra = edit && section.custom ? `<label class="field">${t('名称', 'Name')}<input id="section-name" maxlength="256" value="${esc(id)}" required></label>` : '';
        dialog(title, name, edit ? `${extra}${editor}<p id="dialog-error" class="error-message" role="alert"></p>` : `<pre class="preview-code section-preview">${esc((section.renderedText ?? section.text) || t('当前没有内容。', 'No content currently.'))}</pre>`, () => { if (edit) {
          const targetId = section.custom ? $('section-name').value.trim() : id;
          if (section.custom && (!targetId || /[\x00-\x1f\x7f]/.test(targetId) || Object.hasOwn(draft.prompt.sections, targetId) && targetId !== id)) throw Error(t('名称为空或已被占用，请换一个。', 'Choose a nonempty, unique name.'));
          if (guidance) root.querySelectorAll('[data-guidance-member]').forEach(el => { const member = section.members[Number(el.dataset.guidanceMember)]; draft.prompt.sections[member.name] = { text: el.value, order: member.order, enabled: draft.prompt.sections[member.name]?.enabled ?? true }; });
          if (section.custom) { if (targetId !== id) delete draft.prompt.sections[id]; draft.prompt.sections[targetId] = { custom: true, ...(section.role ? { role: section.role } : {}), text: $('section-content').value, order: section.order, enabled: section.enabled }; }
          else draft.prompt.sections[id] = { ...(section.custom ? { custom: true, ...(section.role ? { role: section.role } : {}) } : {}), text: guidance || ['time-context', 'workshop:user-runtime'].includes(id) ? '' : $('section-content').value, order: section.order, enabled: section.enabled };
          sections(); changed();
        } }, edit ? t('保存', 'Save') : t('关闭', 'Close'), section.custom && edit ? `<button type="button" class="danger" id="delete-section">${icon('trash')}${t('删除此内容', 'Delete content')}</button>` : '');
        root.querySelectorAll('.guidance-editor,.section-modal-editor').forEach(textarea => { const fit = () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 360, Math.floor(window.innerHeight * .45))}px`; }; fit(); textarea.addEventListener('input', fit); });
        if (section.custom && edit) $('delete-section').onclick = () => { delete draft.prompt.sections[id]; closeDialog(); sections(); changed(); };
        $('dialog-cancel').hidden = !edit;
      }
      async function openSkill(name) {
        const skill = await request('skill', { name, cwd: preview?.cwd || cwd });
        dialog(name, '', `<div class="skill-detail-path"><span>${t('技能路径', 'Skill path')}</span><code>${esc(skill.path || skill.source)}</code></div><div class="skill-diagnostics"><h3>${t('诊断', 'Diagnostics')}</h3><p>${esc(skill.bodySource === 'file' ? t('技能已通过宿主校验；下方正文来自原始文件。', 'Validated by the host. The body below comes from the source file.') : t('正文来自技能 provider；当前没有可读取的本地原文件。', 'The body is provided by the skill provider; no local source file is readable.'))}</p>${skill.fileError ? `<p class="source-note">${esc(skill.fileError)}</p>` : ''}</div><div class="skill-metadata"><div><span>${t('名称', 'Name')}</span><strong>${esc(skill.name)}</strong></div><div class="skill-description-card"><span>${t('描述', 'Description')}</span><p tabindex="0">${esc(skill.description)}</p></div></div><h3 class="skill-body-title">${t('正文', 'Body')}</h3><pre class="preview-code skill-body" tabindex="0">${esc(skill.content)}</pre>${skill.runtimeContent ? `<details class="skill-runtime"><summary>${t('加载技能后的补充 · 不在目录摘要中', 'Supplement after loading · Not part of the catalog')}</summary><pre class="preview-code" tabindex="0">${esc(skill.runtimeContent)}</pre></details>` : ''}<p id="dialog-error" class="error-message" role="alert"></p>`, () => {}, t('关闭', 'Close'));
        $('dialog-cancel').hidden = true;
      }
      function openTool(name) {
        const tool = toolSource(name);
        if (!tool?.schema) return;
        const schema = draft.tools.overrides[name]?.schema || tool.schema;
        dialog(t('工具描述', 'Tool description'), name, `<p class="risk risk-inline">${icon('notice')}<span>${t('请确保您了解 AI 与提示词的机制，否则请不要修改；您的任何修改导致的后果由您个人承担。', 'Only edit if you understand AI and prompts. You are responsible for the consequences.')}</span></p><textarea class="json-editor" id="tool-json" spellcheck="false" aria-label="${esc(name)} JSON" aria-describedby="dialog-error">${esc(JSON.stringify(schema, null, 2))}</textarea><div class="json-tools"><span class="muted">${t('如果您想调整，建议仅修改 description，名称和参数结构保持不变。避免出现兼容问题', 'To adjust descriptions, edit descriptions only and keep names and parameter structure unchanged.')}</span><button type="button" class="text-button" id="format-json">${t('格式化', 'Format')}</button></div><p class="error-message" id="dialog-error" role="alert" aria-live="assertive"></p>`, async () => {
          let value; try { value = JSON.parse($('tool-json').value); } catch (error) { throw Error(t('JSON 格式有误：', 'Invalid JSON: ') + error.message); }
          const tools = clone(base.tools); tools.overrides[name] = { schema: value };
          // Server validates against the selected source's original schema.
          return save({ tools }, name);
        });
        $('format-json').onclick = () => { try { $('tool-json').value = JSON.stringify(JSON.parse($('tool-json').value), null, 2); $('dialog-error').textContent = ''; $('tool-json').removeAttribute('aria-invalid'); } catch (error) { $('dialog-error').textContent = error.message; $('tool-json').setAttribute('aria-invalid', 'true'); } };
      }
      async function acceptMcpChange(nextState, removedServerName) {
        const pending = clone(draft);
        state = nextState;
        base = clone(state.presets.find(p => p.id === pending.id));
        const mcp = clone(base.mcp).map(server => {
          const previous = pending.mcp.find(item => item.serverName === server.serverName);
          return previous?.enabled !== undefined ? { ...server, enabled: previous.enabled } : server;
        });
        const owner = name => [...pending.mcp, ...(state.catalog.mcpServers || [])].filter(server => name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0]?.serverName;
        const enabled = pending.tools.enabled.filter(name => !removedServerName || owner(name) !== removedServerName);
        draft = { ...pending, mcp, mcpEnabled: clone(pending.mcpEnabled ?? base.mcpEnabled ?? {}), revision: base.revision, tools: { ...pending.tools, enabled } };
        render(false); await refreshPreview(true);
      }
      function openMcpEditor(server) {
        const editing = Boolean(server);
        let config = server ? Object.fromEntries(Object.entries(clone(draft.mcp.find(item => item.serverName === server.serverName) || server)).filter(([key]) => !['source', 'tools'].includes(key))) : { serverName: '', transport: 'stdio', command: '', args: [], env: {}, cwd: '' };
        const transportDrafts = {
          stdio: config.transport === 'stdio' ? clone(config) : { serverName: config.serverName, transport: 'stdio', command: '', args: [], env: {}, cwd: config.cwd || '' },
          'streamable-http': config.transport === 'streamable-http' ? clone(config) : { serverName: config.serverName, transport: 'streamable-http', url: '', headers: {}, cwd: config.cwd || '' },
        };
        let jsonMode = false, probeVersion = 0;
        const transportRows = {};
        const argument = value => `<div class="kv-row" data-mcp-arg><input class="kv-value" data-mcp-arg-value aria-label="${t('参数', 'Argument')}" value="${esc(value)}"><button type="button" class="icon-button ghost" data-mcp-remove aria-label="${t('删除参数', 'Remove argument')}">${icon('close')}</button></div>`;
        const pair = (key, value, visible = false) => {
          const expression = Boolean(value && typeof value === 'object' && typeof value.__jsExpr === 'string' && Object.keys(value).length === 1);
          const text = typeof value === 'string' ? value : expression ? value.__jsExpr : JSON.stringify(value ?? '');
          return `<div class="kv-row" data-mcp-kv><input class="kv-key" data-mcp-key aria-label="${t('名称', 'Name')}" placeholder="${t('名称', 'Name')}" value="${esc(key)}"><input class="kv-value" data-mcp-value aria-label="${t('值', 'Value')}" placeholder="${t('值', 'Value')}" type="${visible ? 'text' : 'password'}" value="${esc(text)}"><label class="expression-option"><input type="checkbox" data-mcp-expression ${expression ? 'checked' : ''}>${t('表达式', 'Expression')}</label><button type="button" class="icon-button ghost" data-mcp-reveal aria-label="${t(visible ? '隐藏值' : '显示值', visible ? 'Hide value' : 'Show value')}" title="${t(visible ? '隐藏值' : '显示值', visible ? 'Hide value' : 'Show value')}" aria-pressed="${visible}">${icon(visible ? 'eye-off' : 'eye')}</button><button type="button" class="icon-button ghost" data-mcp-remove aria-label="${t('删除此行', 'Remove row')}">${icon('close')}</button></div>`;
        };
        const read = (allowIncomplete = false) => {
          if (jsonMode) {
            let value; try { value = JSON.parse($('mcp-json').value); } catch (error) { throw Error(t('JSON 格式有误：', 'Invalid JSON: ') + error.message); }
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(t('JSON 需要是一台 MCP 的配置对象。', 'JSON must be one MCP configuration object.'));
            return value;
          }
          const value = { ...clone(config), serverName: $('mcp-server').value.trim() };
          const entries = [...root.querySelectorAll('[data-mcp-kv]')].map(row => {
            const key = row.querySelector('[data-mcp-key]').value.trim(), text = row.querySelector('[data-mcp-value]').value;
            if (!key && !allowIncomplete) throw Error(t('请填写名称，或删除空行。', 'Enter a name or remove the empty row.'));
            if (!key) return undefined;
            return [key, row.querySelector('[data-mcp-expression]').checked ? { __jsExpr: text } : text];
          });
          const completeEntries = entries.filter(Boolean);
          if (!allowIncomplete && new Set(completeEntries.map(([key]) => key)).size !== completeEntries.length) throw Error(t('环境变量或请求头的名称不能重复。', 'Variable or header names must be unique.'));
          if (value.transport === 'stdio') { value.command = $('mcp-command').value.trim(); value.args = [...root.querySelectorAll('[data-mcp-arg-value]')].map(input => input.value); value.env = Object.fromEntries(completeEntries); value.cwd ??= ''; delete value.url; delete value.headers; }
          else { value.url = $('mcp-url').value.trim(); value.headers = Object.fromEntries(completeEntries); for (const key of ['command', 'args', 'env']) delete value[key]; }
          return value;
        };
        const drawForm = () => {
          const stdio = config.transport === 'stdio';
          const rows = transportRows[config.transport];
          const args = rows?.args ?? config.args ?? [];
          const pairs = rows?.pairs ?? Object.entries((stdio ? config.env : config.headers) || {}).map(([key, value]) => ({ key, value }));
          $('mcp-form-view').innerHTML = `<label class="field">${t('名称', 'Name')}<input id="mcp-server" pattern="[A-Za-z0-9_-]{1,32}" required value="${esc(config.serverName)}" placeholder="${t('例如：tavily', 'For example: tavily')}" ${editing ? 'readonly' : ''}></label><div class="field"><span>${t('连接方式', 'Transport')}</span><div class="segmented"><button type="button" data-mcp-transport="stdio" aria-pressed="${stdio}" class="${stdio ? 'active' : ''}">${t('本地命令（stdio）', 'Local command (stdio)')}</button><button type="button" data-mcp-transport="streamable-http" aria-pressed="${!stdio}" class="${stdio ? '' : 'active'}">HTTP</button></div></div>${stdio ? `<label class="field">${t('命令', 'Command')}<input id="mcp-command" required placeholder="${t('只写程序，例如 npx 或 uvx；参数写在下面', 'Program only, such as npx or uvx; add arguments below')}" value="${esc(config.command || '')}"></label><div class="field"><span>${t('参数', 'Arguments')}</span><div id="mcp-args-list">${args.map(argument).join('')}</div><button type="button" class="text-button" data-mcp-add-arg>${icon('plus')}${t('添加参数', 'Add argument')}</button></div>` : `<label class="field">URL<input id="mcp-url" type="url" required placeholder="https://mcp.example.com/mcp" value="${esc(config.url || '')}"></label>`}<div class="field"><span>${t(stdio ? '环境变量' : '请求头', stdio ? 'Environment variables' : 'Request headers')}</span><div id="mcp-pairs-list">${pairs.map(row => pair(row.key, row.expression ? { __jsExpr: row.value } : row.value, row.visible)).join('')}</div><button type="button" class="text-button" data-mcp-add-pair>${icon('plus')}${t(stdio ? '添加环境变量' : '添加请求头', stdio ? 'Add variable' : 'Add header')}</button></div>`;
        };
        const resizeMcpJson = () => {
          const editor = $('mcp-json');
          editor.style.height = 'auto';
          editor.style.height = Math.min(editor.scrollHeight, 370, Math.floor(window.innerHeight * .45)) + 'px';
        };
        const resetProbe = () => { probeVersion++; const output = $('mcp-probe-status'); output.className = 'probe-state muted'; output.textContent = t('未检测', 'Not tested'); };
        dialog(editing ? t('编辑 MCP', 'Edit MCP') : t('添加 MCP', 'Add MCP'), t('仅当前预设可用', 'Available only to this preset'), `<div class="mcp-config-head"><span>${t('连接配置', 'Connection configuration')}</span><div class="segmented"><button type="button" data-mcp-mode="form" class="active" aria-pressed="true">${t('表单', 'Form')}</button><button type="button" data-mcp-mode="json" aria-pressed="false">JSON</button></div></div><div id="mcp-form-view"></div><div id="mcp-json-view" hidden><label class="field">JSON<textarea id="mcp-json" class="json-editor mcp-json-editor" spellcheck="false"></textarea></label></div><p class="source-note">${t('值保存在当前预设配置中；勾选“表达式”可引用 process.env。', 'Values are stored in this preset; select “Expression” to reference process.env.')}</p><div class="probe-actions"><button type="button" data-mcp-probe>${t('检测工具', 'Detect tools')}</button><span id="mcp-probe-status" class="probe-state muted" role="status">${t('未检测', 'Not checked')}</span></div><p class="source-note" id="mcp-probe-help">${t('检测会连接服务器并读取工具清单，不会调用工具或保存配置。', 'Connects to the server and reads its tool list. It does not call tools or save the configuration.')}</p>${dialogError}`, async () => {
          const next = read();
          if (editing && next.serverName !== server.serverName) throw Error(t('名称不可修改。', 'The name cannot be changed.'));
          if (editing) {
            next.enabled = base.mcp.find(item => item.serverName === server.serverName)?.enabled;
            if (next.enabled === undefined) delete next.enabled;
          }
          const result = await request(editing ? 'mcp-update' : 'mcp-create', { id: base.id, revision: base.revision, ...(editing ? { serverName: server.serverName } : {}), server: next });
          await acceptMcpChange(result); toast(t('MCP 配置已保存。', 'MCP configuration saved.'));
        }, editing ? t('保存', 'Save') : t('添加', 'Add'));
        drawForm();
        $('dialog-body').oninput = event => { resetProbe(); if (event.target.id === 'mcp-json') resizeMcpJson(); };
        $('dialog-body').onclick = async event => {
          const button = event.target.closest('button');
          if (!button) return;
          try {
            if (button.dataset.mcpMode) {
              const nextJson = button.dataset.mcpMode === 'json';
              if (jsonMode === nextJson) return;
              config = read();
              if (!['stdio', 'streamable-http'].includes(config.transport)) throw Error(t('仅支持 stdio 或 streamable-http。', 'Only stdio and streamable-http are supported.'));
              transportRows[config.transport] = undefined;
              transportDrafts[config.transport] = clone(config);
              jsonMode = nextJson;
              if (jsonMode) $('mcp-json').value = JSON.stringify(config, null, 2); else drawForm();
              $('mcp-form-view').hidden = jsonMode; $('mcp-json-view').hidden = !jsonMode;
              $('mcp-json').disabled = !jsonMode;
              if (jsonMode) resizeMcpJson();
              root.querySelectorAll('#mcp-form-view input').forEach(input => { input.disabled = jsonMode; });
              root.querySelectorAll('[data-mcp-mode]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
            }
            if (button.dataset.mcpTransport) {
              const current = read(true), transport = button.dataset.mcpTransport;
              transportDrafts[current.transport] = clone(current);
              transportRows[current.transport] = {
                args: [...root.querySelectorAll('[data-mcp-arg-value]')].map(input => input.value),
                pairs: [...root.querySelectorAll('[data-mcp-kv]')].map(row => ({
                  key: row.querySelector('[data-mcp-key]').value,
                  value: row.querySelector('[data-mcp-value]').value,
                  expression: row.querySelector('[data-mcp-expression]').checked,
                  visible: row.querySelector('[data-mcp-value]').type === 'text',
                })),
              };
              config = { ...clone(transportDrafts[transport]), serverName: current.serverName, transport };
              drawForm(); resetProbe();
            }
            if (button.hasAttribute('data-mcp-add-arg')) { $('mcp-args-list').insertAdjacentHTML('beforeend', argument('')); resetProbe(); }
            if (button.hasAttribute('data-mcp-add-pair')) { $('mcp-pairs-list').insertAdjacentHTML('beforeend', pair('', '')); resetProbe(); }
            if (button.hasAttribute('data-mcp-remove')) { button.closest('.kv-row').remove(); resetProbe(); }
            if (button.hasAttribute('data-mcp-reveal')) { const input = button.closest('.kv-row').querySelector('[data-mcp-value]'), visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; button.setAttribute('aria-pressed', String(visible)); button.setAttribute('aria-label', t(visible ? '隐藏值' : '显示值', visible ? 'Hide value' : 'Show value')); button.title = t(visible ? '隐藏值' : '显示值', visible ? 'Hide value' : 'Show value'); button.innerHTML = icon(visible ? 'eye-off' : 'eye'); }
            if (button.hasAttribute('data-mcp-probe')) {
              const input = read(), version = ++probeVersion, output = $('mcp-probe-status');
              output.className = 'probe-state'; output.textContent = t('检测中…', 'Checking…');
              try {
                const result = await request('mcp-probe', { server: input, language: english ? 'en' : 'zh' });
                if (version !== probeVersion || output !== $('mcp-probe-status') || !$('editor-dialog').open) return;
                output.className = 'probe-state ' + (result.ok ? 'success' : 'error'); output.textContent = result.message;
              } catch (error) { if (version === probeVersion && output === $('mcp-probe-status')) { output.className = 'probe-state error'; output.textContent = error.message; } }
            }
            if ($('dialog-error')) $('dialog-error').textContent = '';
          } catch (error) { $('dialog-error').textContent = error.message; }
        };
      }
      function previewMcp(server) {
        let version = 0;
        const config = server.config || server;
        const revealedHeaders = new Set();
        const valueText = value => value && typeof value === 'object' && typeof value.__jsExpr === 'string' ? value.__jsExpr : typeof value === 'string' ? value : JSON.stringify(value ?? '');
        const field = (label, value) => `<div class="mcp-preview-field"><span>${label}</span><code>${esc(value || t('未设置', 'Not set'))}</code></div>`;
        const entries = values => Object.entries(values || {}).map(([key, value]) => `<div class="mcp-preview-entry"><code>${esc(key)}</code><span>${esc(valueText(value))}</span></div>`).join('') || `<span class="muted">${t('未设置', 'Not set')}</span>`;
        const headerEntries = Object.entries(config.headers || {}).map(([key, value], index) => `<div class="mcp-preview-entry has-reveal"><code>${esc(key)}</code><span class="mcp-preview-secret" data-mcp-preview-secret="${index}">${revealedHeaders.has(index) ? esc(valueText(value)) : '••••••'}</span><button type="button" class="icon-button ghost" data-mcp-preview-reveal="${index}" aria-label="${esc(t('显示请求头值', 'Show header value'))}" title="${esc(t('显示请求头值', 'Show header value'))}" aria-pressed="false">${icon('eye')}</button></div>`).join('') || `<span class="muted">${t('未设置', 'Not set')}</span>`;
        const stdio = config.transport === 'stdio', http = config.transport === 'streamable-http';
        const transport = stdio ? t('本地命令（stdio）', 'Local command (stdio)') : http ? 'Streamable HTTP' : t('未识别', 'Unidentified');
        const details = stdio ? `${field(t('命令', 'Command'), config.command)}${field(t('工作目录', 'Working directory'), config.cwd)}<div class="mcp-preview-field"><span>${t('参数', 'Arguments')}</span><div class="mcp-preview-entries">${config.args?.length ? config.args.map(value => `<div class="mcp-preview-entry"><code>${esc(value)}</code></div>`).join('') : `<span class="muted">${t('未设置', 'Not set')}</span>`}</div></div><div class="mcp-preview-field"><span>${t('环境变量', 'Environment variables')}</span><div class="mcp-preview-entries">${entries(config.env)}</div></div>` : http ? `${field('URL', config.url)}<div class="mcp-preview-field"><span>${t('请求头', 'Request headers')}</span><div class="mcp-preview-entries">${headerEntries}</div></div>` : '';
        const connection = `<div class="mcp-preview-config">${field(t('名称', 'Name'), server.serverName)}${field(t('连接方式', 'Transport'), transport)}${details}</div>`;
        dialog(t('MCP 预览', 'MCP preview'), server.serverName || t('来源未识别', 'Unidentified source'), `${connection}<p class="source-note">${t('连接状态与工具数量，以检测结果为准。', 'Detect tools to check the connection and tool count.')}</p><div class="probe-actions"><button type="button" data-mcp-preview-probe ${server.source === 'unknown' ? 'disabled' : ''}>${t('检测', 'Detect')}</button><span class="probe-state muted" id="mcp-preview-status" role="status">${server.tools.length} ${t('个工具', 'tools')}</span></div><div class="mcp-tools">${server.tools.map(tool => `<span class="chip mono">${esc(tool.function?.name ?? tool.name)}</span>`).join('')}</div>${dialogError}`, () => {}, t('关闭', 'Close'));
        $('dialog-cancel').hidden = true;
        $('dialog-body').onclick = async event => {
          const reveal = event.target.closest('[data-mcp-preview-reveal]');
          if (reveal) {
            const index = Number(reveal.dataset.mcpPreviewReveal), visible = !revealedHeaders.has(index), value = Object.entries(config.headers || {})[index]?.[1];
            if (visible) revealedHeaders.add(index); else revealedHeaders.delete(index);
            $('dialog-body').querySelector(`[data-mcp-preview-secret="${index}"]`).textContent = visible ? valueText(value) : '••••••';
            reveal.setAttribute('aria-pressed', String(visible)); reveal.setAttribute('aria-label', t(visible ? '隐藏请求头值' : '显示请求头值', visible ? 'Hide header value' : 'Show header value')); reveal.title = t(visible ? '隐藏请求头值' : '显示请求头值', visible ? 'Hide header value' : 'Show header value'); reveal.innerHTML = icon(visible ? 'eye-off' : 'eye');
            return;
          }
          if (!event.target.closest('[data-mcp-preview-probe]')) return;
          const output = $('mcp-preview-status'), current = ++version;
          output.textContent = t('检测中…', 'Checking…');
          try {
            const result = await request('mcp-probe', { id: base.id, serverName: server.serverName, ...(server.source === 'preset' ? { server: draft.mcp.find(item => item.serverName === server.serverName) } : {}), language: english ? 'en' : 'zh' });
            if (current !== version || output !== $('mcp-preview-status') || !$('editor-dialog').open) return;
            output.textContent = result.message;
          } catch (error) { if (output === $('mcp-preview-status')) output.textContent = error.message; }
        };
      }
      function removeMcp(server) {
        dialog(t('删除 MCP 服务器', 'Delete MCP server'), t('仅删除当前预设中的连接配置。', 'Only this preset connection will be removed.'), `<p>${t(`将删除「${server.serverName}」及其已启用工具。消息历史不受影响。`, `“${server.serverName}” and its enabled tools will be removed. Message history is unaffected.`)}</p>${dialogError}`, async () => { const result = await request('mcp-delete', { id: base.id, revision: base.revision, serverName: server.serverName }); await acceptMcpChange(result, server.serverName); toast(t('MCP 已删除。', 'MCP deleted.')); }, t('删除', 'Delete'));
      }
      root.addEventListener('input', event => { if (event.target.id === 'tool-json') { $('dialog-error').textContent = ''; event.target.removeAttribute('aria-invalid'); } });
      async function select(id) { state = await request('settings', { changes: { selectedPresetId: id } }); render(); await refreshPreview(true); }
      root.addEventListener('click', event => {
        if (event.target.closest('.tooltip-wrap')) { event.preventDefault(); event.stopPropagation(); return; }
        const contextOption = event.target.closest('[data-context-session]');
        if (contextOption) { sessionId = contextOption.dataset.contextSession; closePickers(); renderContextOptions(); refreshPreview(true); return; }
        const option = event.target.closest('[data-preset-value],[data-fallback-value]');
        if (option) {
          closePickers();
          if (option.dataset.fallbackValue) run(async () => { state = await request('settings', { changes: { fallbackPresetId: option.dataset.fallbackValue } }); pickers(); });
          else if (option.dataset.presetValue !== draft.id) {
            const id = option.dataset.presetValue;
            if (!dirty()) run(() => select(id));
            else dialog(t('切换预设', 'Switch preset'), t('当前有未保存修改。', 'There are unsaved changes.'), `<p>${t('切换会丢弃本次编辑。取消后可先保存。', 'Switching discards these edits. Cancel to save first.')}</p>`, () => run(() => select(id)), t('丢弃并切换', 'Discard and switch'));
          }
          return;
        }
        if (!event.target.closest('.select-card')) closePickers();
        const button = event.target.closest('button');
        if (button?.hasAttribute('data-mcp-preview')) { const server = preview?.mcp.find(item => item.serverName === button.dataset.mcpPreview); if (server) previewMcp(server); return; }
        const editMcp = button?.dataset.mcpEdit && preview?.mcp.find(server => server.serverName === button.dataset.mcpEdit);
        if (editMcp) { event.preventDefault(); event.stopPropagation(); openMcpEditor(editMcp); return; }
        const deleteMcp = button?.dataset.mcpDelete && preview?.mcp.find(server => server.serverName === button.dataset.mcpDelete);
        if (deleteMcp) { event.preventDefault(); event.stopPropagation(); removeMcp(deleteMcp); return; }
        if (button?.id === 'create-mcp') { event.preventDefault(); event.stopPropagation(); openMcpEditor(); return; }
        if (button?.dataset.description) openTool(button.dataset.description);
        if (button?.dataset.sectionPreview) openSection(button.dataset.sectionPreview, false);
        if (button?.dataset.sectionEdit) openSection(button.dataset.sectionEdit, true);
        if (button?.dataset.skillDetail) run(() => openSkill(button.dataset.skillDetail));
      });
      root.querySelectorAll('.select-card').forEach(picker => picker.addEventListener('toggle', () => { picker.querySelector('summary').setAttribute('aria-expanded', String(picker.open)); if (picker.open) root.querySelectorAll('.select-card').forEach(other => { if (other !== picker) other.open = false; }); }));
      root.addEventListener('keydown', event => {
        if (event.target.closest('summary .tooltip-wrap') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); return; }
        if (event.key === 'Escape') closePickers();
        const picker = event.target.closest('.select-card');
        if (picker && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); picker.open = true; const all = [...picker.querySelectorAll('.select-option')], index = all.indexOf(root.activeElement); all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
        const handle = event.target.closest('[data-drag-section]');
        if (handle && event.target.closest('.drag-handle') && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const userLevel = handle.closest('.section-level')?.classList.contains('user-level'), items = userLevel ? [...handle.closest('.section-level').querySelectorAll('[data-drag-section]')].map(row => ({ name: row.dataset.sectionId })) : supplemental().filter(s => s.reorderable !== false && s.managedBy !== 'host'), index = items.findIndex(s => s.name === handle.dataset.dragSection), next = index + (event.key === 'ArrowUp' ? -1 : 1); if (items[next]) { move(items[index].name, items[next].name, next < index); root.querySelector(`[data-drag-section="${CSS.escape(handle.dataset.dragSection)}"] .drag-handle`)?.focus(); } }
      });
      root.addEventListener('change', event => {
        const el = event.target;
        if (el.dataset.tool) { const tool = toolSource(el.dataset.tool); if (!tool) return; const key = tool.light === false ? 'packages' : 'enabled', name = tool.light === false ? tool.package : tool.name; draft.tools[key] = el.checked ? [...new Set([...draft.tools[key], name])] : draft.tools[key].filter(x => x !== name); tools(); mcp(); changed(); }
        if (el.dataset.mcpEnabled) {
          const server = preview?.mcp.find(item => item.serverName === el.dataset.mcpEnabled);
          if (!server || server.tools.some(tool => draft.tools.enabled.includes(tool.function?.name ?? tool.name))) { mcp(); return; }
          if (server.source === 'preset') draft.mcp = draft.mcp.map(item => item.serverName === server.serverName ? { ...item, enabled: el.checked } : item);
          else draft.mcpEnabled = { ...draft.mcpEnabled, [server.serverName]: el.checked };
          mcp(); changed();
        }
        if (el.dataset.package) { draft.tools.packages = el.checked ? [...new Set([...draft.tools.packages, el.dataset.package])] : draft.tools.packages.filter(x => x !== el.dataset.package); tools(); changed(); }
        if (el.dataset.skill) { draft.skills = el.checked ? [...new Set([...draft.skills, el.dataset.skill])] : draft.skills.filter(x => x !== el.dataset.skill); el.closest('.skill-row')?.classList.toggle('off', !el.checked); if (el.checked && toolSource('skill')?.available) draft.tools.enabled = [...new Set([...draft.tools.enabled, 'skill'])]; tools(); changed(); }
        if (el.dataset.sectionEnabled) { const id = el.dataset.sectionEnabled, section = id === AGENT ? { ...preview.agentInstructions, ...(draft.prompt.sections[AGENT] || {}) } : id === USER_DIRECTORY ? { text: preview.agentInstructions?.directoryText, order: 10000, ...draft.prompt.sections[id] } : id === 'workshop:user-runtime' ? { text: preview.runtimeContextEnvironmentSource, order: 0, ...draft.prompt.sections[id] } : id === 'time-context' ? preview.userSections.find(s => s.name === id) : supplemental().find(s => s.name === id) || draft.prompt.sections[id]; if (!section) return; draft.prompt.sections[id] = { ...(section.custom ? { custom: true, ...(section.role ? { role: section.role } : {}) } : {}), text: ['workshop:tool-guidance', 'time-context', 'workshop:user-runtime', USER_DIRECTORY].includes(id) ? '' : section.text, order: section.order ?? 0, enabled: el.checked }; el.closest('.detected-row')?.classList.toggle('off', !el.checked); changed(); }
      });
      function move(source, target, before) {
        const sourceRow = root.querySelector(`[data-section-id="${CSS.escape(source)}"]`), targetRow = root.querySelector(`[data-section-id="${CSS.escape(target)}"]`);
        if (sourceRow?.closest('.section-level')?.classList.contains('user-level')) {
          if (!targetRow || targetRow.closest('.section-level') !== sourceRow.closest('.section-level')) return;
          const rows = [...sourceRow.parentElement.querySelectorAll('[data-drag-section]')], names = rows.map(row => row.dataset.sectionId), item = names.splice(names.indexOf(source), 1)[0], index = names.indexOf(target);
          if (!item || index < 0) return;
          names.splice(index + (before ? 0 : 1), 0, item);
          names.forEach((name, position) => { const row = rows.find(value => value.dataset.sectionId === name), prior = draft.prompt.sections[name], order = position * 100; draft.prompt.sections[name] = { ...(row.dataset.custom === 'true' ? { custom: true, role: row.dataset.role || 'system' } : {}), text: userSectionText(name), enabled: prior?.enabled ?? !row.classList.contains('off'), order }; });
          sections(); changed(); return;
        }
        const all = supplemental(), items = all.filter(s => s.reorderable !== false && s.managedBy !== 'host'), slots = items.map(s => s.order), item = items.find(s => s.name === source);
        if (!item || source === target) return;
        // Keep native slots; separate equal-order slots before the next section.
        for (let start = 0, end, boundary = 0; start < slots.length; start = end) {
          for (end = start + 1; end < slots.length && slots[end] === slots[start]; end++);
          if (end - start < 2) continue;
          const order = slots[start];
          while (boundary < all.length && all[boundary].order <= order) boundary++;
          const upper = all[boundary]?.order ?? order + 100;
          for (let i = start; i < end; i++) slots[i] = order + (upper - order) * (i - start) / (end - start);
        }
        const reordered = items.filter(s => s !== item), index = reordered.findIndex(s => s.name === target); if (index < 0) return;
        reordered.splice(index + (before ? 0 : 1), 0, item);
        reordered.forEach((s, i) => { draft.prompt.sections[s.name] = { ...(s.custom ? { custom: true } : {}), text: s.name === 'workshop:tool-guidance' ? '' : s.text, enabled: s.enabled, order: slots[i] }; });
        sections(); changed();
      }
      $('section-list').addEventListener('dragstart', event => { const handle = event.target.closest('.drag-handle'), row = handle?.closest('[data-drag-section]'); if (!row) { event.preventDefault(); return; } dragged = row.dataset.dragSection; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragged); row.classList.add('is-dragging'); });
      $('section-list').addEventListener('dragover', event => { const row = event.target.closest('[data-section-id]'), source = dragged && root.querySelector(`[data-section-id="${CSS.escape(dragged)}"]`); if (!dragged || !row || !row.hasAttribute('data-drag-section') || row.dataset.sectionId === dragged || source?.closest('.section-level') !== row.closest('.section-level')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; root.querySelectorAll('.drag-before,.drag-after').forEach(item => item.classList.remove('drag-before', 'drag-after')); row.classList.add(event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'drag-before' : 'drag-after'); });
      $('section-list').addEventListener('drop', event => { const row = event.target.closest('[data-section-id]'), source = dragged && root.querySelector(`[data-section-id="${CSS.escape(dragged)}"]`); if (dragged && row?.hasAttribute('data-drag-section') && row.dataset.sectionId !== dragged && source?.closest('.section-level') === row.closest('.section-level')) { event.preventDefault(); move(dragged, row.dataset.sectionId, event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2); } dragged = undefined; sections(); });
      $('section-list').addEventListener('dragend', event => { event.target.closest('[data-drag-section]')?.classList.remove('is-dragging'); root.querySelectorAll('.drag-before,.drag-after').forEach(item => item.classList.remove('drag-before', 'drag-after')); dragged = undefined; });
      function userSectionText(name) { return name === AGENT ? draft.prompt.sections[name]?.text ?? preview?.agentInstructions?.text ?? '' : draft.prompt.sections[name]?.text ?? ''; }
      const fitPromptEditor = editor => { editor.style.height = `${Math.max(188, Math.min(editor.scrollHeight, 360, Math.floor(window.innerHeight * .55)))}px`; };
      $('persona').oninput = event => { fitPromptEditor(event.target); draft.prompt.persona = event.target.value; changed(); };
      fitPromptEditor($('persona'));
      $('preset-description').oninput = event => { draft.description = event.target.value; status(); };
      $('save-preset').onclick = () => run(() => save({ name: draft.name, description: draft.description, prompt: draft.prompt, tools: draft.tools, skills: draft.skills, mcp: draft.mcp, mcpEnabled: draft.mcpEnabled }));
      const dialogError = '<p id="dialog-error" class="error-message" role="alert"></p>';
      $('add-section').onclick = () => {
        dialog(t('新建内容', 'New content'), t('添加可排序的 System 级文本', 'Add sortable System-level text'), `<label class="field">${t('名称', 'Name')}<input id="new-section-name" maxlength="256" required></label><label class="field">${t('内容', 'Content')}<textarea class="section-modal-editor" id="section-content" maxlength="200000" required></textarea></label>${dialogError}`, () => {
        const name = $('new-section-name').value.trim();
        if (!name || /[\x00-\x1f\x7f]/.test(name) || name.startsWith('tool:') || ['__proto__', 'constructor', 'prototype', 'workshop:agent-instructions', 'workshop:directory-instructions', 'workshop:tool-guidance', 'preset-workshop:persona', 'harness:identity', 'deployment:persona-prefix'].includes(name) || supplemental().some(section => section.name === name) || Object.hasOwn(draft.prompt.sections, name)) throw Error(t('名称为空、已被占用或属于保留名称，请换一个。', 'Choose a nonempty, unique, nonreserved name.'));
        const sameRole = Object.values(draft.prompt.sections).filter(section => !section.role || section.role === 'system').map(section => section.order);
        draft.prompt.sections[name] = { text: $('section-content').value, order: Math.max(0, ...sameRole) + 100, enabled: true, custom: true }; sections(); changed();
      }, t('保存', 'Save'));
      };
      $('create-preset').onclick = () => dialog(t('新建预设', 'New preset'), t('ID 创建后不可修改；显示名可随时调整。', 'The ID is immutable; the display name can be changed.'), `<label class="field">${t('显示名称', 'Display name')}<input id="new-name" maxlength="160" required></label><label class="field">${t('预设 ID', 'Preset ID')}<input id="new-id" maxlength="64" pattern="[a-z0-9][a-z0-9_-]{0,63}" required></label>${dirty() ? `<p class="source-note">${t('创建后将切换到新预设，当前未保存编辑会丢弃。', 'Creating switches to the new preset and discards current unsaved edits.')}</p>` : ''}${dialogError}`, async () => { state = await request('create', { id: $('new-id').value, name: $('new-name').value }); render(); await refreshPreview(true); });
      $('rename-preset').onclick = () => dialog(t('重命名', 'Rename'), t('修改显示名称，不影响会话绑定。', 'The preset ID and session bindings are preserved.'), `<label class="field">${t('显示名称', 'Display name')}<input id="new-name" maxlength="160" value="${esc(draft.name)}" required></label>${dialogError}`, () => save({ name: $('new-name').value.trim() }));
      async function remove(disable) {
        const references = await request('references', { id: base.id });
        dialog(disable ? t('停用预设', 'Disable preset') : t('删除预设', 'Delete preset'), references.references.length ? t(`有 ${references.references.length} 个会话将回退到「${references.fallback.name}」。`, `${references.references.length} sessions will fall back to “${references.fallback.name}”.`) : t('当前没有会话引用此预设。', 'No sessions reference this preset.'), `<p>${t('消息历史保留。已开始的会话在下次恢复时使用回退预设。', 'Message history is preserved. Started sessions use the fallback when next restored.')}</p>${dirty() ? `<p class="source-note">${t('当前未保存编辑将丢弃。', 'Current unsaved edits will be discarded.')}</p>` : ''}${dialogError}`, async () => { state = await request(disable ? 'toggle' : 'delete', { id: base.id, revision: base.revision, enabled: false, confirm: true }); render(); await refreshPreview(true); }, disable ? t('停用', 'Disable') : t('删除', 'Delete'));
      }
      $('delete-preset').onclick = () => run(() => remove(false));
      $('preset-enabled').onchange = event => { if (!event.target.checked) { event.target.checked = true; run(() => remove(true)); } else run(async () => { state = await request('toggle', { id: base.id, revision: base.revision, enabled: true }); base = clone(state.presets.find(p => p.id === draft.id)); draft.enabled = true; draft.revision = base.revision; render(false); await refreshPreview(); }); };
      $('reset-preset').onclick = () => dialog(t('恢复默认', 'Reset preset'), t('仅作用于当前预设。', 'Affects this preset only.'), `<p>${t('工具、提示词与技能将恢复初始值；名称、ID、描述和启用状态保留。', 'Reset tools, prompts and skills. The name, ID, description and enabled state are preserved.')}</p>${dialogError}`, async () => { state = await request('reset', { id: base.id, revision: base.revision }); render(); await refreshPreview(true); }, t('恢复默认', 'Reset'));
      const settings = changes => run(async () => { state = await request('settings', { changes }); scanStatus(); });
      $('auto-scan').onchange = event => settings({ polling: event.target.checked });
      $('scan-interval').onchange = event => settings({ scanInterval: Number(event.target.value) });
      $('scan-tools').onclick = () => run(async () => {
        state = await request('scan', { id: draft.id, ...context() }); tools(); scanStatus(); await refreshPreview(true);
        toast(scanSentence(true));
      });
      $('skills-all').onclick = () => { const all = [...sourceSkills.map(skill => skill.name), ...draft.skills]; const complete = all.length > 0 && all.every(name => draft.skills.includes(name)); draft.skills = complete ? [] : [...new Set(all)]; if (draft.skills.length && toolSource('skill')?.available) draft.tools.enabled = [...new Set([...draft.tools.enabled, 'skill'])]; skills(); tools(); changed(); };
      $('preview-cwd').oninput = event => { cwd = event.target.value.trim(); previewVersion++; clearTimeout(previewTimer); $('preview-open').disabled = true; $('copy-preview').disabled = true; $('preview-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-dialog-summary').textContent = t('生成预览…', 'Generating preview…'); previewTimer = setTimeout(() => refreshPreview(true), 350); };
      root.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-tab]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', String(tab === button)); }); $('pane-overview').hidden = button.dataset.tab !== 'overview'; $('pane-prompt').hidden = button.dataset.tab !== 'prompt'; }; });
      root.querySelectorAll('[data-config-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-config-tab]').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); root.querySelectorAll('.config-pane').forEach(pane => { pane.hidden = pane.id !== `config-pane-${button.dataset.configTab}`; }); if (button.dataset.configTab === 'tools') requestAnimationFrame(fitToolLists); }; });
      root.querySelectorAll('[data-compat-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-compat-tab]').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); root.querySelectorAll('.compat-pane').forEach(pane => { pane.hidden = pane.id !== `compat-pane-${button.dataset.compatTab}`; }); }; });
      $('preview-open').onclick = () => { if (preview) $('preview-dialog').showModal(); };
      $('preview-close').onclick = () => $('preview-dialog').close();
      $('preview-dialog').addEventListener('click', event => { if (event.target !== $('preview-dialog')) return; const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); });
      window.addEventListener('resize', fitToolLists);
      root.querySelectorAll('.tool-group').forEach(group => group.addEventListener('toggle', () => requestAnimationFrame(fitToolLists)));
      async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px'; root.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); if (!ok) throw Error(t('无法自动复制，请手动选择文本。', 'Select and copy the text manually.')); } }
      $('copy-preview').onclick = async () => { try { if (!preview) return; await copy(preview.displayPrompt); toast(t('已复制。', 'Copied.')); } catch (error) { report(error); } };
      $('export-open').onclick = () => {
        const selected = new Set(), all = state.presets.length > 0 && state.presets.every(preset => selected.has(preset.id));
        const boxes = state.presets.map(preset => `<label class="export-choice"><input type="checkbox" data-export-id="${esc(preset.id)}"><span class="box-check"></span><span>${esc(preset.name)}</span></label>`).join('');
        dialog(t('导出方案', 'Export presets'), t('默认不选择任何预设；可勾选一个或多个。', 'Nothing is selected by default; choose one or more presets.'), `<div class="export-select-head"><span>${t('范围', 'Scope')}</span><button type="button" class="text-button" id="export-toggle-all">${t('全选', 'Select all')}</button></div><div class="export-choices">${boxes}</div><fieldset class="field export-format" id="export-format"><legend>${t('格式', 'Format')}</legend><div class="export-format-options"><label class="export-format-option"><input type="radio" name="export-format" value="json" checked><span>JSON</span></label><label class="export-format-option"><input type="radio" name="export-format" value="yaml"><span>YAML</span></label></div></fieldset>${dialogError}`, async () => { const ids = [...root.querySelectorAll('[data-export-id]:checked')].map(input => input.dataset.exportId); if (!ids.length) throw Error(t('请至少选择一个预设。', 'Select at least one preset.')); const format = root.querySelector('[name="export-format"]:checked').value, result = await request('export', { ids, format }), url = URL.createObjectURL(new Blob([result.text], { type: format === 'json' ? 'application/json' : 'application/yaml' })), link = document.createElement('a'); link.href = url; link.download = `preset-workshop-${ids.length === state.presets.length ? 'all' : ids.length}.` + format; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, t('下载', 'Download'));
        const toggle = () => { const inputs = [...root.querySelectorAll('[data-export-id]')], checked = inputs.filter(input => input.checked).length; $('export-toggle-all').textContent = checked === inputs.length ? t('全不选', 'Clear all') : t('全选', 'Select all'); };
        $('export-toggle-all').onclick = () => { const inputs = [...root.querySelectorAll('[data-export-id]')], check = inputs.some(input => !input.checked); inputs.forEach(input => { input.checked = check; }); toggle(); };
        root.querySelectorAll('[data-export-id]').forEach(input => input.onchange = toggle);
      };
      async function importFile(payload) {
        state = await request('import', payload); render(); await refreshPreview(true);
      }
      function importConflict(payload, conflicts) {
        dialog(t('导入冲突', 'Import conflicts'), t('ID 或名称已经存在，请选择覆盖或修改冲突项。', 'IDs or names already exist. Overwrite or rename the conflicting presets.'), `<div class="actions"><button type="button" id="import-overwrite">${t('直接覆盖', 'Overwrite')}</button><button type="button" id="import-rename">${t('修改 ID 与名称', 'Rename IDs and names')}</button></div><div id="import-renames" hidden>${conflicts.map(row => `<div class="import-conflict-row" data-import-index="${row.index}"><label class="field">${t('预设 ID', 'Preset ID')}<input class="rename-id" value="${esc(row.importedId)}" maxlength="64" pattern="[a-z0-9][a-z0-9_-]{0,63}"></label><label class="field">${t('名称', 'Name')}<input class="rename-name" value="${esc(row.importedName)}" maxlength="160"></label></div>`).join('')}</div>${dialogError}`, async () => {
          const renames = [...root.querySelectorAll('[data-import-index]')].map(row => ({ index: Number(row.dataset.importIndex), id: row.querySelector('.rename-id').value.trim(), name: row.querySelector('.rename-name').value.trim() }));
          await importFile({ ...payload, mode: 'rename', renames });
        }, t('重命名并导入', 'Rename and import'));
        $('dialog-save').hidden = true;
        $('import-rename').onclick = () => { $('import-renames').hidden = false; $('dialog-save').hidden = false; };
        $('import-overwrite').onclick = async () => {
          if (dialogPending) return;
          dialogPending = true; $('import-overwrite').disabled = true;
          try { await importFile({ ...payload, mode: 'overwrite', revisions: Object.fromEntries(conflicts.flatMap(row => row.matches).map(row => [row.id, row.revision])) }); dialogPending = false; closeDialog(); }
          catch (error) { $('dialog-error').textContent = error.message; }
          finally { dialogPending = false; $('import-overwrite').disabled = false; }
        };
      }
      const openImport = () => {
        let payload, readVersion = 0;
        dialog(t('导入方案', 'Import presets'), t('选择 Preset Workshop 的 JSON / YAML 导出文件。', 'Choose a Preset Workshop JSON / YAML export file.'), `<label class="field">${t('选择文件', 'Choose file')}<input id="import-file" type="file" accept=".json,.yaml,.yml" required></label>${dialogError}`, async () => {
          if (!payload) throw Error(t('请先选择文件。', 'Choose a file first.'));
          try { await importFile(payload); }
          catch (error) { if (error.code !== 'import-conflict') throw error; dialogPending = false; closeDialog(); setTimeout(() => importConflict(payload, error.details.conflicts), 0); }
        }, t('导入', 'Import'));
        $('import-file').onchange = async event => {
          const version = ++readVersion;
          try {
            payload = undefined;
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) throw Error(t('文件不能超过 8 MiB。', 'File exceeds 8 MiB.'));
            const text = await file.text();
            if (version !== readVersion) return;
            payload = { mode: 'new', format: /\.ya?ml$/i.test(file.name) ? 'yaml' : 'json', text };
            $('dialog-error').textContent = '';
          } catch (error) { if (version === readVersion) $('dialog-error').textContent = error.message; }
        };
      };
      $('import-open').onclick = () => {
        if (!dirty()) return openImport();
        dialog(t('导入方案', 'Import presets'), t('当前有未保存修改。', 'There are unsaved changes.'), `<p>${t('继续导入会丢弃当前未保存编辑。', 'Continuing will discard the current unsaved edits.')}</p>`, () => { setTimeout(openImport, 0); }, t('丢弃并继续', 'Discard and continue'));
      };
      localize();
      render(); await refreshPreview(true);
      const offLocale = ctx.locale.subscribe(() => { english = ctx.locale.getSnapshot().active?.startsWith('en') ?? false; localize(); render(false); renderPreview(); });
      // Host owns automatic scanning. Poll only its snapshot, never duplicate scans.
      timer = setInterval(async () => { if (busy || dialogPending || signal.aborted) return; try { const snapshot = await request('snapshot'); const changedAt = snapshot.catalog.scannedAt !== state.catalog.scannedAt || snapshot.catalog.revision !== state.catalog.revision || snapshot.sourcesVersion !== state.sourcesVersion || (sessionId && snapshot.sessions.find(session => session.id === sessionId)?.contextVersion !== state.sessions.find(session => session.id === sessionId)?.contextVersion); state = snapshot; renderContextOptions(); if (changedAt) { tools(); scanStatus(); await refreshPreview(true); } } catch (error) { report(error); } }, 5000);
      return () => { offLocale(); clearInterval(timer); clearTimeout(previewTimer); clearTimeout(toastTimer); scrollTimers.forEach(clearTimeout); root.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', fitToolLists); $('editor-dialog').close(); $('preview-dialog').close(); };
    }
    function installNavIcon(ctx, label) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
      // DSH rc.2 has no slot icon field. Like dshmarket, mark only our own
      // localized navigation row; remove this bridge when the host adds one.
      ctx.effect(() => {
        const marker = 'data-preset-workshop-nav-icon', style = document.createElement('style');
        style.textContent = `[${marker}]>svg{display:none}[${marker}]::before{content:"";flex:none;width:18px;height:18px;background:currentColor;mask:url("/preset-workshop/icon.png") center/contain no-repeat;-webkit-mask:url("/preset-workshop/icon.png") center/contain no-repeat}`;
        document.head.append(style);
        let scheduled = false, disposed = false;
        const sync = () => {
          scheduled = false;
          if (disposed) return;
          const wanted = String(label() || '').trim();
          for (const row of document.querySelectorAll('[role="dialog"] nav button')) {
            if (wanted && row.textContent.trim() === wanted) row.setAttribute(marker, '');
            else row.removeAttribute(marker);
          }
        };
        const observer = new MutationObserver(() => { if (!scheduled && !disposed) { scheduled = true; queueMicrotask(sync); } });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        sync();
        return () => { disposed = true; observer.disconnect(); document.querySelectorAll(`[${marker}]`).forEach(row => row.removeAttribute(marker)); style.remove(); };
      });
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: { nav: '预设工坊' }, en: { nav: 'Preset Workshop' } }));
      const title = ctx.locale.bind(NS);
      installNavIcon(ctx, () => title('nav'));
      function WorkshopCard() {
        const ref = React.useRef();
        React.useEffect(() => {
          const root = ref.current.shadowRoot || ref.current.attachShadow({ mode: 'open' }), controller = new AbortController();
          let dispose;
          root.innerHTML = '<p style="padding:16px">Loading Preset Workshop…</p>';
          mount(root, ctx, controller.signal).then(cleanup => { if (controller.signal.aborted) cleanup(); else dispose = cleanup; }).catch(error => { if (!controller.signal.aborted) { root.textContent = error.message; const button = document.createElement('button'); button.textContent = 'Retry / 重试'; button.onclick = () => location.reload(); root.append(button); } });
          return () => { controller.abort(); dispose?.(); };
        }, []);
        return React.createElement('div', { ref, style: { minWidth: 0, width: '100%' } });
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-preset-workshop', order: 50, label: () => title('nav'), locale: NS }, WorkshopCard));
    }
    return { inject: ['slots', 'locale'], apply };
  },
});
