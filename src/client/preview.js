      function supplemental() {
        const actual = (preview?.editableSections || []).filter(section => section.role !== 'user' && section.managedBy !== 'tools' && (!section.name.startsWith('mcp:') || section.text?.trim()));
        const items = actual.filter(section => !section.custom || draft.prompt.sections[section.name]).map(section => {
          const edit = draft.prompt.sections[section.name];
          return { ...section, ...(section.managedBy === 'tool-guidance' ? edit ? { order: edit.order, enabled: edit.enabled } : {} : edit || {}), ...(edit?.inherit || section.name === 'mcp-resource-servers' ? { text: section.text } : {}) };
        });
        for (const [name, section] of Object.entries(draft.prompt.sections)) if (section.custom && !items.some(item => item.name === name)) items.push({ name, ...section });
        return items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      }
      const labels = { 'context:file-reference': t('文件引用', 'File references'), 'mcp-resource-servers': t('MCP资源服务器', 'MCP resource servers'), 'ui:deliverable-file-references': t('交付文件引用', 'Deliverable file references'), 'harness:source': t('宿主来源', 'Host source'), 'app:web-surface': t('网页界面', 'Web surface'), 'deployment:persona-suffix': t('补充指令', 'Supplemental instructions'), 'workshop:user-cwd': t('工作目录', 'Working directory'), 'workshop:user-runtime': t('环境', 'Environment'), 'workshop:user-skill': t('技能目录', 'Skill catalog') };
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
          ...(agent ? [{ ...agent, ...saved(AGENT), name: AGENT, order: -2, reorderable: false }] : []),
          ...(agent?.directoryText ? [{ name: USER_DIRECTORY, text: agent.directoryText, enabled: saved(USER_DIRECTORY).enabled !== false, toggleable: true, editable: false, reorderable: false, order: -1 }] : []),
          ...((preview?.runtimeContextSource || preview?.runtimeContext) ? [{ name: 'workshop:user-runtime', text: preview.runtimeContextEnvironmentSource, enabled: saved('workshop:user-runtime').enabled !== false && saved(USER_CWD).enabled !== false, order: 0, toggleable: true, editable: false, reorderable: false }] : []),
          ...(preview?.skillPrompt ? [{ name: 'workshop:user-skill', text: preview.skillPrompt, editable: false, reorderable: false, order: 100 }] : []),
          ...(preview?.userSections || []).filter(section => section.name === 'time-context').map(section => ({ ...section, ...saved(section.name), order: 200, reorderable: false })),
          ...(preview?.userSections || []).filter(section => section.name !== 'time-context').map(section => ({ ...section, reorderable: false })),
          ...Object.entries(draft.prompt.sections).filter(([, section]) => section.custom && section.role === 'user').map(([name, section]) => ({ name, ...section, reorderable: false })),
        ];
        const userRow = section => row(section, { agent: section.name === AGENT, directory: section.name === USER_DIRECTORY || section.name === DIRECTORY_AGENT });
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
        const textChunks = text => {
          const lines = String(text).split('\n'), chunks = [];
          for (let index = 0; index < lines.length; index += 48) chunks.push(`<span class="prompt-text-chunk">${esc(lines.slice(index, index + 48).join('\n'))}</span>`);
          return chunks.join('');
        };
        const fragment = (label, text, kind = '') => text ? `<section class="prompt-fragment ${kind}"><h4>${esc(label)}</h4><div class="prompt-fragment-body">${textChunks(text)}</div></section>` : '';
        const toolText = items => items.map(tool => `${tool.function.name}: ${tool.function.description}`).join('\n\n');
        const userSections = (preview.userSections || []).filter(section => section.text?.trim());
        const customUser = Object.entries(draft.prompt.sections).filter(([, section]) => section.custom && section.role === 'user' && section.enabled).map(([name, section]) => ({ name, text: section.text, order: section.order }));
        const environmentText = preview.runtimeContextEnvironment || '';
        const agentsText = preview.agentInstructions?.requestText || '';
        const userParts = [
          fragment(t('用户消息', 'User message'), t('［用户第一句话 · 仅作占位，预设工坊不修改会话消息。］', '[First user message · Placeholder only; the preset workshop does not edit session messages.]'), 'message-fragment'),
          fragment('AGENTS', agentsText, 'agent-fragment'),
          fragment(t('环境', 'Environment'), draft.prompt.sections['workshop:user-runtime']?.enabled === false || draft.prompt.sections[USER_CWD]?.enabled === false ? '' : environmentText, 'environment-fragment'),
          fragment('SKILL', preview.skillPrompt, 'skill-fragment'),
          ...userSections.filter(section => section.enabled !== false).map(section => fragment(section.name === 'time-context' ? t('时间与时区', 'Time and time zone') : section.name === 'prompt-manager-catalog' ? t('提示词管理（会话实况）', 'Prompt manager (session context)') : section.name, section.text, section.name === 'time-context' ? 'time-fragment' : 'user-extra-fragment')),
          ...customUser.map(section => fragment(section.name, section.text, 'custom-fragment')),
        ].filter(Boolean).join('');
        const toolParts = `${fragment('TOOL', toolText(visibleTools), 'tool-fragment')}${fragment('MCP', toolText(mcpTools), 'mcp-fragment')}`;
        $('preview-prompt').innerHTML = `<section class="prompt-major system-major"><h3>System</h3>${preview.prompt ? `<div class="prompt-major-content">${textChunks(preview.prompt)}</div>` : ''}</section><section class="prompt-major user-major"><h3>User</h3>${userParts}</section>${toolParts ? `<section class="prompt-major tool-major"><h3>${t('工具', 'Tools')}</h3>${toolParts}</section>` : ''}`;
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
        const version = ++previewVersion, id = draft.id, input = { id, draft: structuredClone(draft), ...context() };
        $('preview-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-dialog-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-open').disabled = true;
        $('copy-preview').disabled = true;
        previewQueue = previewQueue.then(async () => {
          if (version !== previewVersion || signal.aborted) return;
          try {
          const result = await request('preview', input);
          const source = withSkills ? await request('skills', { cwd: result.cwd }) : undefined;
          if (version !== previewVersion || signal.aborted || draft.id !== id) return;
          for (const tool of result.catalog) {
            const original = state.catalog.tools.find(item => item.name === tool.name);
            if (!draft.tools.sources?.[tool.name] && original?.package && tool.package && tool.package !== original.package && draft.tools.packages.includes(tool.package)) (draft.tools.sources ??= {})[tool.name] = tool.package;
          }
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
      function schedulePreview(withSkills = false) { previewVersion++; clearTimeout(previewTimer); $('preview-open').disabled = true; $('copy-preview').disabled = true; $('preview-summary').textContent = t('生成预览…', 'Generating preview…'); $('preview-dialog-summary').textContent = t('生成预览…', 'Generating preview…'); previewTimer = setTimeout(() => refreshPreview(withSkills), 350); }
      function changed() { status(); schedulePreview(); }
      function renderContextOptions() {
        if (!state.sessions.some(session => session.id === sessionId)) sessionId = '';
        const current = state.sessions.find(session => session.id === sessionId), key = session => [session.cwd, session.provider, session.model, session.permissions?.sandbox, session.permissions?.approval].join('\0'), contexts = [...new Map(state.sessions.map(session => [key(session), session])).values()];
        $('preview-context').innerHTML = `<span class="choice-name">${esc(current ? (current.cwd || t('会话环境', 'Session context')) : t('默认模型与指定目录', 'Default model and chosen directory'))}</span>${icon('down')}`;
        $('preview-context-menu').innerHTML = [{ id: '', cwd: t('默认模型与指定目录', 'Default model and chosen directory') }, ...contexts].map(session => `<button type="button" class="select-option context-option" data-context-session="${esc(session.id)}" role="option" aria-selected="${current ? key(session) === key(current) : !session.id}"><span class="choice-name">${esc(session.cwd)}${session.model ? `<small>${esc(session.provider || '')} · ${esc(session.model)}${session.permissions?.sandbox ? ' · ' + esc(session.permissions.sandbox) + ' / ' + esc(session.permissions.approval || '') : ''}</small>` : ''}</span></button>`).join('');
        $('preview-cwd').readOnly = Boolean(sessionId); $('preview-cwd').value = current ? current.cwd || '' : cwd;
      }
      function render(reset = true) {
        if (reset) { base = structuredClone(selected()); draft = structuredClone(base); preview = undefined; historyPresetId = draft.id; selectedSnapshotId = ''; historyVersion++; historyRows = []; }
        pickers(); $('preset-id').value = draft.id; $('preset-description').value = draft.description; $('persona').value = draft.prompt.persona; fitPromptEditor($('persona'));
        $('preset-enabled').checked = draft.enabled; $('preset-enabled').disabled = draft.builtin; $('delete-preset').disabled = draft.builtin;
        tools(); skills(); sections(); mcp(); scanStatus(); status(); renderContextOptions();
        const warning = state.roster.find(p => p.id === draft.id)?.broken;
        $('operation-error').textContent = warning || (state.nameConflicts.length ? t('存在与其他插件相同的预设显示名。', 'A preset display name is also used by another plugin.') : '');
        snapshotSettingsView();
        if (historyVisible()) { renderHistoryRows(); if (reset) snapshots(); }
      }
      async function save(changes, overrideName) {
        const before = structuredClone(draft), result = await request('save', { id: base.id, revision: base.revision, changes, ...context() });
        state = result; base = structuredClone(state.presets.find(p => p.id === before.id)); draft = before;
        if (overrideName) draft.tools.overrides[overrideName] = structuredClone(base.tools.overrides[overrideName]);
        else for (const key of Object.keys(changes)) draft[key] = structuredClone(base[key]);
        draft.revision = base.revision;
        render(false); await refreshPreview(); toast(t('已保存。', 'Saved.'));
        if (!$('config-pane-compat').hidden && !$('compat-pane-snapshot').hidden) await snapshots();
        return true;
      }
