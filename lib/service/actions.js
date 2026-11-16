import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AGENT_SECTION, BUILTIN_ID, applySettings, fail, record } from "../domain/core.js";
import { snapshotSettings, historyFor, validateGroups, groupOrderWithUndo, snapshotView } from "../history/history.js";
import { portablePreset, writePresetArchive, readPresetArchive, importPlan } from "../transfer/transfer.js";
export async function performAction(input) {
    switch (input.action) {
        case 'skill-group-undo': {
            const deleted = this.deletedGroups.get(input.token);
            if (!deleted || Date.now() >= deleted.expiresAt)
                fail('undo-expired', 'Undo has expired', 409);
            const next = structuredClone(this.store.state), groups = next.config.skillGroups ??= [];
            const position = groups.findIndex(group => deleted.following.includes(group.id));
            groups.splice(position < 0 ? groups.length : position, 0, deleted.group);
            validateGroups(groups);
            await this.store.save(next);
            clearTimeout(deleted.timer);
            this.deletedGroups.delete(input.token);
            return this.snapshot();
        }
        case 'snapshot': return this.snapshot();
        case 'preview': return this.preview(input);
        case 'skills': return this.sourceSkills(input.cwd || homedir());
        case 'skill': return this.skillDetail(input.name, input.cwd || homedir());
        case 'history': return this.history(input);
        case 'history-detail': return this.history(input, true);
        case 'skill-group-save':
        case 'skill-group-delete': {
            const next = structuredClone(this.store.state), groups = next.config.skillGroups ??= [];
            const previous = groups.find(group => group.id === input.id);
            if (input.id && (!previous || !isDeepStrictEqual(previous, input.previous)))
                fail('group-conflict', 'This skill group changed; reopen it before saving', 409);
            if (input.action === 'skill-group-delete') {
                if (!previous)
                    fail('group-not-found', 'Unknown skill group', 404);
                next.config.skillGroups = groups.filter(group => group.id !== input.id);
            }
            else {
                const group = { id: previous?.id ?? randomUUID(), name: typeof input.name === 'string' ? input.name.trim() : input.name, skills: input.skills };
                if (previous)
                    groups[groups.indexOf(previous)] = group;
                else
                    groups.push(group);
                validateGroups(groups);
            }
            await this.store.save(next);
            if (input.action !== 'skill-group-delete')
                return this.snapshot();
            const token = randomUUID(), expiresAt = Date.now() + 5000;
            const timer = setTimeout(() => this.deletedGroups.delete(token), 5000);
            const order = groupOrderWithUndo(groups, this.deletedGroups);
            this.deletedGroups.set(token, { group: previous, following: order.slice(order.indexOf(previous.id) + 1), expiresAt, timer });
            return { ...await this.snapshot(), undo: { token, expiresAt } };
        }
        case 'snapshot-settings': {
            const next = structuredClone(this.store.state), previous = snapshotSettings(next.config);
            const enabled = input.enabled ?? previous.enabled, limit = input.limit ?? previous.limit;
            if (typeof enabled !== 'boolean' || !Number.isInteger(limit) || limit < 1 || limit > 9)
                fail('invalid-snapshot-settings', '请输入整数：1-9');
            const maximum = Math.max(0, ...next.presets.map(preset => historyFor(next, preset.id).length));
            if (limit < maximum)
                fail('snapshot-limit-protected', `当前存在 ${maximum} 份快照，若想调整份数，请删除快照`, 409, { minimum: maximum });
            next.config.snapshots = { enabled, limit };
            await this.store.save(next);
            return this.snapshot();
        }
        case 'snapshot-delete': {
            this.preset(input.id);
            const entry = historyFor(this.store.state, input.id).find(row => row.id === input.snapshotId);
            if (!entry)
                fail('snapshot-not-found', 'Snapshot no longer exists', 404);
            const next = structuredClone(this.store.state);
            next.histories[input.id] = historyFor(next, input.id).filter(row => row.id !== entry.id);
            await this.store.save(next);
            const token = randomUUID(), expiresAt = Date.now() + 5000;
            const deleted = { presetId: input.id, entry, expiresAt };
            this.deletedSnapshots.set(token, deleted);
            deleted.timer = setTimeout(() => this.store.run(async () => { this.deletedSnapshots.delete(token); await this.cleanupSnapshots(input.id); }).catch(error => this.ctx.logger.warn(error)), 5000);
            return { state: await this.snapshot(), token, expiresAt };
        }
        case 'snapshot-undo': {
            const deleted = this.deletedSnapshots.get(input.token);
            if (!deleted || Date.now() >= deleted.expiresAt)
                fail('undo-expired', 'Undo has expired', 409);
            this.preset(deleted.presetId);
            const next = structuredClone(this.store.state), entries = historyFor(next, deleted.presetId);
            const ordered = [...entries, deleted.entry].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const limit = snapshotSettings(next.config).limit;
            ordered.length = Math.min(ordered.length, limit);
            next.histories[deleted.presetId] = ordered;
            await this.store.save(next);
            clearTimeout(deleted.timer);
            this.deletedSnapshots.delete(input.token);
            await this.cleanupSnapshots(deleted.presetId);
            return { state: await this.snapshot() };
        }
        case 'snapshot-restore': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            const saved = await this.store.readSnapshot(previous.id, input.snapshotId);
            const preset = await this.validatedPreset({ ...saved.preset, id: previous.id, name: previous.name, description: previous.description, enabled: previous.enabled }, previous);
            const next = structuredClone(this.store.state);
            next.presets[next.presets.findIndex(row => row.id === preset.id)] = preset;
            const protection = input.draft ? await this.validatedPreset({ ...previous, ...input.draft }, previous) : previous;
            const writes = await this.recordSnapshot(next, protection, 'restore', input);
            await this.commitState(next, [preset], writes);
            await this.cleanupSnapshots(preset.id);
            return this.snapshot();
        }
        case 'apply': {
            const preset = this.preset(input.id);
            if (!preset.enabled)
                fail('preset-disabled', 'Preset must be enabled before applying');
            const agent = this.ctx.agents.get(input.sessionId);
            if (!agent)
                fail('session-not-found', 'Apply requires an open session', 404);
            if (!this.isBlank(agent))
                fail('agent-preset/locked', 'This session has already started', 409);
            if (!await this.ctx.sessions.flush(agent.session))
                fail('session-not-persisted', 'No durability listener for this session', 503);
            await this.ctx.agentPresets.select(agent, preset.id);
            await this.attachAgent(agent);
            if (!await this.ctx.sessions.flush(agent.session))
                fail('session-not-persisted', 'No durability listener for this session', 503);
            return this.snapshot();
        }
        case 'default': {
            const preset = this.preset(input.id);
            if (!preset.enabled)
                fail('preset-disabled', 'Default preset must be enabled');
            await this.setDefault(preset.id);
            return this.snapshot();
        }
        case 'references': {
            const preset = this.preset(input.id);
            const fallbackId = this.store.state.config.fallbackPresetId === preset.id ? BUILTIN_ID : this.store.state.config.fallbackPresetId;
            return { references: await this.references(preset.id), fallback: this.preset(fallbackId) };
        }
        case 'scan': {
            return this.scanCatalog(input.id ?? this.store.state.config.selectedPresetId, input);
        }
        case 'create': {
            const preset = await this.validatedPreset(this.freshPreset(input.id, input.name), undefined, this.store.state.presets, await this.ctx.agentPresets.list());
            return this.commitPreset(preset);
        }
        case 'save': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            record(input.changes, 'changes');
            const preset = await this.validatedPreset({ ...previous, ...input.changes }, previous);
            if (preset.enabled !== previous.enabled)
                fail('use-toggle', 'Use the enable/disable action');
            return this.commitPreset(preset, previous, 'save', input);
        }
        case 'mcp-create': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            const server = structuredClone(input.server);
            const preset = await this.validatedPreset({ ...previous, mcp: [...(previous.mcp ?? []), server] }, previous);
            return this.commitPreset(preset, previous);
        }
        case 'mcp-update': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            if (typeof input.serverName !== 'string' || !input.serverName)
                fail('invalid-mcp', 'serverName is required');
            const current = (previous.mcp ?? []).find(server => server.serverName === input.serverName);
            if (!current)
                fail('mcp-not-found', `Unknown MCP server: ${input.serverName}`, 404);
            const server = structuredClone(input.server);
            if (server.serverName !== input.serverName)
                fail('immutable-mcp-name', 'MCP serverName cannot be changed');
            const preset = await this.validatedPreset({ ...previous, mcp: previous.mcp.map(item => item.serverName === input.serverName ? server : item) }, previous);
            return this.commitPreset(preset, previous);
        }
        case 'mcp-delete': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            if (typeof input.serverName !== 'string' || !input.serverName)
                fail('invalid-mcp', 'serverName is required');
            if (!(previous.mcp ?? []).some(server => server.serverName === input.serverName))
                fail('mcp-not-found', `Unknown MCP server: ${input.serverName}`, 404);
            const servers = previous.mcp.filter(server => server.serverName !== input.serverName);
            const owner = name => (previous.mcp.filter(server => name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0]?.serverName);
            const enabled = previous.tools.enabled.filter(name => owner(name) !== input.serverName);
            const preset = await this.validatedPreset({ ...previous, mcp: servers, tools: { ...previous.tools, enabled } }, previous);
            return this.commitPreset(preset, previous);
        }
        case 'reset': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            const preset = { ...this.freshPreset(previous.id, previous.name, previous.builtin), enabled: previous.enabled, description: previous.description, revision: previous.revision + 1 };
            return this.commitPreset(preset, previous, 'reset', input);
        }
        case 'toggle':
        case 'delete': {
            const previous = this.preset(input.id);
            this.revision(input, previous);
            if (previous.builtin)
                fail('protected-preset', 'The built-in preset cannot be disabled or deleted');
            if (input.action === 'toggle' && typeof input.enabled !== 'boolean')
                fail('invalid-enabled', 'enabled: expected a boolean');
            if (input.action === 'toggle' && input.enabled) {
                this.retired.delete(previous.id);
                return this.commitPreset({ ...previous, enabled: true, revision: previous.revision + 1 }, previous);
            }
            const references = await this.references(previous.id);
            if (references.length && input.confirm !== true)
                fail('confirmation-required', 'Session fallback must be confirmed', 409);
            const fallback = this.store.state.config.fallbackPresetId === previous.id ? BUILTIN_ID : this.store.state.config.fallbackPresetId;
            // Successful fallback events remain even if a later write fails.
            // Keep the original preset available; do not blindly reverse durable
            // session events that another process may already have observed.
            await this.migrate(previous.id, fallback, references);
            this.retired.set(previous.id, fallback);
            const next = structuredClone(this.store.state);
            if (input.action === 'delete') {
                next.presets = next.presets.filter(p => p.id !== previous.id);
                next.config.presetIds = next.config.presetIds.filter(id => id !== previous.id);
                delete next.histories?.[previous.id];
            }
            else
                next.presets[next.presets.findIndex(p => p.id === previous.id)] = { ...previous, enabled: false, revision: previous.revision + 1 };
            if (next.config.selectedPresetId === previous.id)
                next.config.selectedPresetId = fallback;
            if (next.config.fallbackPresetId === previous.id)
                next.config.fallbackPresetId = fallback;
            await this.store.save(next);
            await this.unregister(previous.id);
            await this.refreshBlankAgents();
            if (input.action !== 'delete')
                return this.snapshot();
            for (const [token, deleted] of this.deletedSnapshots)
                if (deleted.presetId === previous.id) {
                    clearTimeout(deleted.timer);
                    this.deletedSnapshots.delete(token);
                }
            return this.snapshot();
        }
        case 'settings': {
            const next = structuredClone(this.store.state);
            applySettings(next.config, next.presets, input.changes);
            const fallback = await this.ctx.agentPresets.resolve(next.config.fallbackPresetId);
            if (fallback.broken)
                fail('broken-fallback', fallback.broken, 503);
            await this.store.save(next);
            this.configurePolling();
            return this.snapshot();
        }
        case 'export': {
            if (input.format && input.format !== 'zip')
                fail('invalid-format', 'Exports use ZIP');
            const ids = Array.isArray(input.ids) ? [...new Set(input.ids)] : undefined;
            if (ids && (!ids.length || ids.some(id => typeof id !== 'string')))
                fail('invalid-export', 'Select one or more presets');
            const presets = input.all ? this.store.state.presets : ids ? ids.map(id => this.preset(id)) : [this.preset(input.id)];
            const skills = (await this.sourceSkills(input.cwd)).skills;
            const portable = [];
            for (const preset of presets) {
                const defaults = await this.preview({ ...input, id: preset.id, draft: { prompt: { persona: preset.prompt.persona, sections: {} } } });
                const native = Object.fromEntries(defaults.editableSections.map(section => [section.name, section.text]));
                native[AGENT_SECTION] = defaults.agentInstructions.original;
                const servers = [...(preset.mcp ?? []), ...[...(this.catalog.mcpConfigs?.values() ?? [])].filter(server => preset.mcpEnabled?.[server.serverName] !== false)];
                portable.push(portablePreset(preset, this.catalog.forPreset(preset), skills, servers, native));
            }
            return writePresetArchive(portable);
        }
        case 'import-inspect':
        case 'import': {
            if (input.mode !== undefined)
                fail('invalid-import-mode', 'Import creates new presets only');
            const items = readPresetArchive(input.data);
            if (input.edits !== undefined && (!Array.isArray(input.edits) || input.edits.length !== items.length))
                fail('invalid-import', 'Provide one edit per preset');
            const next = structuredClone(this.store.state), roster = await this.ctx.agentPresets.list(), changed = [], inspected = [];
            for (const [index, item] of items.entries()) {
                const plan = importPlan(item, this.catalog.tools, input.edits?.[index]);
                const globalNames = new Set(this.catalog.mcpServers.map(server => server.serverName));
                plan.preset.mcpEnabled = Object.fromEntries(plan.preset.mcp.filter(server => globalNames.has(server.serverName)).map(server => [server.serverName, false]));
                plan.preset.mcp = plan.preset.mcp.filter(server => !globalNames.has(server.serverName));
                const conflicts = [...next.presets, ...roster, ...changed].filter(row => row.id === plan.preset.id || row.name === plan.preset.name?.trim()).map(row => ({ id: row.id, name: row.name }));
                if (input.action === 'import' && conflicts.length)
                    fail('import-conflict', 'Preset ID or name already exists; rename it before importing', 409, { index, conflicts });
                const preset = await this.validatedPreset(plan.preset, undefined, input.action === 'import' ? next.presets : [], input.action === 'import' ? roster : []);
                if (input.action === 'import-inspect') {
                    const view = await this.preview({ ...input, id: preset.id, sessionId: undefined, draft: undefined }, { ...preset, enabled: false });
                    inspected.push({ item, tools: plan.tools, conflicts, system: view.sections.filter(section => section.name !== 'preset-workshop:persona' && !preset.prompt.sections[section.name]?.custom), user: snapshotView(preset, view).user });
                }
                else {
                    changed.push(preset);
                    next.presets.push(preset);
                    next.config.presetIds.push(preset.id);
                    next.config.selectedPresetId = preset.id;
                }
            }
            if (input.action === 'import-inspect')
                return { presets: inspected };
            await this.commitState(next, changed);
            return this.snapshot();
        }
        default: fail('unknown-action', 'Unknown action');
    }
}
