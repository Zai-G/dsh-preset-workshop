      const timestamp = value => new Date(value).toLocaleString(english ? 'en-US' : 'zh-CN', { hour12: false });
      const snapshotReason = reason => ({ reset: t('恢复默认', 'Reset'), restore: t('还原保护', 'Restore protection'), import: t('导入方案', 'Imported preset') })[reason] || t('保存方案', 'Saved preset');
      let historyVersion = 0, historyRows = [], limitNoteTimer;
      const historyVisible = () => !$('config-pane-compat').hidden && !$('compat-pane-snapshot').hidden;
      function snapshotSettingsView() {
        const settings = state.config.snapshots || { enabled: false, limit: 3 };
        $('snapshots-enabled').checked = settings.enabled;
        $('snapshot-setting-label').textContent = settings.enabled ? t('保存份数', 'Snapshots per preset') : t('开启快照', 'Enable snapshots');
        $('snapshot-hint').setAttribute('aria-label', settings.enabled ? t('份数限制', 'Snapshot limit') : t('快照说明', 'About snapshots'));
        $('snapshot-help').textContent = settings.enabled ? t('份数限制：1-9', 'Limit: 1–9') : t('开启后，保存预设方案或恢复默认时保存上个版本；关闭时不自动保存。已有快照仍会保留，重新开启后可查看和还原。', 'When enabled, saving or resetting keeps the previous version. Turning this off keeps existing snapshots; enable it again to view and restore them.');
        $('snapshot-limit-controls').hidden = !settings.enabled;
        $('snapshot-content').hidden = !settings.enabled;
        $('snapshot-limit').value = settings.limit;
        $('snapshot-limit-summary').textContent = t('每个预设可保存 ', 'Per preset: ') + settings.limit + t(' 份', '');
        const entries = Object.values(state.histories || {}), counts = entries.reduce((sum, rows) => sum + rows.length, 0), presetCount = entries.filter(rows => rows.length).length;
        $('snapshot-counts').innerHTML = '<strong>' + counts + t(' 个快照', ' snapshots') + '</strong> · ' + presetCount + t(' 个预设', ' presets');
        const rows = state.presets.filter(preset => state.histories?.[preset.id]?.length);
        if (!state.presets.some(row => row.id === historyPresetId)) historyPresetId = draft.id;
        const value = historyPresetId || draft.id;
        $('snapshot-preset-select').innerHTML = '<span class="choice-name mono">' + esc(value) + '</span>' + icon('down');
        $('snapshot-preset-menu').innerHTML = rows.map(preset => '<button type="button" class="select-option" role="option" data-history-preset="' + esc(preset.id) + '" aria-selected="' + (preset.id === value) + '"><span class="choice-name mono">' + esc(preset.id) + '</span><span class="group-count">' + state.histories[preset.id].length + '</span></button>').join('') || '<span class="source-note">' + t('暂无快照', 'No snapshots') + '</span>';
        return { settings, value };
      }
      function snapshotDetailContent(detail, onlyChanges) {
        const diff = detail.diff, groups = ['tools', 'mcp', 'skills'], names = { tools: t('工具', 'Tools'), mcp: 'MCP', skills: t('技能', 'Skills') };
        const badges = (item, key) => { const added = item.added.length + (key === 'tools' ? 0 : item.modified.length), removed = item.removed.length + (key === 'tools' ? 0 : item.modified.length); return (added ? '<em>+ ' + added + ' ' + t('新增', 'added') + '</em>' : '') + (removed ? '<i>− ' + removed + ' ' + t('移除', 'removed') + '</i>' : '') + (key === 'tools' && item.modified.length ? '<b class="same-name-change">' + item.modified.length + ' ' + t('同名', 'same name') + '</b>' : '') || '<small>' + t('无变化', 'No changes') + '</small>'; };
        const summary = '<div class="snapshot-diff-summary"><div><span>' + t('提示词', 'Prompts') + '</span>' + (diff.system ? '<strong>System ' + t('已修改', 'changed') + '</strong>' : '') + (diff.user ? '<strong>User ' + t('已修改', 'changed') + '</strong>' : '') + (!diff.system && !diff.user ? '<small>' + t('无变化', 'No changes') + '</small>' : '') + '</div>' + groups.map(key => '<div><span>' + names[key] + '</span>' + badges(diff[key], key) + '</div>').join('') + '</div>';
        const columns = '<div class="snapshot-change-head"><h3>' + t('快照', 'Snapshot') + '<small>+ ' + t('还原后加入', 'Added on restore') + '</small></h3><h3>' + (detail.draft ? t('当前（草稿）', 'Current (draft)') : t('当前', 'Current')) + '<small>− ' + t('还原后移除', 'Removed on restore') + '</small></h3></div>';
        const textPair = (lines, timeContext = false) => '<div class="snapshot-text-columns">' + ['left', 'right'].map(side => {
          const rows = lines.filter(row => row[side] !== undefined && (!onlyChanges || row.kind !== 'same'));
          const chunks = [];
          for (let index = 0; index < rows.length;) {
            const kind = rows[index].kind === 'same' ? 'same' : side === 'left' ? 'added' : 'removed', text = [];
            while (index < rows.length && text.length < 48 && (rows[index].kind === 'same' ? 'same' : side === 'left' ? 'added' : 'removed') === kind) {
              const row = rows[index++];
              text.push((row.kind === 'same' ? '  ' : side === 'left' ? '+ ' : '− ') + esc(timeContext && row[side] === '由宿主在请求时提供时间与时区。' ? t(row[side], 'The host provides the time and time zone when a request is sent.') : row[side]));
            }
            chunks.push('<code class="' + kind + '">' + text.join('\n') + '\n</code>');
          }
          return '<pre class="snapshot-text-pane" tabindex="0" aria-label="' + (side === 'left' ? t('快照内容', 'Snapshot content') : t('当前内容', 'Current content')) + '">' + (chunks.join('') || '<span class="snapshot-no-change">' + t('暂无', 'None') + '</span>') + '</pre>';
        }).join('') + '</div>';
        const section = (title, kind, body, changed) => '<section class="snapshot-diff-section ' + kind + '"><div class="snapshot-diff-section-head"><h3>' + title + '</h3>' + (typeof changed === 'string' ? '<div class="snapshot-section-badges">' + changed + '</div>' : changed ? '<span>' + t('已修改', 'Changed') + '</span>' : '') + '</div>' + body + '</section>';
        const empty = '<p class="snapshot-no-change">' + t('暂无变化', 'No changes') + '</p>';
        const system = section('System', 'prompt', !onlyChanges || diff.system ? textPair(detail.systemLines) : empty, diff.system);
        const userKinds = { [AGENT]: 'agent-fragment', [USER_CWD]: 'working-directory-fragment', 'workshop:user-runtime': 'environment-fragment', 'workshop:user-skill': 'skill-fragment', 'time-context': 'time-fragment' };
        const user = section('User', 'user', detail.users.filter(row => !onlyChanges || row.changed).map(row => '<article class="snapshot-user-block prompt-fragment ' + (userKinds[row.name] || 'custom-fragment') + '"><h4>' + esc(row.name === 'time-context' ? t('时间与时区', 'Time and time zone') : row.label) + '</h4>' + textPair(row.lines, row.name === 'time-context') + '</article>').join('') || empty, diff.user);
        const chips = key => {
          const item = diff[key];
          return section(names[key], key, '<div class="snapshot-chip-columns">' + ['left', 'right'].map(side => {
            const changedNames = side === 'left' ? item.added : item.removed, kind = side === 'left' ? 'added' : 'removed';
            return '<div>' + (detail[side][key].filter(row => !onlyChanges || changedNames.includes(row.name) || item.modified.includes(row.name)).map(row => {
              const changed = changedNames.includes(row.name) || item.modified.includes(row.name);
              const sameName = key === 'tools' && item.modified.includes(row.name);
              return '<span class="diff-chip ' + (sameName ? 'same-name-change' : changed ? kind : 'same') + '">' + (sameName ? '' : changed ? side === 'left' ? '+ ' : '− ' : '') + esc(row.name) + '</span>';
            }).join('') || '<span class="snapshot-no-change">' + t('暂无', 'None') + '</span>') + '</div>';
          }).join('') + '</div>', badges(item, key));
        };
        return summary + '<label class="snapshot-only-changes"><input id="snapshot-only-changes" type="checkbox" ' + (onlyChanges ? 'checked' : '') + '>' + t('仅看变化', 'Only changes') + '</label>' + columns + system + user + groups.map(chips).join('');
      }
      async function showSnapshotDetail(id) {
        const presetId = historyPresetId || draft.id, requestContext = presetId === draft.id ? context() : { cwd: preview?.cwd || cwd };
        const detail = await request('history-detail', { id: presetId, snapshotId: id, ...(presetId === draft.id ? { draft: structuredClone(draft) } : {}), ...requestContext });
        historyDetail = detail;
        dialog(t('还原快照', 'Restore snapshot'), presetId + ' · ' + timestamp(detail.entry.createdAt) + ' · ' + snapshotReason(detail.entry.reason), snapshotDetailContent(detail, false) + dialogError, async () => {
          const result = await request('snapshot-restore', { id: presetId, snapshotId: id, revision: detail.revision, ...(presetId === draft.id ? { draft: structuredClone(draft) } : {}), ...requestContext });
          state = result;
          if (presetId === draft.id) { render(); await refreshPreview(true); }
          historyPresetId = presetId; selectedSnapshotId = id; await snapshots();
          toast(t('已还原快照；还原前的配置已保存。', 'Snapshot restored; the previous configuration was saved.'));
        }, t('还原此版本', 'Restore this version'), '<p class="snapshot-restore-note">' + t('还原前会保存当前配置', 'The current configuration is saved before restoring.') + '</p>', { locked: true, className: 'snapshot-detail-dialog' });
        $('dialog-body').onchange = event => {
          if (event.target.id !== 'snapshot-only-changes') return;
          const scroll = $('dialog-body').scrollTop;
          $('dialog-body').innerHTML = snapshotDetailContent(historyDetail, event.target.checked) + dialogError;
          $('dialog-body').scrollTop = scroll;
          $('snapshot-only-changes').focus({ preventScroll: true });
        };
      }
      function renderHistoryRows() {
        const value = historyPresetId || draft.id, rows = historyRows;
        if (!rows.some(row => row.id === selectedSnapshotId)) selectedSnapshotId = rows[0]?.id || '';
        const row = rows.find(row => row.id === selectedSnapshotId);
        $('snapshot-position').textContent = rows.length + ' / ' + (state.config.snapshots?.limit ?? 3);
        $('snapshot-current').innerHTML = row ? '<div class="snapshot-selected-label">' + t('选中版本', 'Selected version') + '<code>' + esc(value) + '</code></div><h3>' + snapshotReason(row.reason) + '</h3><time>' + timestamp(row.createdAt) + '</time><div class="snapshot-stat-chips"><span>' + row.summary.tools + ' ' + t('个工具', 'tools') + '</span><span>' + row.summary.mcp + ' MCP</span><span>' + row.summary.skills + ' ' + t('个技能', 'skills') + '</span><span>≈ ' + row.summary.tokens.min.toLocaleString() + '–' + row.summary.tokens.max.toLocaleString() + ' token</span></div><div class="snapshot-current-actions"><div><strong>' + row.changes + ' ' + t('处变化', 'changes') + '</strong><small>' + t('相较于当前变化', 'Compared with current') + '</small></div><button type="button" class="primary" data-snapshot-open="' + esc(row.id) + '">' + icon('refresh') + t('查看并还原', 'View and restore') + '</button></div>' : '<div class="snapshot-empty">' + t('此预设还没有快照。', 'This preset has no snapshots yet.') + '</div>';
        $('snapshot-list').innerHTML = rows.map(row => '<div class="snapshot-list-row ' + (row.id === selectedSnapshotId ? 'selected' : '') + '" data-snapshot-row="' + esc(row.id) + '"><label><input type="radio" name="snapshot-selected" value="' + esc(row.id) + '" ' + (row.id === selectedSnapshotId ? 'checked' : '') + '><span><time>' + timestamp(row.createdAt) + '</time><small>' + snapshotReason(row.reason) + ' · ' + t('发生 ', '') + row.changes + ' ' + t('处变化', 'changes') + '</small></span></label><button type="button" class="icon-button ghost" data-snapshot-delete="' + esc(row.id) + '" aria-label="' + esc(t('删除快照 ', 'Delete snapshot ') + timestamp(row.createdAt)) + '">' + icon('trash') + '</button></div>').join('') || '<p class="snapshot-empty-list">' + t('暂无版本记录', 'No version history') + '</p>';
      }
      async function snapshots() {
        const version = ++historyVersion, { value, settings } = snapshotSettingsView();
        if (!settings.enabled) return;
        const requestContext = value === draft.id ? context() : { cwd: preview?.cwd || cwd };
        try {
          const result = await request('history', { id: value, ...(value === draft.id ? { draft: structuredClone(draft) } : {}), ...requestContext });
          if (version !== historyVersion || signal.aborted) return;
          historyRows = result.records; renderHistoryRows();
        } catch (error) {
          if (version !== historyVersion || signal.aborted) return;
          historyRows = []; renderHistoryRows(); $('snapshot-current').textContent = error.message;
        }
      }
      function showSnapshotToast(token, date, expiresAt) {
        showUndoToast(t('已删除 ' + date + ' 的快照。', 'Deleted snapshot from ' + date + '.'), expiresAt, async () => {
          const result = await request('snapshot-undo', { token }); state = result.state; await snapshots();
        });
      }
      function showUndoToast(message, expiresAt, undo) {
        const item = document.createElement('div'); item.className = 'snapshot-toast';
        item.innerHTML = '<span>' + esc(message) + '</span><button type="button">' + t('撤销', 'Undo') + '</button><div class="snapshot-toast-progress"></div>';
        $('snapshot-toasts').append(item);
        const remaining = Math.max(0, expiresAt - Date.now()); item.style.setProperty('--undo-duration', remaining + 'ms');
        requestAnimationFrame(() => item.classList.add('show')); const expiry = setTimeout(() => item.remove(), remaining);
        item.querySelector('button').onclick = async event => {
          event.preventDefault(); event.stopPropagation(); if (Date.now() >= expiresAt) { item.remove(); return; }
          event.currentTarget.disabled = true;
          try { await undo(); clearTimeout(expiry); item.remove(); }
          catch (error) { item.querySelector('span').textContent = error.message; item.querySelector('button').disabled = false; }
        };
      }
      function limitNote(message) {
        clearTimeout(limitNoteTimer); $('snapshot-limit-note').textContent = message;
        limitNoteTimer = setTimeout(() => { $('snapshot-limit-note').textContent = ''; }, 5000);
      }
      function applySnapshotSettings(changes, note = '') {
        run(async () => {
          try {
            state = await request('snapshot-settings', changes);
            snapshotSettingsView(); limitNote(note);
            if (historyVisible()) await snapshots();
          } catch (error) {
            if (error.code === 'snapshot-limit-protected') state = await request('snapshot-settings', { ...changes, limit: error.details.minimum });
            snapshotSettingsView(); limitNote(error.message);
          }
        });
      }
      function changeSnapshotLimit() {
        const raw = $('snapshot-limit').value, number = Number(raw), valid = raw && Number.isFinite(number);
        const limit = valid ? Math.max(1, Math.min(9, Math.round(number))) : state.config.snapshots.limit;
        applySnapshotSettings({ limit }, !valid || number !== limit ? t('请输入整数：1-9', 'Enter an integer from 1 to 9') : '');
      }
