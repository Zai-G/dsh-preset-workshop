import { createScope } from '@deepseek-ai/dsh-scope';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, isAbsolute } from 'node:path';
import { AGENT_SECTION, USER_DIRECTORY, TIME_CONTEXT, fail } from '../domain/core.js';
import type { Preset } from '../domain/types.js';
import type { HostFileSystem, HostSkillSummary } from '../runtime/host.js';
import type { PresetWorkshop } from './index.js';

type InstructionTarget = { kind: 'absent' } | { kind: 'text'; text: string } | { kind: 'file'; target: unknown };

function plainInstructionContent(text = '', displayPaths: string[] = []) {
  const frame = /^\s*<system-reminder>\s*([\s\S]*?)<\/system-reminder>\s*$/.exec(text);
  if (!frame) return text.trim();
  if (!frame[1].includes('Instructions from:')) return '';
  const headers = new Set(displayPaths.map(path => `Instructions from: ${path}`));
  const lines = frame[1].split(/\r?\n/);
  const start = lines.findIndex(line => headers.has(line));
  if (start < 0) return '';
  const content = [];
  for (let index = start; index < lines.length; index++) {
    if (headers.has(lines[index]) && lines[index + 1] === '') { index++; continue; }
    content.push(lines[index]);
  }
  return content.join('\n').trim();
}
export async function sourceSkills(this: PresetWorkshop, cwd?: string, signal?: AbortSignal) {
  const { skills, complete } = await this.sourceSkillCatalog(cwd, signal);
  return { skills, complete };
}
export async function sourceSkillCatalog(this: PresetWorkshop, cwd?: string, signal?: AbortSignal) {
  const [global, roster] = await Promise.all([this.ctx.skills.snapshot({ cwd, signal }), this.ctx.agentPresets.list()]);
  let complete = global.complete;
  const skills = new Map<string, HostSkillSummary>(global.skills.map(skill => [skill.name, skill]));
  const owners = new Map<string, string>();
  const rows = roster.filter(row => !this.ownsPreset(row.id) && !row.broken);
  const results = await Promise.allSettled(rows.map(row => this.withSourceRegistry(row.id, async (registry, scope) => ({ ...await registry.snapshot({ cwd, scope, signal }), shared: registry.layers === this.ctx.skills.layers }))));
  for (const [index, result] of results.entries()) {
    signal?.throwIfAborted();
    if (result.status === 'rejected') { complete = false; this.ctx.logger.warn(`Preset Workshop skills (${rows[index].id}): ${result.reason.message}`); continue; }
    const row = rows[index], source = result.value;
    complete &&= source.complete;
    for (const skill of source.skills) {
      // A native preset's filesystem provider shadows the host layer (for
      // example user/project SKILL.md replacing bundled Office). Keep list
      // and get on that same winner, rather than preferring the global copy.
      if (!skills.has(skill.name) || (source.shared && !owners.has(skill.name) && JSON.stringify(skill) !== JSON.stringify(skills.get(skill.name)))) {
        skills.set(skill.name, skill); owners.set(skill.name, row.id);
      }
    }
  }
  return { skills: [...skills.values()].sort((a, b) => a.name.localeCompare(b.name)), complete, owners };
}
export function ownsPreset(this: PresetWorkshop, id: string) { return this.registrations.has(id) || this.store.state.presets.some(p => p.id === id); }
export async function getSourceSkill(this: PresetWorkshop, name: string, cwd?: string, signal?: AbortSignal) {
  const { owners, skills } = await this.sourceSkillCatalog(cwd, signal);
  if (!skills.some(skill => skill.name === name)) return;
  const owner = owners.get(name);
  return owner ? this.withSourceRegistry(owner, (registry, scope) => registry.get(name, { cwd, scope, signal })) : this.ctx.skills.get(name, { cwd, signal });
}
export async function skillDetail(this: PresetWorkshop, name: unknown, cwd?: string) {
  if (typeof name !== 'string') fail('invalid-skill', 'name: expected text');
  const skill = await this.getSourceSkill(name, cwd);
  if (!skill) fail('skill-not-found', 'Skill was not found in this workspace', 404);
  const path = skill.path || (skill.resourceBase?.kind === 'directory' ? join(skill.resourceBase.path, 'SKILL.md') : undefined);
  let fileContent, fileError;
  if (path && isAbsolute(path)) {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw Error('Skill source must be a text file no larger than 2 MiB');
      const raw = await readFile(path, 'utf8');
      const header = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw);
      fileContent = (header ? raw.slice(header[0].length) : raw).trim();
    } catch (error) { fileError = error.message; }
  }
  const content = fileContent ?? skill.content;
  const runtimeContent = fileContent !== undefined && skill.content.trim() !== fileContent ? (skill.content.trim().startsWith(fileContent) ? skill.content.trim().slice(fileContent.length).trim() : skill.content) : '';
  return { ...skill, path, content, runtimeContent, fileError, bodySource: fileContent === undefined ? 'provider' : 'file' };
}
export async function withSourceRegistry<T>(this: PresetWorkshop, id: string, read: (registry: PresetWorkshop['ctx']['skills'], scope: object) => T | Promise<T>) {
  const lease = await this.ctx.agentPresets.acquireScope(id);
  const scope = createScope(this.ownerCtx, {}, { parent: lease.key });
  try { return await read(this.ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'skills') ?? this.ctx.skills, lease.key); }
  finally { await scope.dispose(); await lease[Symbol.asyncDispose](); }
}
export function invalidateSkills(this: PresetWorkshop) {
  if (this.invalidatingSkills || this.stopping) return;
  this.invalidatingSkills = true;
  try { for (const registry of new Set([...this.scopes.values()].map(source => source.ctx.skills))) registry.invalidateCache(); }
  finally { this.invalidatingSkills = false; }
}
export function instructionConfig(this: PresetWorkshop) {
  const row = [...this.ownerCtx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-instructions' && !entry.id.includes('workshop-agent-instructions'));
  return { maxBytes: 65536, ...row?.options.config };
}
export function globalInstructionPaths(this: PresetWorkshop) {
  const dshHome = this.homePaths.resolveDshHome(this.homePaths.resolveAgentsHome ? undefined : this.instructionConfig().dshHome);
  const roots = [{ home: dshHome, display: this.homePaths.dshHomeDisplay(dshHome) }];
  if (this.homePaths.resolveAgentsHome) {
    const home = this.homePaths.resolveAgentsHome();
    if (home !== dshHome) roots.push({ home, display: this.homePaths.agentsHomeDisplay(home) });
  }
  return roots.map(root => ({ path: join(root.home, 'AGENTS.md'), displayPath: root.display + '/AGENTS.md' }));
}
export function instructionFileSystem(this: PresetWorkshop, fs: HostFileSystem, sections: () => Preset['prompt']['sections']) {
  if (!fs) return;
  const paths = this.globalInstructionPaths();
  const globalPaths = paths.map(source => resolve(source.path));
  const globalTargets = Promise.all(globalPaths.map(async path => {
    try { return (await fs.resolve(path)).targetKey; }
    catch { return undefined; }
  }));
  const config = this.instructionConfig();
  const candidates = new Set([...(config.instructionFileCandidates ?? ['AGENTS.md', 'CLAUDE.md']), ...(config.localInstructionFileCandidates ?? ['AGENTS.local.md', 'CLAUDE.local.md'])]);
  // Only the host instruction loader sees this read-only preset view.
  return {
    resolve: async (path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<InstructionTarget> => {
      options?.signal?.throwIfAborted();
      const absolute = resolve(options?.cwd ?? '.', path), index = globalPaths.indexOf(absolute);
      const policy = sections(), global = policy[AGENT_SECTION];
      if (index >= 0) {
        if (global?.enabled === false || index > 0 && global && !global.inherit) return { kind: 'absent' };
        if (global && !global.inherit) return { kind: 'text', text: global.text };
      } else if (policy[USER_DIRECTORY]?.enabled === false && candidates.has(basename(absolute))) return { kind: 'absent' };
      const target = await fs.resolve(path, options), key = target.targetKey;
      if (index < 0 && key !== undefined && (await globalTargets).some(globalKey => globalKey !== undefined && globalKey === key)) return { kind: 'absent' };
      return { kind: 'file', target };
    },
    stat: async (target: InstructionTarget, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (target.kind === 'absent') return undefined;
      if (target.kind === 'text') return { type: 'file', size: Buffer.byteLength(target.text), version: createHash('sha1').update(target.text).digest('hex') };
      return fs.stat(target.target, signal);
    },
    streamText: async (target: InstructionTarget, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (target.kind === 'text') return (async function* () { signal?.throwIfAborted(); yield target.text; })();
      if (target.kind === 'absent') throw Error('Instruction file is disabled');
      return fs.streamText(target.target, signal);
    },
  };
}
export async function workspaceInstructions(this: PresetWorkshop, cwd: string, scope: { get(name: string): HostFileSystem | undefined }, preset: Preset) {
  const fs = scope.get('fs');
  const config = this.instructionConfig(), paths = this.globalInstructionPaths(), path = paths[0].path;
  const files: { absolutePath: string; displayPath: string; content: string }[] = [];
  if (this.instructions && fs && config.maxBytes > 0) for (const source of paths) {
    let content = '';
    try {
      const target = await fs.resolve(source.path), info = await fs.stat(target);
      const limit = config.maxSourceBytes ?? 1048576;
      if (info?.type === 'file' && (info.size === undefined || info.size <= limit)) {
        let size = 0;
        for await (const chunk of await fs.streamText(target)) {
          size += Buffer.byteLength(chunk, 'utf8');
          if (size > limit) { content = ''; break; }
          content += chunk;
        }
      }
    } catch (error) {
      if (!['FS_NOT_FOUND', 'ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    if (content.trim() && !files.some(file => file.content.trim() === content.trim())) files.push({ absolutePath: source.path, displayPath: source.displayPath, content });
  }
  const original = files.map(file => file.content).join('\n\n');
  const edit = preset.prompt.sections[AGENT_SECTION];
  const text = edit?.inherit ? original : edit?.text ?? original;
  const renderedFiles = edit && !edit.inherit ? [{ absolutePath: path, displayPath: paths[0].displayPath, content: text }] : files;
  const renderedText = this.instructions && text ? this.instructions.renderAgentInstructions(renderedFiles, { maxBytes: config.maxBytes }).text : '';
  const discovery = { ...config, cwd, dshHome: dirname(path), ...(this.homePaths.resolveAgentsHome ? { agentsHome: this.homePaths.resolveAgentsHome() } : {}) };
  const directoryFs = this.instructions && fs ? this.instructionFileSystem(fs, () => ({ ...preset.prompt.sections, [AGENT_SECTION]: { text: '', order: 0, enabled: false }, [USER_DIRECTORY]: { text: '', order: 0, enabled: true } })) : undefined;
  const globalPaths = new Set(paths.map(source => resolve(source.path)));
  const directoryFiles = directoryFs ? (await this.instructions.discoverBaselineInstructionFiles(discovery)).filter(file => !globalPaths.has(resolve(file.absolutePath))) : [];
  const directory = directoryFs ? await this.instructions.loadBaselineInstructions(discovery, directoryFs) : undefined;
  const requestFs = this.instructions && fs ? this.instructionFileSystem(fs, () => preset.prompt.sections) : undefined;
  const requestText = requestFs ? (await this.instructions.loadBaselineInstructions(discovery, requestFs))?.text ?? '' : '';
  return { name: AGENT_SECTION, text, original, renderedText, requestText, directoryText: plainInstructionContent(directory?.text, directoryFiles.map((file: { displayPath: string }) => file.displayPath)), directoryMessageText: directory?.text ?? '', path, enabled: edit?.enabled ?? true, editable: Boolean(this.instructions && fs), reorderable: false, delivery: 'user-message', order: 0 };
}
export async function previewSkillCatalog(this: PresetWorkshop, registry, scope, cwd, enabled) {
  // Run the public official plugin's catalog hooks against an empty preview
  // session. This keeps its exact framing/escaping/description limit in sync.
  const hooks = [], session = this.ctx.sessions.prepare(undefined, { meta: { cwd } });
  let registration;
  const context = { agent: { session }, messages: [], signal: new AbortController().signal };
  // The registry provider uses the normal scope key for draft policy lookup.
  const scopedRegistry = { get: (name, options) => registry.get(name, { ...options, scope }), snapshot: options => registry.snapshot({ ...options, scope }) };
  this.skillModule.apply({ tools: { register(tool) { registration = tool; }, get: () => enabled ? registration : undefined }, skills: scopedRegistry, workingDirectory: { ensure: async () => cwd }, on(event, hook) { if (event === 'agent/pre-step') hooks.push(hook); } }, this.catalog.packages.find(pkg => pkg.name === '@deepseek-ai/dsh-tool-skill')?.row.config ?? {});
  let decision = { kind: 'continue', messages: [] };
  for (const hook of hooks.toReversed()) { const previous = decision; decision = await hook(context, async () => previous); }
  return decision.messages.find(message => message.source.kind === 'skill-catalog');
}
export async function previewTimeContext(this: PresetWorkshop, cwd: string) {
  // Only the native clock hook runs on a detached session; no Host hooks or history writes.
  let hook;
  await this.timeModule.apply({
    fiber: { assertActive() {} },
    sessionProjections: { async register(value) { return { stateOf: () => value.init(), readerFor: () => () => value.init(), async dispose() {} }; } },
    on(event, listener) { if (event === 'agent/pre-step') hook = listener; },
  }, {});
  const session = this.previewSession(cwd, 'preset_workshop');
  const decision = await hook({ agent: { session }, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'continue', messages: [] }));
  return decision.messages.find(message => message.source.kind === TIME_CONTEXT)?.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n') ?? '';
}
