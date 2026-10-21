// Native DSH client module; React is supplied by the host. No build step.
window.__ModuleLoader__.load({
  id: 'dsh-preset-workshop',
  factory: require => {
    const React = require('react');
    const NS = 'preset-workshop';
    const BUILTINS = ['bash', 'read', 'edit', 'write', 'web_search', 'web_fetch', 'ask_user_question', 'todo_write'];
    const AGENT = 'workshop:agent-instructions';
    const DIRECTORY_AGENT = 'workshop:directory-instructions';
    const names = { ask_user_question: 'ask', todo_write: 'todo' };
    const toolIcons = { bash: 'terminal', pwsh: 'terminal', read: 'file', edit: 'edit', write: 'file-plus', web_search: 'globe', web_fetch: 'globe', ask_user_question: 'chat', subagent: 'agent', todo_write: 'jobs', glob: 'search', grep: 'search', skill: 'skill', present: 'present', job_list: 'jobs', job_output: 'jobs', job_kill: 'jobs', subagent_fork: 'agent' };
    const clone = value => structuredClone(value);
    const equal = (a, b) => a === b || Boolean(a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key])));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const staticCopy = {
      '预设工坊': 'Preset Workshop', '让每一个 Agent 都有自己的工作方式。': 'Give every Agent its own way of working.',
      '导入': 'Import', '导出': 'Export', '预设方案': 'Presets', '已保存': 'Saved', '预设 ID': 'Preset ID',
      '新建': 'New', '重命名': 'Rename', '启用': 'Enabled', '删除': 'Delete', '描述': 'Description',
      '回退目标': 'Fallback preset', '恢复默认': 'Reset', '保存方案': 'Save preset', '系统提示词': 'System prompt',
      '扫描': 'Scan', '自动扫描': 'Auto scan', '上次扫描：': 'Last scan: ', '尚未扫描': 'Not scanned yet',
      '每': 'Every', '秒': 'seconds', '人设': 'Persona', '变量': 'Variables', '只读 · 实际值': 'Read only · Actual values',
      '拼接': 'Supplemental instructions', '取消': 'Cancel', '保存': 'Save', '工具': 'Tools', '内置': 'Built in',
      '可选': 'Optional', '官方': 'Official', '第三方': 'Third party', '工具说明随开关同步更新': 'Tool instructions follow tool visibility',
      '技能绑定': 'Skills', '未绑定技能': 'No skills selected', '检测到的技能': 'Discovered skills', '全开': 'Select all', '全不开': 'Clear all',
      '绑定技能时同步开启 skill 工具；可在工具区手动关闭。': 'Selecting skills also enables the skill tool; you can turn it off in Tools.',
      '预览': 'Preview', '展开预览': 'Expand preview', '预览环境': 'Preview context', '工作目录': 'Working directory',
      '工具与技能': 'Tools and skills', '最终提示词': 'Final prompt', '复制提示词': 'Copy prompt',
      '工具仅展示顶层描述；AGENT、环境策略和技能目录通过 User 消息注入。预览不含实际用户消息；token 为字符数估算。': 'Tools show top-level descriptions. AGENT, runtime policy and skills enter as User messages. User messages are placeholders; tokens are character-based estimates.',
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
        $('tools-count').textContent = t(`已启用 ${preview?.tools.length ?? draft.tools.enabled.length} 个工具`, `${preview?.tools.length ?? draft.tools.enabled.length} tools enabled`);
        $('skills-summary').textContent = draft.skills.length ? t(`已绑定 ${draft.skills.length} 个技能`, `${draft.skills.length} skills selected`) : t('未绑定技能', 'No skills selected');
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
        const at = state.catalog.scannedAt, count = state.catalog.tools.filter(tool => tool.available).length;
        $('scan-result').textContent = t(`扫描发现 ${count} 个工具`, `${count} tools discovered`);
        $('scan-time').textContent = at ? new Date(at).toLocaleString(english ? 'en-US' : 'zh-CN', { hour12: false }) : t('尚未扫描', 'Not scanned yet');
        $('scan-time').dateTime = at || '';
      }
      function toolEnabled(tool) { return tool.light === false ? draft.tools.packages.includes(tool.package) : draft.tools.enabled.includes(tool.name); }
      function toolCard(tool) {
        return `<div class="tool-card${toolEnabled(tool) ? '' : ' off'}">${icon(toolIcons[tool.name] || 'box')}<div class="tool-info"><div class="tool-name" title="${esc(tool.name)}">${esc(names[tool.name] || tool.name)}</div>${tool.schema ? `<button class="text-button" data-description="${esc(tool.name)}">${t('工具描述', 'Description')} ${icon('chevron')}</button>` : ''}${!tool.available ? `<span class="unavailable">${t('不可用', 'Unavailable')}</span>` : ''}</div><label class="switch"><input type="checkbox" data-tool="${esc(tool.name)}" aria-label="${esc(t('启用 ', 'Enable ') + tool.name)}" ${toolEnabled(tool) ? 'checked' : ''} ${!tool.available ? 'disabled' : ''}><span class="track"></span></label></div>`;
      }
      const toolSource = name => preview?.catalog.find(tool => tool.name === name) || state.catalog.tools.find(tool => tool.name === name);
      function tools() {
        const all = state.catalog.tools.map(tool => toolSource(tool.name)), builtinNames = [all.some(tool => tool.name === 'pwsh' && tool.available) && !all.some(tool => tool.name === 'bash' && tool.available) ? 'pwsh' : 'bash', ...BUILTINS.slice(1)], official = all.filter(tool => !builtinNames.includes(tool.name) && tool.kind !== 'thirdparty'), third = all.filter(tool => !builtinNames.includes(tool.name) && tool.kind === 'thirdparty');
        $('builtin-tools').innerHTML = builtinNames.map(name => all.find(tool => tool.name === name)).filter(Boolean).map(toolCard).join('');
        $('official-tools').innerHTML = official.map(toolCard).join('');
        $('thirdparty-tools').className = third.length ? 'tools-grid bounded-list' : 'bounded-list';
        $('thirdparty-tools').innerHTML = third.length ? third.map(toolCard).join('') : `<div class="empty-state">${icon('box')}<span>${t('未发现第三方工具', 'No third-party tools detected')}</span></div>`;
        // Undiscovered heavy tools are selected by package, without guessing their tool names.
        for (const pkg of state.catalog.packages.filter(pkg => !pkg.light && !all.some(tool => tool.package === pkg.name))) {
          $('official-tools').insertAdjacentHTML('beforeend', `<div class="tool-card${draft.tools.packages.includes(pkg.name) ? '' : ' off'}">${icon('box')}<div class="tool-info"><div class="tool-name" title="${esc(pkg.name)}">${esc(pkg.name.replace('@deepseek-ai/dsh-tool-', ''))}</div><small class="${pkg.error ? 'unavailable' : 'muted'}">${esc(pkg.error || t('启用后检测工具', 'Discover tools on enable'))}</small></div><label class="switch"><input type="checkbox" data-package="${esc(pkg.name)}" aria-label="${esc(t('启用 ', 'Enable ') + pkg.name)}" ${draft.tools.packages.includes(pkg.name) ? 'checked' : ''} ${!pkg.available || pkg.error ? 'disabled' : ''}><span class="track"></span></label></div>`);
        }
      }
      function skills() {
        const all = [...sourceSkills];
        for (const name of draft.skills) if (!all.some(skill => skill.name === name)) all.push({ name, description: t('未在当前目录发现；保存的绑定仍保留。', 'Not found in this directory; the saved selection is preserved.') });
        $('skill-list').innerHTML = all.length ? all.map(skill => `<div class="skill-row">${icon('skill')}<div class="skill-copy"><p>${esc(skill.name)}</p><small class="skill-description" title="${esc(skill.description)}">${esc(skill.description)}</small><button type="button" class="text-button" data-skill-detail="${esc(skill.name)}">${t('查看详细', 'View details')} ${icon('chevron')}</button></div><label class="switch"><input type="checkbox" data-skill="${esc(skill.name)}" aria-label="${esc(t('绑定 ', 'Select ') + skill.name)}" ${draft.skills.includes(skill.name) ? 'checked' : ''}><span class="track"></span></label></div>`).join('') : `<div class="empty-state">${icon('skill')}<span>${t('未发现技能', 'No skills detected')}</span></div>`;
        if (!completeSkills) $('skill-list').insertAdjacentHTML('beforeend', `<p class="unavailable">${t('技能目录扫描尚未完整，现有选择已保留。', 'Skill discovery is incomplete. Existing selections are preserved.')}</p>`);
      }
      function supplemental() {
        const actual = (preview?.editableSections || []).filter(section => section.managedBy !== 'tools');
        const items = actual.filter(section => !section.custom || draft.prompt.sections[section.name]).map(section => {
          const edit = draft.prompt.sections[section.name];
          return { ...section, ...(section.managedBy === 'tool-guidance' ? edit ? { order: edit.order, enabled: edit.enabled } : {} : edit || {}) };
        });
        for (const [name, section] of Object.entries(draft.prompt.sections)) if (section.custom && !items.some(item => item.name === name)) items.push({ name, ...section });
        return items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      }
      function sections() {
        const items = supplemental(), agent = preview?.agentInstructions;
        const row = (section, isAgent) => {
          const directory = section.name === DIRECTORY_AGENT, guidance = section.managedBy === 'tool-guidance';
          const name = isAgent ? (agent.directoryText ? t('AGENT［全局］', 'AGENT [Global]') : 'AGENT') : directory ? t('AGENT［目录］', 'AGENT [Directory]') : section.name === 'deployment:persona-suffix' ? t('工作目录', 'Working directory') : guidance ? t('工具使用指令', 'Tool usage guidance') : section.name.replace(/\.md$/i, ''), host = directory;
          const editable = isAgent ? agent.editable : section.editable !== false && !host, reorderable = !isAgent && !host && section.reorderable !== false;
          return `<div class="detected-row" data-section-id="${esc(section.name)}" ${reorderable ? `draggable="true" data-drag-section="${esc(section.name)}"` : ''}><div class="detected-source">${reorderable ? `<button type="button" class="drag-handle" title="${t('拖动排序；方向键可上移或下移', 'Drag to reorder; arrow keys move up or down')}" aria-label="${esc(t('调整顺序：', 'Reorder: ') + name)}">${icon('grip')}</button>` : icon('file')}<div class="detected-label"><span class="detected-name">${esc(name)}</span>${guidance ? `<small class="source-note">${t('随启用工具动态更新', 'Updates with enabled tools')}</small>` : isAgent || directory ? `<small class="source-note">${directory ? t('宿主自动载入 · 只读', 'Loaded by the host · Read only') : t('User 级会话上下文', 'User-level conversation context')}</small>` : section.custom ? `<small class="source-note">${t('自定义 · System 级', 'Custom · System level')}</small>` : ''}</div></div><div class="actions"><button type="button" class="section-action" data-section-preview="${esc(section.name)}">${icon('eye')}${t('预览', 'Preview')}</button>${editable ? `<button type="button" class="section-action" data-section-edit="${esc(section.name)}">${icon('edit')}${t('编辑', 'Edit')}</button><label class="switch"><input type="checkbox" data-section-enabled="${esc(section.name)}" aria-label="${esc(t('启用 ', 'Enable ') + name)}" ${section.enabled ? 'checked' : ''}><span class="track"></span></label>` : ''}</div></div>`;
        };
        $('section-list').innerHTML = items.map(section => row(section, false)).join('') + (agent ? row({ ...agent, ...(draft.prompt.sections[AGENT] || {}) }, true) : '');
        if (agent?.directoryText) $('section-list').insertAdjacentHTML('beforeend', row({ name: DIRECTORY_AGENT, text: agent.directoryText, editable: false, reorderable: false }, false));
        if (state.proxyInjection) $('section-list').insertAdjacentHTML('beforeend', `<p class="source-note proxy-note">${esc(t('部分插件是在代理转发层注入提示词指令（如billion-context），未向 DSH 暴露读取或覆盖接口；此层不包含在工坊预览中。', 'Some plugins inject prompt instructions in their proxy (e.g. billion-context), without a DSH read/override interface. That layer is outside this preview.'))}</p>`);
        if (!items.some(section => !section.managedBy)) $('section-list').insertAdjacentHTML('beforeend', `<div class="empty-state">${icon('box')}<span>${t('未发现插件注入提示词', 'No injected prompt sections detected')}</span></div>`);
      }
      function renderPreview() {
        if (!preview) return;
        $('preview-summary').textContent = t(`${preview.tools.length} 个工具 · ${preview.skills.length} 个技能 · 约 ${preview.estimatedTokens.toLocaleString()} tokens`, `${preview.tools.length} tools · ${preview.skills.length} skills · ~${preview.estimatedTokens.toLocaleString()} tokens`);
        $('preview-prompt').textContent = preview.displayPrompt;
        const pending = state.sessions.filter(session => session.preset === draft.id && session.pendingTools?.length), selectedPending = preview.runtime?.pendingTools || [];
        $('runtime-note').hidden = !pending.length && !selectedPending.length;
        $('runtime-note').textContent = t(`预览为当前方案。${pending.length} 个已开始会话尚未挂载新增或替换工具；关闭并恢复会话后才能使用：${[...new Set([...pending.flatMap(session => session.pendingTools), ...selectedPending])].join('、')}。人设、已有工具过滤与描述、技能选择在下一次请求更新。`, `This preview shows the current preset. ${pending.length} started sessions have not mounted new or replaced tools; close and restore them to use: ${[...new Set([...pending.flatMap(session => session.pendingTools), ...selectedPending])].join(', ')}. Persona, existing-tool filters/descriptions and skill selections update on the next request.`);
        $('runtime-tools').hidden = !preview.runtime;
        $('runtime-tools').textContent = preview.runtime ? t('所选会话实际工具：', 'Actual tools in the selected session: ') + preview.runtime.tools.map(tool => tool.function.name).join('、') : '';
        $('pane-overview').innerHTML = `<h3>${t('启用的工具', 'Enabled tools')}</h3><div class="chips">${preview.tools.map(tool => `<span class="chip mono">${esc(tool.function.name)}</span>`).join('') || `<span class="muted">${t('尚未启用工具', 'No tools enabled')}</span>`}</div><h3 style="margin-top:12px">${t('绑定的技能', 'Selected skills')}</h3><div class="chips">${preview.skills.map(skill => `<span class="chip">${esc(skill.name)}</span>`).join('') || `<span class="muted">${t('尚未绑定技能', 'No skills selected')}</span>`}</div>${draft.skills.length && !preview.skillCatalog.length ? `<p class="source-note">${preview.tools.some(tool => tool.function.name === 'skill') ? t('所选技能目录尚未发布，请查看技能来源与扫描诊断。', 'The selected skill catalog is unavailable; check source and discovery diagnostics.') : t('尚未开启 skill 工具，技能摘要不会自动发布。', 'The skill tool is disabled, so its catalog is not automatically published.')}</p>` : ''}`;
        $('variable-list').innerHTML = Object.entries(preview.variables).map(([key, value]) => `<div class="variable-row"><code>{{${esc(key)}}}</code><span>${esc(value ?? t('当前未定义', 'Currently undefined'))}</span></div>`).join('');
        if (!cwd) { cwd = preview.cwd; $('preview-cwd').value = cwd; }
      }
      async function refreshPreview(withSkills = false) {
        const version = ++previewVersion, id = draft.id, input = { id, draft: clone(draft), ...context() };
        $('preview-summary').textContent = t('生成预览…', 'Generating preview…');
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
          renderPreview(); sections(); tools(); skills(); status();
        } catch (error) {
          if (version !== previewVersion || signal.aborted) return;
          preview = undefined; $('preview-prompt').textContent = ''; $('preview-summary').textContent = t('预览失败', 'Preview failed'); report(error); status();
          }
        });
        return previewQueue;
      }
      function changed() { previewVersion++; clearTimeout(previewTimer); status(); $('copy-preview').disabled = true; $('preview-summary').textContent = t('生成预览…', 'Generating preview…'); previewTimer = setTimeout(() => refreshPreview(), 350); }
      function renderContextOptions() {
        if (!state.sessions.some(session => session.id === sessionId)) sessionId = '';
        const current = state.sessions.find(session => session.id === sessionId), key = session => [session.cwd, session.provider, session.model, session.permissions?.sandbox, session.permissions?.approval].join('\0'), contexts = [...new Map(state.sessions.map(session => [key(session), session])).values()];
        $('preview-context').innerHTML = `<span class="choice-name">${esc(current ? (current.cwd || t('会话环境', 'Session context')) : t('默认模型与指定目录', 'Default model and chosen directory'))}</span>${icon('down')}`;
        $('preview-context-menu').innerHTML = [{ id: '', cwd: t('默认模型与指定目录', 'Default model and chosen directory') }, ...contexts].map(session => `<button type="button" class="select-option context-option" data-context-session="${esc(session.id)}" role="option" aria-selected="${current ? key(session) === key(current) : !session.id}"><span class="choice-name">${esc(session.cwd)}${session.model ? `<small>${esc(session.provider || '')} · ${esc(session.model)}${session.permissions?.sandbox ? ' · ' + esc(session.permissions.sandbox) + ' / ' + esc(session.permissions.approval || '') : ''}</small>` : ''}</span></button>`).join('');
        $('preview-cwd').readOnly = Boolean(sessionId); $('preview-cwd').value = current ? current.cwd || '' : cwd;
      }
      function render(reset = true) {
        if (reset) { base = clone(selected()); draft = clone(base); preview = undefined; }
        pickers(); $('preset-id').value = draft.id; $('preset-description').value = draft.description; $('persona').value = draft.prompt.persona;
        $('preset-enabled').checked = draft.enabled; $('preset-enabled').disabled = draft.builtin; $('delete-preset').disabled = draft.builtin;
        tools(); skills(); sections(); scanStatus(); status(); renderContextOptions();
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
      function dialog(title, subtitle, body, handler, label = t('保存', 'Save')) {
        $('dialog-title').textContent = title; $('dialog-subtitle').textContent = subtitle; $('dialog-body').innerHTML = body;
        $('dialog-save').textContent = label; $('dialog-save').hidden = false; $('dialog-cancel').hidden = false; submit = handler; closePickers(); $('editor-dialog').showModal();
      }
      function closeDialog() { if (dialogPending) return; $('editor-dialog').close(); submit = undefined; }
      $('editor-dialog').addEventListener('cancel', event => { if (dialogPending) event.preventDefault(); });
      $('dialog-close').onclick = closeDialog; $('dialog-cancel').onclick = closeDialog;
      $('editor-dialog').addEventListener('close', () => { submit = undefined; });
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
        const section = id === AGENT ? { ...preview.agentInstructions, ...(draft.prompt.sections[AGENT] || {}) } : id === DIRECTORY_AGENT ? { text: preview.agentInstructions.directoryText, editable: false } : supplemental().find(item => item.name === id);
        if (!section) return;
        if (edit && (section.editable === false || section.managedBy === 'host')) return;
        const name = id === AGENT ? 'AGENT' : id === DIRECTORY_AGENT ? t('AGENT［目录］', 'AGENT [Directory]') : id === 'deployment:persona-suffix' ? t('工作目录', 'Working directory') : id === 'workshop:tool-guidance' ? t('工具使用指令', 'Tool usage guidance') : id.replace(/\.md$/i, '');
        const guidance = id === 'workshop:tool-guidance';
        const editor = guidance ? section.members.map((member, index) => `<label class="field">${esc(member.name)}<textarea class="guidance-editor" data-guidance-member="${index}" spellcheck="false" maxlength="200000">${esc(draft.prompt.sections[member.name]?.text ?? member.text)}</textarea></label>`).join('') : `<textarea class="section-modal-editor" id="section-content" spellcheck="false" maxlength="200000" aria-label="${esc(name)}">${esc(section.text)}</textarea>`;
        dialog((edit ? t('编辑 ', 'Edit ') : t('预览 ', 'Preview ')) + name, id === AGENT ? t('官方全局 AGENTS.md · 仅覆盖当前预设，保留项目与子目录指令，不修改原文件。', 'Official global AGENTS.md. Edits affect this preset only; project/subdirectory instructions and source files are preserved.') : id === DIRECTORY_AGENT ? t('宿主自动载入当前目录的指令；不与 System 段排序。', 'The host loads directory instructions automatically; they are not System sections.') : guidance ? t('逐段编辑原生工具指令；工具切换时仍会动态增减，工具描述单独管理。', 'Edit native tool instructions individually. Sections still follow tool visibility; schema descriptions are managed separately.') : t('System 级文本；保存后按此顺序生效。', 'System-level text. Save to apply its order.'), edit ? editor + `${section.custom ? `<button type="button" class="text-button danger" id="delete-section">${icon('trash')}${t('删除此内容', 'Delete content')}</button>` : ''}<p id="dialog-error" class="error-message" role="alert"></p>` : `<pre class="preview-code section-preview">${esc((section.renderedText ?? section.text) || t('当前没有内容。', 'No content currently.'))}</pre>`, () => { if (edit) {
          if (guidance) root.querySelectorAll('[data-guidance-member]').forEach(el => { const member = section.members[Number(el.dataset.guidanceMember)]; draft.prompt.sections[member.name] = { text: el.value, order: member.order, enabled: draft.prompt.sections[member.name]?.enabled ?? true }; });
          draft.prompt.sections[id] = { ...(section.custom ? { custom: true } : {}), text: guidance ? '' : $('section-content').value, order: section.order, enabled: section.enabled }; sections(); changed();
        } }, edit ? t('完成', 'Done') : t('关闭', 'Close'));
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
        dialog(t('工具描述', 'Tool description'), name, `<p class="risk risk-inline">${icon('notice')}<span>${t('请确保您了解 AI 与提示词的机制，否则请不要修改；您的任何修改导致的后果由您个人承担。', 'Only edit if you understand AI and prompts. You are responsible for the consequences.')}</span></p><textarea class="json-editor" id="tool-json" spellcheck="false" aria-label="${esc(name)} JSON" aria-describedby="dialog-error">${esc(JSON.stringify(schema, null, 2))}</textarea><div class="json-tools"><span class="muted">${t('如果您想调整描述，建议仅修改 description，名称和参数结构保持不变。避免出现兼容问题', 'To adjust descriptions, edit description fields only and keep names and parameter structure unchanged to avoid compatibility issues.')}</span><button type="button" class="text-button" id="format-json">${t('格式化', 'Format')}</button></div><p class="error-message" id="dialog-error" role="alert" aria-live="assertive"></p>`, async () => {
          let value; try { value = JSON.parse($('tool-json').value); } catch (error) { throw Error(t('JSON 格式有误：', 'Invalid JSON: ') + error.message); }
          const tools = clone(base.tools); tools.overrides[name] = { schema: value };
          // Server validates against the selected source's original schema.
          return save({ tools }, name);
        });
        $('format-json').onclick = () => { try { $('tool-json').value = JSON.stringify(JSON.parse($('tool-json').value), null, 2); $('dialog-error').textContent = ''; $('tool-json').removeAttribute('aria-invalid'); } catch (error) { $('dialog-error').textContent = error.message; $('tool-json').setAttribute('aria-invalid', 'true'); } };
      }
      root.addEventListener('input', event => { if (event.target.id === 'tool-json') { $('dialog-error').textContent = ''; event.target.removeAttribute('aria-invalid'); } });
      async function select(id) { state = await request('settings', { changes: { selectedPresetId: id } }); render(); await refreshPreview(true); }
      root.addEventListener('click', event => {
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
        if (button?.dataset.description) openTool(button.dataset.description);
        if (button?.dataset.sectionPreview) openSection(button.dataset.sectionPreview, false);
        if (button?.dataset.sectionEdit) openSection(button.dataset.sectionEdit, true);
        if (button?.dataset.skillDetail) run(() => openSkill(button.dataset.skillDetail));
      });
      root.querySelectorAll('.select-card').forEach(picker => picker.addEventListener('toggle', () => { picker.querySelector('summary').setAttribute('aria-expanded', String(picker.open)); if (picker.open) root.querySelectorAll('.select-card').forEach(other => { if (other !== picker) other.open = false; }); }));
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape') closePickers();
        const picker = event.target.closest('.select-card');
        if (picker && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); picker.open = true; const all = [...picker.querySelectorAll('.select-option')], index = all.indexOf(root.activeElement); all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
        const handle = event.target.closest('[data-drag-section]');
        if (handle && event.target.closest('.drag-handle') && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const items = supplemental().filter(s => s.reorderable !== false && s.managedBy !== 'host'), index = items.findIndex(s => s.name === handle.dataset.dragSection), next = index + (event.key === 'ArrowUp' ? -1 : 1); if (items[next]) { move(items[index].name, items[next].name, next < index); root.querySelector(`[data-drag-section="${CSS.escape(handle.dataset.dragSection)}"] .drag-handle`)?.focus(); } }
      });
      root.addEventListener('change', event => {
        const el = event.target;
        if (el.dataset.tool) { const tool = toolSource(el.dataset.tool); if (!tool) return; const key = tool.light === false ? 'packages' : 'enabled', name = tool.light === false ? tool.package : tool.name; draft.tools[key] = el.checked ? [...new Set([...draft.tools[key], name])] : draft.tools[key].filter(x => x !== name); tools(); changed(); }
        if (el.dataset.package) { draft.tools.packages = el.checked ? [...new Set([...draft.tools.packages, el.dataset.package])] : draft.tools.packages.filter(x => x !== el.dataset.package); tools(); changed(); }
        if (el.dataset.skill) { draft.skills = el.checked ? [...new Set([...draft.skills, el.dataset.skill])] : draft.skills.filter(x => x !== el.dataset.skill); if (el.checked && toolSource('skill')?.available) draft.tools.enabled = [...new Set([...draft.tools.enabled, 'skill'])]; tools(); changed(); }
        if (el.dataset.sectionEnabled) { const id = el.dataset.sectionEnabled, section = id === AGENT ? { ...preview.agentInstructions, ...(draft.prompt.sections[AGENT] || {}) } : supplemental().find(s => s.name === id); draft.prompt.sections[id] = { ...(section.custom ? { custom: true } : {}), text: id === 'workshop:tool-guidance' ? '' : section.text, order: section.order, enabled: el.checked }; changed(); }
      });
      function move(source, target, before) {
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
      $('section-list').addEventListener('dragstart', event => { const row = event.target.closest('[data-drag-section]'); if (!row) return; dragged = row.dataset.dragSection; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragged); const rect = row.getBoundingClientRect(); event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top); });
      $('section-list').addEventListener('dragover', event => { const row = event.target.closest('[data-section-id]'); if (dragged && row && row.dataset.sectionId !== AGENT) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
      $('section-list').addEventListener('drop', event => { const row = event.target.closest('[data-section-id]'); if (dragged && row && row.dataset.sectionId !== AGENT) { event.preventDefault(); move(dragged, row.dataset.sectionId, event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2); } dragged = undefined; });
      $('section-list').addEventListener('dragend', () => { dragged = undefined; });
      $('persona').oninput = event => { draft.prompt.persona = event.target.value; changed(); };
      $('preset-description').oninput = event => { draft.description = event.target.value; status(); };
      $('save-preset').onclick = () => run(() => save({ name: draft.name, description: draft.description, prompt: draft.prompt, tools: draft.tools, skills: draft.skills }));
      $('save-prompt').onclick = () => run(() => save({ prompt: draft.prompt }));
      $('cancel-prompt').onclick = () => { draft.prompt = clone(base.prompt); $('persona').value = draft.prompt.persona; changed(); refreshPreview(); };
      const dialogError = '<p id="dialog-error" class="error-message" role="alert"></p>';
      $('add-section').onclick = () => dialog(t('新建内容', 'New content'), t('添加可排序的 System 级文本；不会修改其他插件或 AGENT。', 'Add sortable System-level text to this preset.'), `<label class="field">${t('名称', 'Name')}<input id="new-section-name" maxlength="256" required></label><label class="field">${t('内容', 'Content')}<textarea class="section-modal-editor" id="section-content" maxlength="200000" required></textarea></label>${dialogError}`, () => {
        const name = $('new-section-name').value.trim();
        if (!name || /[\x00-\x1f\x7f]/.test(name) || name.startsWith('tool:') || ['__proto__', 'constructor', 'prototype', 'workshop:agent-instructions', 'workshop:directory-instructions', 'workshop:tool-guidance', 'preset-workshop:persona', 'harness:identity', 'deployment:persona-prefix'].includes(name) || supplemental().some(section => section.name === name) || Object.hasOwn(draft.prompt.sections, name)) throw Error(t('名称为空、已被占用或属于保留名称，请换一个。', 'Choose a nonempty, unique, nonreserved name.'));
        draft.prompt.sections[name] = { text: $('section-content').value, order: Math.max(0, ...supplemental().map(section => section.order)) + 100, enabled: true, custom: true }; sections(); changed();
      }, t('添加', 'Add'));
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
        const count = state.catalog.counts;
        toast(t(`扫描完成：${count.tools} 个工具、${count.promptSections} 个提示词段、${count.skills} 个技能${count.complete ? '' : '（技能扫描未完整）'}。`, `Scan complete: ${count.tools} tools, ${count.promptSections} prompt sections, ${count.skills} skills${count.complete ? '' : ' (skill discovery incomplete)'}.`));
      });
      $('skills-all').onclick = () => { draft.skills = [...new Set([...draft.skills, ...sourceSkills.map(skill => skill.name)])]; if (draft.skills.length && toolSource('skill')?.available) draft.tools.enabled = [...new Set([...draft.tools.enabled, 'skill'])]; skills(); tools(); changed(); };
      $('skills-none').onclick = () => { draft.skills = []; skills(); changed(); };
      $('preview-cwd').oninput = event => { cwd = event.target.value.trim(); previewVersion++; clearTimeout(previewTimer); $('copy-preview').disabled = true; previewTimer = setTimeout(() => refreshPreview(true), 350); };
      root.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-tab]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', String(tab === button)); }); $('pane-overview').hidden = button.dataset.tab !== 'overview'; $('pane-prompt').hidden = button.dataset.tab !== 'prompt'; }; });
      async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px'; root.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); if (!ok) throw Error(t('无法自动复制，请手动选择文本。', 'Select and copy the text manually.')); } }
      $('copy-preview').onclick = async () => { try { if (!preview) return; await copy(preview.displayPrompt); toast(t('已复制。', 'Copied.')); } catch (error) { report(error); } };
      $('export-open').onclick = () => dialog(t('导出方案', 'Export presets'), t('导出已保存的预设；请先保存需要导出的修改。', 'Exports saved presets. Save pending edits first.'), `<label class="field">${t('范围', 'Scope')}<select id="export-scope"><option value="current">${t('仅当前预设', 'Current preset')}</option><option value="all">${t('全部预设', 'All presets')}</option></select></label><label class="field">${t('格式', 'Format')}<select id="export-format"><option value="json">JSON</option><option value="yaml">YAML</option></select></label>${dialogError}`, async () => { const format = $('export-format').value, all = $('export-scope').value === 'all', result = await request('export', { id: base.id, all, format }), url = URL.createObjectURL(new Blob([result.text], { type: format === 'json' ? 'application/json' : 'application/yaml' })), link = document.createElement('a'); link.href = url; link.download = (all ? 'preset-workshop-all' : base.id) + '.' + format; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, t('下载', 'Download'));
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
      $('import-open').onclick = () => {
        let payload;
        dialog(t('导入方案', 'Import presets'), t('选择 Preset Workshop 的 JSON / YAML 导出文件。', 'Choose a Preset Workshop JSON / YAML export file.'), `<label class="field">${t('选择文件', 'Choose file')}<input id="import-file" type="file" accept=".json,.yaml,.yml" required></label>${dialogError}`, async () => {
          if (!payload) throw Error(t('请先选择文件。', 'Choose a file first.'));
          try { await importFile(payload); }
          catch (error) { if (error.code !== 'import-conflict') throw error; dialogPending = false; closeDialog(); setTimeout(() => importConflict(payload, error.details.conflicts), 0); }
        }, t('导入', 'Import'));
        $('import-file').onchange = async event => { try { payload = undefined; const file = event.target.files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) throw Error(t('文件不能超过 2 MiB。', 'File exceeds 2 MiB.')); payload = { mode: 'new', format: /\.ya?ml$/i.test(file.name) ? 'yaml' : 'json', text: await file.text() }; $('dialog-error').textContent = ''; } catch (error) { $('dialog-error').textContent = error.message; } };
      };
      localize();
      render(); await refreshPreview(true);
      const offLocale = ctx.locale.subscribe(() => { english = ctx.locale.getSnapshot().active?.startsWith('en') ?? false; localize(); render(false); renderPreview(); });
      // Host owns automatic scanning. Poll only its snapshot, never duplicate scans.
      timer = setInterval(async () => { if (busy || dialogPending || signal.aborted) return; try { const snapshot = await request('snapshot'); const changedAt = snapshot.catalog.scannedAt !== state.catalog.scannedAt || snapshot.catalog.revision !== state.catalog.revision || snapshot.sourcesVersion !== state.sourcesVersion || snapshot.proxyInjection !== state.proxyInjection || (sessionId && snapshot.sessions.find(session => session.id === sessionId)?.contextVersion !== state.sessions.find(session => session.id === sessionId)?.contextVersion); state = snapshot; renderContextOptions(); if (changedAt) { tools(); scanStatus(); await refreshPreview(true); } } catch (error) { report(error); } }, 5000);
      return () => { offLocale(); clearInterval(timer); clearTimeout(previewTimer); clearTimeout(toastTimer); scrollTimers.forEach(clearTimeout); root.removeEventListener('scroll', onScroll, true); $('editor-dialog').close(); };
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
