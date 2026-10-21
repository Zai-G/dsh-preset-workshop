import { mkdir, open, readFile, rename, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BUILTIN_ID, newPreset, fail, validatePreset, record } from './core.js';

export function dataRoot(env = process.env) {
  const configured = env.DSH_HOME, home = configured?.trim() ? configured : join(homedir(), '.dsh');
  const expanded = home === '~' ? homedir() : /^~[/\\]/.test(home) ? join(homedir(), home.slice(2)) : home;
  return join(resolve(expanded), 'preset-workshop');
}
export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function atomicJSON(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
    await file.close(); file = undefined;
    await rename(temporary, path);
  } finally { await file?.close(); await rm(temporary, { force: true }); }
}
export class WorkshopStore {
  constructor(root = dataRoot()) { this.root = root; this.queue = Promise.resolve(); }
  run(task, withLock = true) {
    // ponytail: one writer queue for the whole workshop; split only if contention matters.
    const result = this.queue.then(async () => {
      if (!withLock || !this.lock) return task();
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      return this.lock(join(this.root, 'config.json'), task);
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const pending = await readJSON(join(this.root, '.pending.json'));
    if (pending) await this.publish(pending);
    const config = await readJSON(join(this.root, 'config.json'));
    if (!config) {
      this.state = { config: { version: 1, presetIds: [BUILTIN_ID], selectedPresetId: BUILTIN_ID, fallbackPresetId: BUILTIN_ID, polling: false, scanInterval: 300, ui: {} }, presets: [newPreset(BUILTIN_ID, BUILTIN_ID, true, process.platform === 'win32' ? 'pwsh' : 'bash')] };
      await this.save(this.state);
      return;
    }
    if (config.version !== 1 || !Array.isArray(config.presetIds) || new Set(config.presetIds).size !== config.presetIds.length) fail('unsupported-config', 'Unsupported configuration version or duplicate preset ids');
    const presets = [];
    for (const id of config.presetIds) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) fail('invalid-id', `Stored id is invalid: ${id}`);
      const dir = join(this.root, 'presets', id);
      const meta = await readJSON(join(dir, 'preset.json'));
      const prompt = await readJSON(join(dir, 'prompt.json'));
      const tools = await readJSON(join(dir, 'tools.json'));
      if (!meta || !prompt || !tools) fail('incomplete-config', `Incomplete preset: ${id}`);
      if (meta.id !== id) fail('invalid-id', `Stored preset identity differs from its directory: ${id}`);
      const p = { ...meta, prompt, tools };
      validatePreset(p, p, presets);
      presets.push(p);
    }
    validateState({ config, presets });
    delete config.maxPresets;
    this.state = { config, presets };
  }
  async save(state, recover = false) {
    validateState(state);
    const current = await readJSON(join(this.root, 'config.json'));
    if (!recover && (current?.generation ?? 0) !== (this.state?.config.generation ?? 0)) fail('store-conflict', 'Configuration changed in another process; reload the plugin before saving', 409);
    const next = structuredClone(state);
    next.config.generation = (current?.generation ?? 0) + 1;
    await atomicJSON(join(this.root, '.pending.json'), next);
    try { await this.publish(next); }
    catch (error) {
      // All callers, including delete/settings, must leave a failed update recoverable.
      if (!recover && current && this.state) {
        try { await this.save(this.state, true); }
        catch (recovery) { error.recoveryError = recovery.message; }
      }
      throw error;
    }
    this.state = next;
  }
  async publish(state) {
    validateState(state);
    // The journal is replayed at startup if a multi-file update was interrupted.
    for (const preset of state.presets) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(preset.id)) fail('invalid-id', 'Invalid journal preset id');
      const dir = join(this.root, 'presets', preset.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const { prompt, tools, ...meta } = preset;
      await atomicJSON(join(dir, 'preset.json'), meta);
      await atomicJSON(join(dir, 'prompt.json'), prompt);
      await atomicJSON(join(dir, 'tools.json'), tools);
    }
    await atomicJSON(join(this.root, 'config.json'), state.config);
    for (const dir of await readdir(join(this.root, 'presets'))) {
      if (!state.presets.some(p => p.id === dir)) await rm(join(this.root, 'presets', dir), { recursive: true, force: true });
    }
    await rm(join(this.root, '.pending.json'), { force: true });
  }
}

function validateState({ config, presets }) {
  record(config, 'config');
  if (config.version !== 1 || !Array.isArray(presets) || !presets.length || !Array.isArray(config.presetIds) || new Set(config.presetIds).size !== config.presetIds.length || config.presetIds.length !== presets.length || config.presetIds.some((id, i) => id !== presets[i].id)) fail('invalid-config', 'Preset index is inconsistent');
  if (!Number.isInteger(config.scanInterval) || config.scanInterval < 1 || config.scanInterval > 2147483 || typeof config.polling !== 'boolean') fail('invalid-config', 'Invalid scan settings');
  if (config.generation !== undefined && (!Number.isSafeInteger(config.generation) || config.generation < 0)) fail('invalid-config', 'Invalid configuration generation');
  record(config.ui, 'config.ui');
  if (!presets.some(p => p.id === config.selectedPresetId) || !presets.some(p => p.id === config.fallbackPresetId && p.enabled)) fail('invalid-config', 'Selected preset or fallback is missing');
  if (!presets.some(p => p.id === BUILTIN_ID && p.builtin && p.enabled) || presets.some(p => p.builtin && p.id !== BUILTIN_ID)) fail('missing-fallback', 'Built-in fallback identity is missing, duplicated or disabled');
  const seen = [];
  for (const p of presets) {
    if (typeof p.builtin !== 'boolean') fail('invalid-config', 'Invalid built-in flag');
    if (!Number.isSafeInteger(p.revision) || p.revision < 1) fail('invalid-revision', 'Invalid stored preset revision');
    validatePreset(p, p, seen); seen.push(p);
  }
}
