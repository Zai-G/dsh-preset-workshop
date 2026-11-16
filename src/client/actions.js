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
        if (button?.dataset.skillGroup) { skillGroupId = button.dataset.skillGroup; closePickers(); skills(); return; }
        if (button?.dataset.historyPreset) { historyPresetId = button.dataset.historyPreset; selectedSnapshotId = ''; closePickers(); snapshots(); return; }
        const groupId = button?.dataset.skillGroupEdit;
        if (groupId) { editSkillGroup(state.config.skillGroups.find(row => row.id === groupId)); return; }
        if (button?.hasAttribute('data-skill-group-new')) { editSkillGroup(); return; }
        if (button?.dataset.snapshotOpen) { run(() => showSnapshotDetail(button.dataset.snapshotOpen)); return; }
        if (button?.dataset.snapshotDelete) {
          const id = button.dataset.snapshotDelete, row = (state.histories?.[historyPresetId || draft.id] || []).find(item => item.id === id);
          if (!row) return;
          const presetId = historyPresetId || draft.id, date = timestamp(row.createdAt);
          run(async () => { const result = await request('snapshot-delete', { id: presetId, snapshotId: id }); state = result.state; showSnapshotToast(result.token, date, result.expiresAt); await snapshots(); });
          return;
        }
        if (button?.dataset.limitStep) {
          const current = Number($('snapshot-limit').value) || snapshotSettingsView().settings.limit;
          applySnapshotSettings({ limit: Math.max(1, Math.min(9, current + Number(button.dataset.limitStep))) });
          return;
        }
        if (button?.hasAttribute('data-mcp-preview')) { const server = preview?.mcp.find(item => item.serverName === button.dataset.mcpPreview); if (server) previewMcp(server); return; }
        const editMcp = button?.dataset.mcpEdit && preview?.mcp.find(server => server.serverName === button.dataset.mcpEdit);
        if (editMcp) { event.preventDefault(); event.stopPropagation(); openMcpEditor(editMcp); return; }
        const deleteMcp = button?.dataset.mcpDelete && preview?.mcp.find(server => server.serverName === button.dataset.mcpDelete);
        if (deleteMcp) { event.preventDefault(); event.stopPropagation(); removeMcp(deleteMcp); return; }
        if (button?.id === 'create-mcp') { event.preventDefault(); event.stopPropagation(); openMcpEditor(); return; }
        if (button?.dataset.description) openTool(button.dataset.description, button.dataset.descriptionSource || '');
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
        if (el.id === 'snapshots-enabled') { applySnapshotSettings({ enabled: el.checked }); return; }
        if (el.id === 'snapshot-limit') { changeSnapshotLimit(); return; }
        if (el.name === 'snapshot-selected') { selectedSnapshotId = el.value; renderHistoryRows(); root.querySelector('[name="snapshot-selected"]:checked')?.focus({ preventScroll: true }); return; }
        if (el.dataset.tool) {
          const name = el.dataset.tool, source = el.dataset.toolSource || '', tool = toolSource(name), canonical = canonicalSource(name);
          if (!tool) return;
          draft.tools.sources ??= {};
          if (el.checked) {
            if (source && source !== canonical) { draft.tools.sources[name] = source; draft.tools.packages = [...new Set([...draft.tools.packages, source])]; }
            else delete draft.tools.sources[name];
            draft.tools.enabled = [...new Set([...draft.tools.enabled, name])];
          } else {
            draft.tools.enabled = draft.tools.enabled.filter(item => item !== name);
            if (source && draft.tools.sources[name] === source) delete draft.tools.sources[name];
          }
          syncToolPackages();
          tools(); mcp(); changed();
        }
        if (el.dataset.mcpEnabled) {
          const server = preview?.mcp.find(item => item.serverName === el.dataset.mcpEnabled);
          if (!server || server.tools.some(tool => draft.tools.enabled.includes(tool.function?.name ?? tool.name))) { mcp(); return; }
          if (server.source === 'preset') draft.mcp = draft.mcp.map(item => item.serverName === server.serverName ? { ...item, enabled: el.checked } : item);
          else draft.mcpEnabled = { ...draft.mcpEnabled, [server.serverName]: el.checked };
          mcp(); changed();
        }
        if (el.dataset.skill) { draft.skills = el.checked ? [...new Set([...draft.skills, el.dataset.skill])] : draft.skills.filter(x => x !== el.dataset.skill); el.closest('.skill-row')?.classList.toggle('off', !el.checked); if (el.checked && toolSource('skill')?.available) draft.tools.enabled = [...new Set([...draft.tools.enabled, 'skill'])]; tools(); changed(); }
        if (el.dataset.sectionEnabled) { const id = el.dataset.sectionEnabled; if (id === 'workshop:user-runtime') { for (const key of ['workshop:user-runtime', USER_CWD]) { const original = base.prompt.sections[key]; if (el.checked && !original) delete draft.prompt.sections[key]; else draft.prompt.sections[key] = { ...(draft.prompt.sections[key] || {}), text: '', order: original?.order ?? 0, enabled: el.checked }; } sections(); changed(); return; } const section = id === AGENT ? { ...preview.agentInstructions, ...(draft.prompt.sections[AGENT] || {}) } : id === USER_DIRECTORY ? { text: preview.agentInstructions?.directoryText, order: -1, ...draft.prompt.sections[id] } : id === 'time-context' ? preview.userSections.find(s => s.name === id) : supplemental().find(s => s.name === id) || draft.prompt.sections[id]; if (!section) return; draft.prompt.sections[id] = { ...(section.custom ? { custom: true, ...(section.role ? { role: section.role } : {}) } : {}), ...(section.inherit ? { inherit: true } : {}), text: ['workshop:tool-guidance', 'time-context', 'workshop:user-runtime', USER_DIRECTORY, USER_CWD].includes(id) ? '' : section.text, order: section.order ?? 0, enabled: el.checked }; el.closest('.detected-row')?.classList.toggle('off', !el.checked); changed(); }
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
        reordered.forEach((s, i) => { draft.prompt.sections[s.name] = { ...(s.custom ? { custom: true } : {}), ...(s.inherit ? { inherit: true } : {}), text: s.name === 'workshop:tool-guidance' ? '' : s.text, enabled: s.enabled, order: slots[i] }; });
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
      }, t('保存', 'Save'), '', { lockOnEdit: true });
      };
      $('create-preset').onclick = () => dialog(t('新建预设', 'New preset'), t('ID 创建后不可修改；显示名可随时调整。', 'The ID is immutable; the display name can be changed.'), `<label class="field">${t('显示名称', 'Display name')}<input id="new-name" maxlength="160" required></label><label class="field">${t('预设 ID', 'Preset ID')}<input id="new-id" maxlength="64" pattern="[a-z0-9][a-z0-9_-]{0,63}" required></label>${dirty() ? `<p class="source-note">${t('创建后将切换到新预设，当前未保存编辑会丢弃。', 'Creating switches to the new preset and discards current unsaved edits.')}</p>` : ''}${dialogError}`, async () => { state = await request('create', { id: $('new-id').value, name: $('new-name').value }); render(); await refreshPreview(true); }, t('创建', 'Create'), '', { lockOnEdit: true });
      $('rename-preset').onclick = () => dialog(t('重命名', 'Rename'), t('修改显示名称，不影响会话绑定。', 'The preset ID and session bindings are preserved.'), `<label class="field">${t('显示名称', 'Display name')}<input id="new-name" maxlength="160" value="${esc(draft.name)}" required></label>${dialogError}`, () => save({ name: $('new-name').value.trim() }), t('保存', 'Save'), '', { lockOnEdit: true });
      async function remove(disable) {
        const references = await request('references', { id: base.id });
        dialog(disable ? t('停用预设', 'Disable preset') : t('删除预设', 'Delete preset'), references.references.length ? t(`有 ${references.references.length} 个会话将回退到「${references.fallback.name}」。`, `${references.references.length} sessions will fall back to “${references.fallback.name}”.`) : t('当前没有会话引用此预设。', 'No sessions reference this preset.'), `<p>${t('消息历史保留。已开始的会话在下次恢复时使用回退预设。', 'Message history is preserved. Started sessions use the fallback when next restored.')}</p>${dirty() ? `<p class="source-note">${t('当前未保存编辑将丢弃。', 'Current unsaved edits will be discarded.')}</p>` : ''}${dialogError}`, async () => { state = await request(disable ? 'toggle' : 'delete', { id: base.id, revision: base.revision, enabled: false, confirm: true }); render(); await refreshPreview(true); }, disable ? t('停用', 'Disable') : t('删除', 'Delete'), '', disable ? {} : { locked: true });
      }
      $('delete-preset').onclick = () => run(() => remove(false));
      $('preset-enabled').onchange = event => { if (!event.target.checked) { event.target.checked = true; run(() => remove(true)); } else run(async () => { state = await request('toggle', { id: base.id, revision: base.revision, enabled: true }); base = structuredClone(state.presets.find(p => p.id === draft.id)); draft.enabled = true; draft.revision = base.revision; render(false); await refreshPreview(); }); };
      $('reset-preset').onclick = () => dialog(t('恢复默认', 'Reset preset'), t('仅作用于当前预设。', 'Affects this preset only.'), `<p>${t('工具、提示词与技能将恢复初始值；名称、ID、描述和启用状态保留。', 'Reset tools, prompts and skills. The name, ID, description and enabled state are preserved.')}</p>${dialogError}`, async () => { state = await request('reset', { id: base.id, revision: base.revision, ...context() }); render(); await refreshPreview(true); if (historyVisible()) await snapshots(); }, t('恢复默认', 'Reset'), '', { locked: true });
      const settings = changes => run(async () => { state = await request('settings', { changes }); scanStatus(); });
      $('auto-scan').onchange = event => settings({ polling: event.target.checked });
      $('scan-interval').onchange = event => settings({ scanInterval: Number(event.target.value) });
      $('scan-tools').onclick = () => run(async () => {
        state = await request('scan', { id: draft.id, ...context() }); tools(); scanStatus(); await refreshPreview(true);
        toast(scanSentence(true));
      });
      $('skills-all').onclick = () => { const group = state.config.skillGroups?.find(row => row.id === skillGroupId), all = group ? group.skills : [...new Set([...sourceSkills.map(skill => skill.name), ...draft.skills, ...(state.config.skillGroups || []).flatMap(row => row.skills)])]; const complete = all.length > 0 && all.every(name => draft.skills.includes(name)); draft.skills = complete ? draft.skills.filter(name => !all.includes(name)) : [...new Set([...draft.skills, ...all])]; if (draft.skills.length && toolSource('skill')?.available) draft.tools.enabled = [...new Set([...draft.tools.enabled, 'skill'])]; skills(); tools(); changed(); };
      $('preview-cwd').oninput = event => { cwd = event.target.value.trim(); schedulePreview(true); };
      root.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-tab]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', String(tab === button)); }); $('pane-overview').hidden = button.dataset.tab !== 'overview'; $('pane-prompt').hidden = button.dataset.tab !== 'prompt'; }; });
      root.querySelectorAll('[data-config-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-config-tab]').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); root.querySelectorAll('.config-pane').forEach(pane => { pane.hidden = pane.id !== `config-pane-${button.dataset.configTab}`; }); if (button.dataset.configTab === 'tools') requestAnimationFrame(fitToolLists); if (historyVisible()) snapshots(); }; });
      root.querySelectorAll('[data-compat-tab]').forEach(button => { button.onclick = () => { root.querySelectorAll('[data-compat-tab]').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); root.querySelectorAll('.compat-pane').forEach(pane => { pane.hidden = pane.id !== `compat-pane-${button.dataset.compatTab}`; }); if (button.dataset.compatTab === 'snapshot') snapshots(); }; });
      $('preview-open').onclick = () => { if (preview) $('preview-dialog').showModal(); };
      $('preview-close').onclick = () => $('preview-dialog').close();
      $('preview-dialog').addEventListener('click', event => { if (outsideDialog(event, $('preview-dialog'))) event.target.close(); });
      window.addEventListener('resize', fitToolLists);
      root.querySelectorAll('.tool-group').forEach(group => group.addEventListener('toggle', () => requestAnimationFrame(fitToolLists)));
      async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px'; root.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); if (!ok) throw Error(t('无法自动复制，请手动选择文本。', 'Select and copy the text manually.')); } }
      $('copy-preview').onclick = async () => { try { if (!preview) return; await copy(preview.displayPrompt); toast(t('已复制。', 'Copied.')); } catch (error) { report(error); } };
      $('export-open').onclick = () => {
        const boxes = state.presets.map(preset => `<label class="export-choice"><input type="checkbox" data-export-id="${esc(preset.id)}"><span class="box-check"></span><span>${esc(preset.name)}</span></label>`).join('');
        dialog(t('导出方案', 'Export presets'), t('选择一个或多个预设，下载为 ZIP。', 'Select one or more presets to download as ZIP.'), `<div class="export-select-head"><span>${t('范围', 'Scope')}</span><button type="button" class="text-button" id="export-toggle-all">${t('全选', 'Select all')}</button></div><div class="export-choices">${boxes}</div>${dialogError}`, async () => {
          const ids = [...root.querySelectorAll('[data-export-id]:checked')].map(input => input.dataset.exportId);
          if (!ids.length) throw Error(t('请至少选择一个预设。', 'Select at least one preset.'));
          const result = await request('export', { ids, cwd, language: english ? 'en' : 'zh' });
          const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), link = document.createElement('a');
          link.href = url; link.download = `preset-workshop-${ids.length === state.presets.length ? 'all' : ids.length}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, t('下载', 'Download'), '', { lockOnEdit: true });
        const toggle = () => { const inputs = [...root.querySelectorAll('[data-export-id]')], checked = inputs.filter(input => input.checked).length; $('export-toggle-all').textContent = checked === inputs.length ? t('全不选', 'Clear all') : t('全选', 'Select all'); };
        $('export-toggle-all').onclick = () => { dialogEdited = true; const inputs = [...root.querySelectorAll('[data-export-id]')], check = inputs.some(input => !input.checked); inputs.forEach(input => { input.checked = check; }); toggle(); };
        root.querySelectorAll('[data-export-id]').forEach(input => input.onchange = toggle);
      };
      const openImport = () => {
        let data, inspected, readVersion = 0, previewVersion = 0;
        const cards = () => [...root.querySelectorAll('[data-import-index]')];
        const edits = () => cards().map(card => ({
          id: card.querySelector('[data-import-id]').value.trim(), name: card.querySelector('[data-import-name]').value.trim(), description: card.querySelector('[data-import-description]').value,
          persona: card.querySelector('[data-import-persona]').value,
          custom: Object.fromEntries([...card.querySelectorAll('[data-import-custom]')].map(input => [input.dataset.importCustom, input.value])),
          tools: [...card.querySelectorAll('[data-import-tool]:checked')].map(input => input.dataset.importTool), skills: [...card.querySelectorAll('[data-import-skill]:checked')].map(input => input.dataset.importSkill),
        }));
        const validate = () => {
          const values = edits(), existing = [...state.presets, ...state.roster]; let invalid = !data || !values.length;
          cards().forEach((card, index) => {
            const value = values[index], duplicates = [...existing, ...values.filter((_, other) => other !== index)];
            const message = duplicates.some(row => row.id === value.id || row.name === value.name) ? t('预设名称或 ID 已存在，请重命名。', 'Preset name or ID already exists. Choose another.') : !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) || !value.name ? t('请填写名称和有效的预设 ID。', 'Enter a name and a valid preset ID.') : '';
            card.querySelector('.import-conflict').textContent = message; invalid ||= Boolean(message);
          });
          $('dialog-save').disabled = invalid;
        };
        const blocks = rows => rows.map(row => `<article class="prompt-fragment"><h4>${esc(row.label || row.name)}</h4><pre class="preview-code import-readonly" tabindex="0">${esc(row.text)}</pre></article>`).join('') || `<p class="muted">${t('暂无', 'None')}</p>`;
        const renderImport = result => {
          inspected = result;
          $('import-presets').innerHTML = result.presets.map(({ item, tools, system, user }, index) => `<article class="import-preset" data-import-index="${index}">
            <label class="field">${t('预设名称', 'Preset name')}<input data-import-name maxlength="160" required value="${esc(item.name)}"></label>
            <label class="field">${t('预设 ID', 'Preset ID')}<input data-import-id maxlength="64" pattern="[a-z0-9][a-z0-9_-]{0,63}" required value="${esc(item.id)}"></label>
            <label class="field">${t('预设描述', 'Description')}<textarea data-import-description maxlength="4000">${esc(item.description)}</textarea></label><p class="error-message import-conflict" role="alert"></p>
            <section class="import-section import-system"><h3>System</h3><label class="field">${t('人设', 'Persona')}<textarea data-import-persona maxlength="200000" spellcheck="false">${esc(item.prompt.persona)}</textarea></label>
            ${Object.entries(item.prompt.sections).filter(([, section]) => section.custom && section.role !== 'user').map(([name, section]) => `<label class="field">${esc(name)}<textarea data-import-custom="${esc(name)}" maxlength="200000" spellcheck="false">${esc(section.text)}</textarea></label>`).join('')}
            <div class="import-native-system">${blocks(system)}</div></section>
            <section class="import-section import-user"><h3>User</h3><div class="import-user-blocks">${blocks(user)}</div></section>
            <section class="import-section"><h3>${t('工具', 'Tools')}</h3><div class="import-choice-list">${tools.map(tool => `<label class="export-choice${tool.available ? '' : ' unavailable'}"><input type="checkbox" data-import-tool="${esc(tool.name)}" ${tool.available ? 'checked' : 'disabled'}><span class="box-check"></span><span>${esc(tool.name)}${tool.available ? '' : ' · ' + t('当前环境不可用', 'Unavailable here')}</span></label>`).join('') || t('暂无', 'None')}</div></section>
            <section class="import-section"><h3>MCP</h3><div class="import-names">${item.mcp.map(server => `<span>${esc(server.serverName)}</span>`).join('') || t('暂无', 'None')}</div>${item.mcp.length ? `<p class="source-note">${t('连接私密信息已替换为占位符。导入后保持关闭，请补齐配置再开启并检测工具。', 'Private connection values are placeholders. Connections stay off after import; complete their settings before enabling and detecting tools.')}</p>` : ''}</section>
            <section class="import-section"><h3>${t('技能', 'Skills')}</h3><div class="import-choice-list">${item.skills.map(skill => `<label class="export-choice"><input type="checkbox" data-import-skill="${esc(skill.name)}" checked><span class="box-check"></span><span>${esc(skill.name)}</span></label>`).join('') || t('暂无', 'None')}</div></section>
          </article>`).join('');
          validate();
        };
        dialog(t('导入方案', 'Import presets'), t('一次选择一个预设工坊 ZIP。宿主动态内容按当前环境生成，已有手工覆盖保留。', 'Choose one Preset Workshop ZIP. Host content follows this environment; authored overrides are preserved.'), `<label class="field">${t('选择文件', 'Choose file')}<input id="import-file" type="file" accept=".zip,application/zip" required></label><div id="import-presets"></div>${dialogError}`, async () => {
          validate(); if ($('dialog-save').disabled) return false;
          state = await request('import', { data, edits: edits(), cwd }); render(); await refreshPreview(true);
        }, t('导入', 'Import'), '', { lockOnEdit: true, className: 'import-dialog' });
        const importContainer = $('import-presets');
        $('dialog-save').disabled = true;
        $('dialog-body').oninput = event => { if (event.target.closest('[data-import-index]')) validate(); };
        $('dialog-body').onchange = async event => {
          if (!event.target.matches('[data-import-tool],[data-import-skill]')) return;
          const version = ++previewVersion, fileVersion = readVersion;
          try {
            const result = await request('import-inspect', { data, edits: edits(), cwd });
            if (version !== previewVersion || fileVersion !== readVersion || !inspected || !$('editor-dialog').open || $('import-presets') !== importContainer) return;
            cards().forEach((card, index) => { card.querySelector('.import-native-system').innerHTML = blocks(result.presets[index].system); card.querySelector('.import-user-blocks').innerHTML = blocks(result.presets[index].user); });
          } catch (error) { if (version === previewVersion && fileVersion === readVersion) $('dialog-error').textContent = error.message; }
        };
        $('import-file').onchange = async event => {
          const version = ++readVersion; ++previewVersion;
          data = undefined; inspected = undefined; $('import-presets').innerHTML = ''; $('dialog-save').disabled = true;
          try {
            const file = event.target.files[0]; if (!file) return;
            if (file.size > 8 * 1024 * 1024) throw Error(t('文件不能超过 8 MiB。', 'File exceeds 8 MiB.'));
            if (!/\.zip$/i.test(file.name)) throw Error(t('请选择预设工坊 ZIP 文件。', 'Choose a Preset Workshop ZIP file.'));
            const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
            for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
            const encoded = btoa(binary), result = await request('import-inspect', { data: encoded, cwd });
            if (version !== readVersion || !$('editor-dialog').open || $('import-presets') !== importContainer) return;
            data = encoded; renderImport(result); $('dialog-error').textContent = '';
          } catch (error) { if (version === readVersion && $('import-presets') === importContainer) $('dialog-error').textContent = error.message; }
        };
      };
      $('import-open').onclick = () => {
        if (!dirty()) return openImport();
        dialog(t('导入方案', 'Import presets'), t('当前有未保存修改。', 'There are unsaved changes.'), `<p>${t('继续导入会丢弃当前未保存编辑。', 'Continuing will discard the current unsaved edits.')}</p>`, () => { setTimeout(openImport, 0); }, t('丢弃并继续', 'Discard and continue'));
      };
      localize();
      render(); main.inert = false; main.removeAttribute('aria-busy'); await refreshPreview(true);
      const offLocale = ctx.locale.subscribe(() => { english = ctx.locale.getSnapshot().active?.startsWith('en') ?? false; localize(); render(false); renderPreview(); });
      // Host owns automatic scanning. Poll only its snapshot, never duplicate scans.
      timer = setInterval(async () => {
        if (busy || dialogPending || signal.aborted) return;
        try {
          const snapshot = await request('snapshot');
          const changedAt = snapshot.catalog.scannedAt !== state.catalog.scannedAt || snapshot.catalog.revision !== state.catalog.revision || snapshot.sourcesVersion !== state.sourcesVersion || (sessionId && snapshot.sessions.find(session => session.id === sessionId)?.contextVersion !== state.sessions.find(session => session.id === sessionId)?.contextVersion);
          const historyChanged = !equal(snapshot.histories, state.histories) || !equal(snapshot.config.snapshots, state.config.snapshots);
          const groupsChanged = !equal(snapshot.config.skillGroups, state.config.skillGroups);
          state = snapshot; renderContextOptions();
          if (groupsChanged) skills();
          if (historyChanged && historyVisible() && !$('editor-dialog').open) await snapshots();
          if (changedAt) { tools(); scanStatus(); await refreshPreview(true); }
        } catch (error) { report(error); }
      }, 5000);
      return () => { offLocale(); clearInterval(timer); clearTimeout(previewTimer); clearTimeout(toastTimer); clearTimeout(limitNoteTimer); scrollTimers.forEach(clearTimeout); root.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', fitToolLists); $('editor-dialog').close(); $('preview-dialog').close(); };
    }
