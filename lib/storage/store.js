import { mkdir, open, readFile, rename, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BUILTIN_ID, newPreset, fail, validatePreset, record } from '../domain/core.js';
import { validateGroups, snapshotSettings, historyFor, validateSnapshotView, validateSnapshotSummary } from '../history/history.js';
export function dataRoot(env = process.env) {
    const configured = env.DSH_HOME, home = configured?.trim() ? configured : join(homedir(), '.dsh');
    const expanded = home === '~' ? homedir() : /^~[/\\]/.test(home) ? join(homedir(), home.slice(2)) : home;
    return join(resolve(expanded), 'preset-workshop');
}
async function readJSON(path, fallback) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return fallback;
        throw error;
    }
}
export async function atomicJSON(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    let file;
    try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(JSON.stringify(value, null, 2) + '\n');
        await file.sync();
        await file.close();
        file = undefined;
        await rename(temporary, path);
    }
    finally {
        await file?.close();
        await rm(temporary, { force: true });
    }
}
export class WorkshopStore {
    constructor(root = dataRoot()) { this.root = root; this.queue = Promise.resolve(); }
    run(task, withLock = true) {
        // ponytail: one writer queue for the whole workshop; split only if contention matters.
        const result = this.queue.then(async () => {
            if (!withLock || !this.lock)
                return task();
            await mkdir(this.root, { recursive: true, mode: 0o700 });
            return this.lock(join(this.root, 'config.json'), task);
        });
        this.queue = result.catch(() => { });
        return result;
    }
    async init() {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const pending = await readJSON(join(this.root, '.pending.json'));
        if (pending)
            await this.publish(pending, null);
        const config = await readJSON(join(this.root, 'config.json'));
        if (!config) {
            this.state = { config: { version: 1, presetIds: [BUILTIN_ID], selectedPresetId: BUILTIN_ID, fallbackPresetId: BUILTIN_ID, polling: false, scanInterval: 300, ui: {}, skillGroups: [], snapshots: { enabled: false, limit: 3 } }, presets: [newPreset(BUILTIN_ID, BUILTIN_ID, true, process.platform === 'win32' ? 'pwsh' : 'bash')], histories: {} };
            await this.save(this.state);
            return;
        }
        if (config.version !== 1 || !Array.isArray(config.presetIds) || new Set(config.presetIds).size !== config.presetIds.length)
            fail('unsupported-config', 'Unsupported configuration version or duplicate preset ids');
        const presets = [], histories = {};
        for (const id of config.presetIds) {
            if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))
                fail('invalid-id', `Stored id is invalid: ${id}`);
            const dir = join(this.root, 'presets', id);
            const meta = await readJSON(join(dir, 'preset.json'));
            const prompt = await readJSON(join(dir, 'prompt.json'));
            const tools = await readJSON(join(dir, 'tools.json'));
            if (!meta || !prompt || !tools)
                fail('incomplete-config', `Incomplete preset: ${id}`);
            if (meta.id !== id)
                fail('invalid-id', `Stored preset identity differs from its directory: ${id}`);
            const p = { ...meta, prompt, tools };
            p.mcp ??= [];
            validatePreset(p, p, presets);
            presets.push(p);
            histories[id] = await readJSON(join(dir, 'snapshots', 'index.json'), []);
        }
        config.skillGroups ??= [];
        config.snapshots ??= { enabled: false, limit: 3 };
        validateState({ config, presets, histories });
        delete config.maxPresets;
        this.state = { config, presets, histories };
        for (const preset of presets)
            await this.pruneSnapshots(preset.id);
    }
    async save(state, recover = false, snapshotWrites = []) {
        validateState(state);
        const current = await readJSON(join(this.root, 'config.json'));
        if (!recover && (current?.generation ?? 0) !== (this.state?.config.generation ?? 0))
            fail('store-conflict', 'Configuration changed in another process; reload the plugin before saving', 409);
        const next = structuredClone(state);
        next.config.generation = (current?.generation ?? 0) + 1;
        const journal = { ...next, snapshotWrites };
        await atomicJSON(join(this.root, '.pending.json'), journal);
        try {
            await this.publish(journal, recover || !current ? null : this.state);
        }
        catch (error) {
            // All callers, including delete/settings, must leave a failed update recoverable.
            if (!recover && current && this.state) {
                try {
                    await this.save(this.state, true);
                }
                catch (recovery) {
                    error.recoveryError = recovery.message;
                }
            }
            throw error;
        }
        this.state = next;
    }
    async publish(state, previous = this.state) {
        validateState(state);
        for (const write of state.snapshotWrites ?? []) {
            const entry = historyFor(state, write.presetId).find(item => item.id === write.id);
            if (!entry || write.value?.preset?.id !== write.presetId)
                fail('invalid-snapshot', 'Snapshot journal identity is inconsistent');
            validatePreset(write.value.preset, write.value.preset);
            validateSnapshotView(write.value.view);
            const dir = join(this.root, 'presets', write.presetId, 'snapshots');
            await mkdir(dir, { recursive: true, mode: 0o700 });
            await atomicJSON(join(dir, write.id + '.json'), write.value);
        }
        // The journal is replayed at startup if a multi-file update was interrupted.
        for (const preset of state.presets) {
            if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(preset.id))
                fail('invalid-id', 'Invalid journal preset id');
            const dir = join(this.root, 'presets', preset.id);
            await mkdir(dir, { recursive: true, mode: 0o700 });
            const { prompt, tools, ...meta } = preset;
            const old = previous?.presets.find(item => item.id === preset.id);
            const oldMeta = old && Object.fromEntries(Object.entries(old).filter(([key]) => !['prompt', 'tools'].includes(key)));
            if (!old || JSON.stringify(meta) !== JSON.stringify(oldMeta))
                await atomicJSON(join(dir, 'preset.json'), meta);
            if (!old || JSON.stringify(prompt) !== JSON.stringify(old.prompt))
                await atomicJSON(join(dir, 'prompt.json'), prompt);
            if (!old || JSON.stringify(tools) !== JSON.stringify(old.tools))
                await atomicJSON(join(dir, 'tools.json'), tools);
            if (!previous || JSON.stringify(historyFor(state, preset.id)) !== JSON.stringify(historyFor(previous, preset.id))) {
                await mkdir(join(dir, 'snapshots'), { recursive: true, mode: 0o700 });
                await atomicJSON(join(dir, 'snapshots', 'index.json'), historyFor(state, preset.id));
            }
        }
        await atomicJSON(join(this.root, 'config.json'), state.config);
        for (const dir of await readdir(join(this.root, 'presets'))) {
            if (!state.presets.some(p => p.id === dir))
                await rm(join(this.root, 'presets', dir), { recursive: true, force: true });
        }
        await rm(join(this.root, '.pending.json'), { force: true });
    }
    async readSnapshot(presetId, id) {
        if (!historyFor(this.state, presetId).some(item => item.id === id))
            fail('snapshot-not-found', 'Snapshot no longer exists', 404);
        const value = await readJSON(join(this.root, 'presets', presetId, 'snapshots', id + '.json'));
        if (value?.preset?.id !== presetId || !value.view)
            fail('invalid-snapshot', 'Snapshot is incomplete');
        validatePreset(value.preset, value.preset);
        validateSnapshotView(value.view);
        return value;
    }
    async pruneSnapshots(presetId, keep = []) {
        if (!this.state.presets.some(preset => preset.id === presetId))
            return;
        const dir = join(this.root, 'presets', presetId, 'snapshots');
        const files = await readdir(dir).catch((error) => { if (error.code === 'ENOENT')
            return []; throw error; });
        const retained = new Set([...historyFor(this.state, presetId).map(item => item.id + '.json'), ...keep.map(id => id + '.json'), 'index.json']);
        for (const file of files)
            if (/^[0-9a-f-]{36}\.json$/.test(file) && !retained.has(file))
                await rm(join(dir, file), { force: true });
    }
}
function validateState({ config, presets, histories = {} }) {
    record(config, 'config');
    if (config.version !== 1 || !Array.isArray(presets) || !presets.length || !Array.isArray(config.presetIds) || new Set(config.presetIds).size !== config.presetIds.length || config.presetIds.length !== presets.length || config.presetIds.some((id, i) => id !== presets[i].id))
        fail('invalid-config', 'Preset index is inconsistent');
    if (!Number.isInteger(config.scanInterval) || config.scanInterval < 1 || config.scanInterval > 2147483 || typeof config.polling !== 'boolean')
        fail('invalid-config', 'Invalid scan settings');
    if (config.generation !== undefined && (!Number.isSafeInteger(config.generation) || config.generation < 0))
        fail('invalid-config', 'Invalid configuration generation');
    record(config.ui, 'config.ui');
    validateGroups(config.skillGroups ?? []);
    const snapshots = snapshotSettings(config);
    if (typeof snapshots.enabled !== 'boolean' || !Number.isInteger(snapshots.limit) || snapshots.limit < 1 || snapshots.limit > 9)
        fail('invalid-snapshot-settings', 'Snapshot limit must be an integer from 1 to 9');
    record(histories, 'histories');
    for (const [presetId, entries] of Object.entries(histories)) {
        if (!presets.some(preset => preset.id === presetId) || !Array.isArray(entries) || entries.length > snapshots.limit)
            fail('invalid-history', 'Invalid snapshot index');
        const ids = new Set();
        for (const entry of entries) {
            if (!entry || typeof entry.id !== 'string' || !/^[0-9a-f-]{36}$/.test(entry.id) || ids.has(entry.id) || !Number.isFinite(Date.parse(entry.createdAt)) || !['save', 'reset', 'restore', 'import'].includes(entry.reason))
                fail('invalid-history', 'Invalid snapshot metadata');
            ids.add(entry.id);
            validateSnapshotSummary(entry.summary);
        }
    }
    if (!presets.some(p => p.id === config.selectedPresetId) || !presets.some(p => p.id === config.fallbackPresetId && p.enabled))
        fail('invalid-config', 'Selected preset or fallback is missing');
    if (!presets.some(p => p.id === BUILTIN_ID && p.builtin && p.enabled) || presets.some(p => p.builtin && p.id !== BUILTIN_ID))
        fail('missing-fallback', 'Built-in fallback identity is missing, duplicated or disabled');
    const seen = [];
    for (const p of presets) {
        if (typeof p.builtin !== 'boolean')
            fail('invalid-config', 'Invalid built-in flag');
        if (!Number.isSafeInteger(p.revision) || p.revision < 1)
            fail('invalid-revision', 'Invalid stored preset revision');
        validatePreset(p, p, seen);
        seen.push(p);
    }
}
