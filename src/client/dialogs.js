      function dialog(title, subtitle, body, handler, label = t('保存', 'Save'), beforeActions = '', options = {}) {
        $('dialog-body').onclick = null; $('dialog-body').oninput = null; $('dialog-body').onchange = null;
        $('dialog-title').textContent = title; $('dialog-subtitle').textContent = subtitle; $('dialog-body').innerHTML = body;
        $('dialog-footer').innerHTML = `${beforeActions}<span></span><button type="button" id="dialog-cancel">${t('取消', 'Cancel')}</button><button type="submit" class="primary" id="dialog-save">${label}</button>`;
        $('editor-dialog').className = options.className || '';
        $('dialog-save').hidden = false; $('dialog-cancel').hidden = false; submit = handler; closePolicy = options.locked ? 'locked' : options.lockOnEdit ? 'conditional' : 'normal'; dialogEdited = false; closePickers(); $('editor-dialog').showModal();
        $('dialog-cancel').onclick = () => closeDialog('cancel');
      }
      function closeDialog(source = 'program') {
        if (dialogPending || (source === 'escape' && (closePolicy === 'locked' || closePolicy === 'conditional' && dialogEdited)) || (source === 'backdrop' && (closePolicy === 'locked' || closePolicy === 'conditional' && dialogEdited))) return;
        $('editor-dialog').close(); submit = undefined;
      }
      $('dialog-body').addEventListener('input', () => { dialogEdited = true; });
      $('dialog-body').addEventListener('change', () => { dialogEdited = true; });
      $('editor-dialog').addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); closeDialog('escape'); });
      $('dialog-close').onclick = () => closeDialog('x'); $('dialog-cancel').onclick = () => closeDialog('cancel');
      function outsideDialog(event, dialog) {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      }
      // A conflict dialog reopens in a queued task; a queued close event from the
      // previous dialog must not clear the handler the new one just installed.
      $('editor-dialog').addEventListener('click', event => { if (outsideDialog(event, $('editor-dialog'))) closeDialog('backdrop'); });
      $('dialog-form').onsubmit = event => { event.preventDefault(); submitDialog(submit); };
      async function submitDialog(handler) {
        if (dialogPending) return;
        dialogPending = true;
        for (const id of ['dialog-save', 'dialog-cancel', 'dialog-close']) $(id).disabled = true;
        try { if (await handler?.() !== false) { dialogPending = false; closeDialog(); } }
        catch (error) { const output = $('dialog-error'); if (output) { output.textContent = error.message; $('tool-json')?.setAttribute('aria-invalid', 'true'); output.scrollIntoView({ block: 'nearest' }); } else report(error); }
        finally { dialogPending = false; for (const id of ['dialog-save', 'dialog-cancel', 'dialog-close']) $(id).disabled = false; }
      }
      function openSection(id, edit) {
        if (id === 'workshop:user-runtime') { dialog(t('预览', 'Preview'), t('环境', 'Environment'), `<pre class="preview-code section-preview">${esc(preview?.runtimeContextEnvironmentSource || '')}</pre>`, () => {}, t('关闭', 'Close')); $('dialog-cancel').hidden = true; return; }
        let section = id === AGENT ? { ...preview.agentInstructions, ...(draft.prompt.sections[AGENT] || {}) } : id === USER_DIRECTORY ? { text: preview.agentInstructions.directoryText, editable: false } : supplemental().find(item => item.name === id);
        if (id === 'workshop:user-runtime') section = { name: id, text: preview.runtimeContextEnvironmentSource, editable: false, toggleable: true, order: draft.prompt.sections[id]?.order ?? 0, enabled: draft.prompt.sections[id]?.enabled !== false };
        if (id === 'workshop:user-skill') section = { name: id, text: preview.skillPrompt, editable: false };
        section ||= preview.userSections?.find(item => item.name === id);
        if (!section) return;
        if (id === AGENT && draft.prompt.sections[id]?.inherit) section.text = preview.agentInstructions.text;
        if (edit && (section.editable === false || section.managedBy === 'host')) return;
        const name = id === AGENT ? globalAgentDescription() : id === USER_DIRECTORY ? directoryAgentDescription() : sectionName({ name: id });
        const guidance = id === 'workshop:tool-guidance';
        const editor = guidance ? section.members.map((member, index) => `<label class="field">${esc(member.name)}<textarea class="guidance-editor" data-guidance-member="${index}" spellcheck="false" maxlength="200000">${esc(draft.prompt.sections[member.name]?.inherit ? member.text : draft.prompt.sections[member.name]?.text ?? member.text)}</textarea></label>`).join('') : `<textarea class="section-modal-editor" id="section-content" spellcheck="false" maxlength="200000" aria-label="${esc(name)}">${esc(section.text)}</textarea>`;
        const editedText = (name, text, original) => draft.prompt.sections[name]?.inherit && text === original ? { text: '', inherit: true } : { text };
        const title = edit ? t('编辑', 'Edit') : t('预览', 'Preview');
        const extra = edit && section.custom ? `<label class="field">${t('名称', 'Name')}<input id="section-name" maxlength="256" value="${esc(id)}" required></label>` : '';
        dialog(title, name, edit ? `${extra}${editor}<p id="dialog-error" class="error-message" role="alert"></p>` : `<pre class="preview-code section-preview">${esc((section.renderedText ?? section.text) || t('当前没有内容。', 'No content currently.'))}</pre>`, () => { if (edit) {
          const targetId = section.custom ? $('section-name').value.trim() : id;
          if (section.custom && (!targetId || /[\x00-\x1f\x7f]/.test(targetId) || Object.hasOwn(draft.prompt.sections, targetId) && targetId !== id)) throw Error(t('名称为空或已被占用，请换一个。', 'Choose a nonempty, unique name.'));
          if (guidance) root.querySelectorAll('[data-guidance-member]').forEach(el => { const member = section.members[Number(el.dataset.guidanceMember)]; draft.prompt.sections[member.name] = { ...editedText(member.name, el.value, member.text), order: member.order, enabled: draft.prompt.sections[member.name]?.enabled ?? true }; });
          if (section.custom) { if (targetId !== id) delete draft.prompt.sections[id]; draft.prompt.sections[targetId] = { custom: true, ...(section.role ? { role: section.role } : {}), text: $('section-content').value, order: section.order, enabled: section.enabled }; }
          else draft.prompt.sections[id] = { ...editedText(id, guidance || ['time-context', 'workshop:user-runtime'].includes(id) ? '' : $('section-content').value, section.text), order: section.order, enabled: section.enabled };
          sections(); changed();
        } }, edit ? t('保存', 'Save') : t('关闭', 'Close'), section.custom && edit ? `<button type="button" class="danger" id="delete-section">${icon('trash')}${t('删除此内容', 'Delete content')}</button>` : '', edit ? { lockOnEdit: true } : {});
        root.querySelectorAll('.guidance-editor,.section-modal-editor').forEach(textarea => { const fit = () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 360, Math.floor(window.innerHeight * .45))}px`; }; fit(); textarea.addEventListener('input', fit); });
        if (section.custom && edit) $('delete-section').onclick = () => {
          const removed = structuredClone(draft.prompt.sections[id]), presetId = draft.id;
          delete draft.prompt.sections[id]; closeDialog(); sections(); changed();
          showUndoToast(t('已删除 ', 'Deleted ') + id, Date.now() + 5000, () => {
            if (draft.id !== presetId) throw Error(t('请返回原预设后撤销。', 'Return to the original preset to undo.'));
            if (Object.hasOwn(draft.prompt.sections, id)) throw Error(t('同名内容已存在，无法覆盖。', 'Content with this name already exists.'));
            draft.prompt.sections[id] = removed; sections(); changed();
          });
        };
        $('dialog-cancel').hidden = !edit;
      }
      async function openSkill(name) {
        const skill = await request('skill', { name, cwd: preview?.cwd || cwd });
        dialog(name, '', `<div class="skill-detail-path"><span>${t('技能路径', 'Skill path')}</span><code>${esc(skill.path || skill.source)}</code></div><div class="skill-diagnostics"><h3>${t('诊断', 'Diagnostics')}</h3><p>${esc(skill.bodySource === 'file' ? t('技能已通过宿主校验；下方正文来自原始文件。', 'Validated by the host. The body below comes from the source file.') : t('正文来自技能 provider；当前没有可读取的本地原文件。', 'The body is provided by the skill provider; no local source file is readable.'))}</p>${skill.fileError ? `<p class="source-note">${esc(skill.fileError)}</p>` : ''}</div><div class="skill-metadata"><div><span>${t('名称', 'Name')}</span><strong>${esc(skill.name)}</strong></div><div class="skill-description-card"><span>${t('描述', 'Description')}</span><p tabindex="0">${esc(skill.description)}</p></div></div><h3 class="skill-body-title">${t('正文', 'Body')}</h3><pre class="preview-code skill-body" tabindex="0">${esc(skill.content)}</pre>${skill.runtimeContent ? `<details class="skill-runtime"><summary>${t('加载技能后的补充 · 不在目录摘要中', 'Supplement after loading · Not part of the catalog')}</summary><pre class="preview-code" tabindex="0">${esc(skill.runtimeContent)}</pre></details>` : ''}<p id="dialog-error" class="error-message" role="alert"></p>`, () => {}, t('关闭', 'Close'));
        $('dialog-cancel').hidden = true;
      }
      function openTool(name, source = '') {
        const tool = toolSource(name, source);
        if (!tool?.schema) return;
        const selectedSource = draft.tools.sources?.[name] || canonicalSource(name);
        const actualSource = source || tool.package || canonicalSource(name);
        const selected = actualSource === selectedSource;
        const subtitle = name + (tool.kind !== 'thirdparty' && actualSource.startsWith('@deepseek-ai/') ? '\n' + t('工具来源：', 'Tool source: ') + actualSource + t(' 插件', ' plugin') : '');
        if (!selected) {
          dialog(t('工具描述', 'Tool description'), subtitle, `<pre class="preview-code section-preview">${esc(JSON.stringify(tool.schema, null, 2))}</pre>`, () => {}, t('关闭', 'Close'));
          $('dialog-cancel').hidden = true; $('dialog-save').hidden = true;
          return;
        }
        const schema = draft.tools.overrides[name]?.schema || tool.schema;
        dialog(t('工具描述', 'Tool description'), subtitle, `<p class="risk risk-inline">${icon('notice')}<span>${t('请确保您了解 AI 与提示词的机制，否则请不要修改；您的任何修改导致的后果由您个人承担。', 'Only edit if you understand AI and prompts. You are responsible for the consequences.')}</span></p><textarea class="json-editor" id="tool-json" spellcheck="false" aria-label="${esc(name)} JSON" aria-describedby="dialog-error">${esc(JSON.stringify(schema, null, 2))}</textarea><div class="json-tools"><span class="muted">${t('如果您想调整，建议仅修改 description，名称和参数结构保持不变。避免出现兼容问题', 'To adjust descriptions, edit descriptions only and keep names and parameter structure unchanged.')}</span><button type="button" class="text-button" id="format-json">${t('格式化', 'Format')}</button></div><p class="error-message" id="dialog-error" role="alert" aria-live="assertive"></p>`, async () => {
          let value; try { value = JSON.parse($('tool-json').value); } catch (error) { throw Error(t('JSON 格式有误：', 'Invalid JSON: ') + error.message); }
          const tools = structuredClone(base.tools); tools.overrides[name] = { schema: value };
          // Server validates against the selected source's original schema.
          return save({ tools }, name);
        }, t('保存', 'Save'), '', { lockOnEdit: true });
        $('format-json').onclick = () => { dialogEdited = true; try { $('tool-json').value = JSON.stringify(JSON.parse($('tool-json').value), null, 2); $('dialog-error').textContent = ''; $('tool-json').removeAttribute('aria-invalid'); } catch (error) { $('dialog-error').textContent = error.message; $('tool-json').setAttribute('aria-invalid', 'true'); } };
      }
      async function acceptMcpChange(nextState, removedServerName) {
        const pending = structuredClone(draft);
        state = nextState;
        base = structuredClone(state.presets.find(p => p.id === pending.id));
        const mcp = structuredClone(base.mcp).map(server => {
          const previous = pending.mcp.find(item => item.serverName === server.serverName);
          return previous?.enabled !== undefined ? { ...server, enabled: previous.enabled } : server;
        });
        const owner = name => [...pending.mcp, ...(state.catalog.mcpServers || [])].filter(server => name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0]?.serverName;
        const enabled = pending.tools.enabled.filter(name => !removedServerName || owner(name) !== removedServerName);
        draft = { ...pending, mcp, mcpEnabled: structuredClone(pending.mcpEnabled ?? base.mcpEnabled ?? {}), revision: base.revision, tools: { ...pending.tools, enabled } };
        render(false); await refreshPreview(true);
      }
      function openMcpEditor(server) {
        const editing = Boolean(server);
        let config = server ? Object.fromEntries(Object.entries(structuredClone(draft.mcp.find(item => item.serverName === server.serverName) || server)).filter(([key]) => !['source', 'tools'].includes(key))) : { serverName: '', transport: 'stdio', command: '', args: [], env: {}, cwd: '' };
        const transportDrafts = {
          stdio: config.transport === 'stdio' ? structuredClone(config) : { serverName: config.serverName, transport: 'stdio', command: '', args: [], env: {}, cwd: config.cwd || '' },
          'streamable-http': config.transport === 'streamable-http' ? structuredClone(config) : { serverName: config.serverName, transport: 'streamable-http', url: '', headers: {}, cwd: config.cwd || '' },
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
          const value = { ...structuredClone(config), serverName: $('mcp-server').value.trim() };
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
        }, editing ? t('保存', 'Save') : t('添加', 'Add'), '', { lockOnEdit: true });
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
              transportDrafts[config.transport] = structuredClone(config);
              jsonMode = nextJson;
              if (jsonMode) $('mcp-json').value = JSON.stringify(config, null, 2); else drawForm();
              $('mcp-form-view').hidden = jsonMode; $('mcp-json-view').hidden = !jsonMode;
              $('mcp-json').disabled = !jsonMode;
              if (jsonMode) resizeMcpJson();
              root.querySelectorAll('#mcp-form-view input').forEach(input => { input.disabled = jsonMode; });
              root.querySelectorAll('[data-mcp-mode]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
            }
            if (button.dataset.mcpTransport) {
              dialogEdited = true;
              const current = read(true), transport = button.dataset.mcpTransport;
              transportDrafts[current.transport] = structuredClone(current);
              transportRows[current.transport] = {
                args: [...root.querySelectorAll('[data-mcp-arg-value]')].map(input => input.value),
                pairs: [...root.querySelectorAll('[data-mcp-kv]')].map(row => ({
                  key: row.querySelector('[data-mcp-key]').value,
                  value: row.querySelector('[data-mcp-value]').value,
                  expression: row.querySelector('[data-mcp-expression]').checked,
                  visible: row.querySelector('[data-mcp-value]').type === 'text',
                })),
              };
              config = { ...structuredClone(transportDrafts[transport]), serverName: current.serverName, transport };
              drawForm(); resetProbe();
            }
            if (button.hasAttribute('data-mcp-add-arg')) { dialogEdited = true; $('mcp-args-list').insertAdjacentHTML('beforeend', argument('')); resetProbe(); }
            if (button.hasAttribute('data-mcp-add-pair')) { dialogEdited = true; $('mcp-pairs-list').insertAdjacentHTML('beforeend', pair('', '')); resetProbe(); }
            if (button.hasAttribute('data-mcp-remove')) { dialogEdited = true; button.closest('.kv-row').remove(); resetProbe(); }
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
        dialog(t('删除 MCP 服务器', 'Delete MCP server'), t('仅删除当前预设中的连接配置。', 'Only this preset connection will be removed.'), `<p>${t(`将删除「${server.serverName}」及其已启用工具。消息历史不受影响。`, `“${server.serverName}” and its enabled tools will be removed. Message history is unaffected.`)}</p>${dialogError}`, async () => { const result = await request('mcp-delete', { id: base.id, revision: base.revision, serverName: server.serverName }); await acceptMcpChange(result, server.serverName); toast(t('MCP 已删除。', 'MCP deleted.')); }, t('删除', 'Delete'), '', { locked: true });
      }
      root.addEventListener('input', event => { if (event.target.id === 'tool-json') { $('dialog-error').textContent = ''; event.target.removeAttribute('aria-invalid'); } });
