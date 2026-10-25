import { Service } from '@deepseek-ai/cordis';
import { createScope, scopeChainOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { homedir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { WorkshopStore } from './store.js';
import { ToolCatalog } from './catalog.js';
import { BUILTIN_ID, PERSONA_SECTIONS, AGENT_SECTION, DIRECTORY_AGENT, TOOL_GUIDANCE, TIME_CONTEXT, MCP_CLIENT_MODULE, newPreset, fail, validatePreset, selectedBinding, functionSchema, sameToolSchema, record, filterMcpSections, isLegacyCwdSection } from './core.js';
import { mountRows } from './scope.js';
import { probeMcp } from './mcp.js';

export const inject = ['loader', 'agentPresets', 'tools', 'systemPrompt', 'skills', 'agents', 'sessions', 'sessionProjections'];
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
// JSON may escape each text byte as six bytes (for example a YAML tab).
const MAX_REQUEST_BYTES = MAX_PAYLOAD_BYTES * 6 + 64 * 1024;
export function apply(ctx) {
  const workshop = new PresetWorkshop(ctx);
  // Start after this Host row settles: preset diagnostics may await the Host loader.
  let timer, cancel, started = false;
  workshop.ready = new Promise((resolve, reject) => {
    cancel = () => reject(Object.assign(new Error('Preset Workshop stopped before startup'), { code: 'workshop-stopped', status: 503 }));
    timer = setTimeout(() => { started = true; workshop.start().then(resolve, reject); }, 0);
  });
  workshop.ready.catch(error => { workshop.error = error.message; if (!workshop.stopping) ctx.logger.error(error); });
  ctx.effect(() => async () => {
    workshop.stopping = true;
    clearTimeout(timer);
    if (!started) cancel();
    clearInterval(workshop.pollTimer);
    clearTimeout(workshop.refreshTimer);
    await workshop.ready.catch(() => {});
    await workshop.store.queue;
    for (const state of workshop.agents.values()) state.dispose?.();
    for (const dispose of workshop.registrations.values()) await dispose();
  });
  ctx.on('agent/created', async ({ agent }) => { await workshop.ready; await workshop.attachAgent(agent); });
  ctx.on('agent/disposed', ({ agent }) => { workshop.agents.get(agent)?.dispose?.(); workshop.agents.delete(agent); });
  ctx.on('tools/change', () => workshop.scheduleRestrictions());
  ctx.on('agent-preset/selected', () => workshop.scheduleRestrictions());
  ctx.on('skills/change', () => workshop.invalidateSkills());
  ctx.inject(['webServer'], child => {
    child.effect(() => child.webServer.register({ kind: 'exact', path: '/preset-workshop/api', handler: (req, res) => workshop.handle(req, res) }));
    for (const [file, type] of [['client.html', 'text/html'], ['client.css', 'text/css'], ['assets/icon.png', 'image/png']]) child.effect(() => child.webServer.register({ kind: 'exact', path: '/preset-workshop/' + file.replace('assets/', ''), handler: async (req, res) => {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      try { const body = await readFile(new URL((file.startsWith('assets/') ? '../' : './') + file, import.meta.url)); res.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : body); }
      catch { res.writeHead(503); res.end(); }
    } }));
  });
}

export class PresetWorkshop extends Service {
  constructor(ctx, store = new WorkshopStore()) {
    super(ctx, 'presetWorkshop');
    this.ownerCtx = ctx;
    this.store = store;
    this.catalog = new ToolCatalog(ctx, store.root);
    this.registrations = new Map();
    this.definitions = new Map();
    this.currentScopes = new Map();
    this.retired = new Map();
    this.previewPolicies = new WeakMap();
    this.scopes = new Map();
    this.mcpStates = new Map();
    this.agents = new Map();
    this.warnings = [];
    this.sourceFunctionIds = new WeakMap();
    this.nextSourceFunctionId = 0;
  }
  async start() {
    this.store.lock = (await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-atomic-write')).withFileLock;
    await this.store.run(() => this.store.init());
    await this.catalog.scan();
    const source = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-system-prompt');
    this.renderPrompt = source.renderPrompt;
    this.renderContextSections = source.renderContextSections;
    this.renderContextSnapshot = source.renderContextSnapshot;
    this.fileReferencePrompt = (await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-file-reference')).FILE_REFERENCE_PROMPT;
    this.createUserMessage = (await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-llm')).createUserMessage;
    this.skillModule = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-tool-skill');
    this.timeModule = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-time-context');
    this.homePaths = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-home-paths');
    try { this.instructions = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-agent-instructions'); }
    catch { this.warnings.push({ code: 'instructions-unavailable', detail: 'The host does not provide workspace instructions' }); }
    await this.registerAll();
    for (const agent of this.ctx.agents.list()) await this.attachAgent(agent);
    await this.reconcile();
    await this.updateScanCounts(this.store.state.config.selectedPresetId);
    this.configurePolling();
  }
  preset(id) {
    const p = this.store.state.presets.find(p => p.id === id);
    if (!p) fail('preset-not-found', `Unknown preset: ${id}`, 404);
    return p;
  }
  workingDirectory(session) { return this.ctx.get('workingDirectory')?.get(session) ?? session.header.cwd ?? homedir(); }
  async registerAll() {
    for (const preset of this.store.state.presets) if (preset.enabled && !this.stopping) {
      try { await this.register(preset); }
      catch (error) {
        this.warnings.push({ code: 'registration-failed', id: preset.id, detail: error.message });
        if (preset.builtin && !this.registrations.has(preset.id)) throw error;
      }
    }
    await this.refreshBlankAgents();
  }
  definition(preset) {
    let packages = this.catalog.packages.filter(pkg => pkg.available && !pkg.error && (pkg.light || preset.tools.packages.includes(pkg.name)));
    const replacements = new Set(packages.filter(pkg => !pkg.light).flatMap(pkg => pkg.tools));
    packages = packages.filter(pkg => !pkg.light || !pkg.tools.length || !pkg.tools.every(name => replacements.has(name)));
    const skillPackage = packages.find(pkg => pkg.name === '@deepseek-ai/dsh-tool-skill');
    const rows = this.catalog.rows(packages.filter(pkg => pkg !== skillPackage));
    rows.unshift({
      id: 'workshop-skills', name: 'cordis:group', group: true,
      isolate: { skills: true },
      config: [
        { id: 'registry', name: '@deepseek-ai/dsh-skill', config: {} },
        { id: 'binding', name: new URL('./scope.js', import.meta.url).href, config: { preset: JSON.stringify(preset) } },
        // Skill tools must resolve the filtered registry in this same realm.
        ...(skillPackage ? [{ ...structuredClone(skillPackage.row), id: 'skill-tool' }] : []),
      ],
    });
    for (const server of preset.mcp ?? []) if (server.enabled !== false) {
      const { enabled, ...config } = server;
      rows.push({ id: `workshop-mcp-${server.serverName}`, name: new URL('./mcp.js', import.meta.url).href, config });
    }
    return { id: preset.id, name: preset.name, description: preset.description, order: 100, plugins: rows };
  }
  async register(preset) {
    await this.catalog.prepare(preset);
    const definition = this.definition(preset);
    if (JSON.stringify(this.definitions.get(preset.id)) === JSON.stringify(definition)) return;
    const previous = this.definitions.get(preset.id);
    await this.unregister(preset.id);
    try { await this.installDefinition(definition); }
    catch (error) {
      await this.unregister(preset.id);
      if (previous) await this.installDefinition(previous);
      throw error;
    }
  }
  async installDefinition(definition) {
    this.registrations.set(definition.id, await this.ownerCtx.agentPresets.register(definition));
    const row = (await this.ctx.agentPresets.list()).find(row => row.id === definition.id);
    if (!row || row.broken) fail('broken-preset', row?.broken ?? 'Preset registration disappeared', 503);
    this.definitions.set(definition.id, definition);
    const lease = await this.ctx.agentPresets.acquireScope(definition.id);
    this.currentScopes.set(definition.id, lease.key);
    await lease[Symbol.asyncDispose]();
  }
  async unregister(id) {
    await this.registrations.get(id)?.();
    this.registrations.delete(id);
    this.definitions.delete(id);
    this.currentScopes.delete(id);
  }
  scopeRecord(scope) {
    for (const key of scopeChainOf(scope)) if (this.scopes.has(key)) return this.scopes.get(key);
  }
  scopePolicy(scope) { return this.scopeRecord(scope)?.preset; }
  policyFor(scope, fallback) {
    for (const key of scopeChainOf(scope)) {
      if (this.previewPolicies.has(key)) return this.previewPolicies.get(key);
      if (this.agents.has(key)) { const saved = this.agents.get(key).policy; return this.store.state.presets.find(p => p.id === saved.id && p.enabled) ?? saved; }
    }
    const saved = this.scopePolicy(scope) ?? fallback;
    return this.store.state.presets.find(p => p.id === saved?.id && p.enabled) ?? saved;
  }
  catalogFor(scope, policy) {
    for (const key of scopeChainOf(scope)) {
      if (this.previewPolicies.has(key)) return this.catalog.forPreset(policy);
      if (this.agents.has(key)) return this.catalog.forPreset(policy);
    }
    return this.scopeRecord(scope)?.catalog ?? this.catalog.forPreset(policy);
  }
  mcpServerForTool(name, preset) {
    return [...(this.catalog.mcpServers ?? []), ...(preset.mcp ?? [])]
      .filter(server => name.startsWith(`mcp__${server.serverName}__`))
      .sort((a, b) => b.serverName.length - a.serverName.length)[0];
  }
  mcpServerEnabled(preset, serverName) {
    const server = (preset.mcp ?? []).find(item => item.serverName === serverName);
    return server ? server.enabled !== false : preset.mcpEnabled?.[serverName] !== false;
  }
  assertMcpNames(preset) {
    const global = new Set((this.catalog.mcpServers ?? []).map(server => server.serverName));
    for (const server of preset.mcp ?? []) if (global.has(server.serverName)) fail('duplicate-mcp', `MCP serverName: ${server.serverName} is already provided by the environment`);
  }
  assertMcpToolSelections(preset) {
    for (const name of preset.tools.enabled) {
      const server = this.mcpServerForTool(name, preset);
      if (server && !this.mcpServerEnabled(preset, server.serverName)) fail('mcp-disabled', `MCP server ${server.serverName} is disabled; enable the server before selecting its tools`);
    }
  }
  toolSourceMatches(name, scope, policy) {
    const wanted = this.catalog.forPreset(policy).find(tool => tool.name === name);
    const actual = (this.scopeRecord(scope)?.catalog ?? this.catalog.tools).find(tool => tool.name === name);
    const schema = this.ctx.tools.schemas(scope).find(tool => tool.name === name);
    const connection = value => value && Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'enabled'));
    if (name.startsWith('mcp__')) {
      const server = this.mcpServerForTool(name, policy);
      const mountedPolicy = this.scopePolicy(scope);
      const mountedServer = this.mcpServerForTool(name, mountedPolicy ?? {});
      const desired = policy.mcp.find(item => item.serverName === server?.serverName);
      const mounted = mountedPolicy?.mcp.find(item => item.serverName === mountedServer?.serverName);
      return Boolean(schema) && isDeepStrictEqual(connection(desired), connection(mounted));
    }
    if (['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name)) {
      const connections = preset => (preset?.mcp ?? []).filter(server => server.enabled !== false).map(connection).sort((a, b) => a.serverName.localeCompare(b.serverName));
      if (!isDeepStrictEqual(connections(policy), connections(this.scopePolicy(scope)))) return false;
    }
    return wanted?.package === actual?.package && (!wanted?.schema || sameToolSchema(wanted.schema, schema ? functionSchema(schema) : actual?.schema));
  }
  effectivePolicy(policy, scope) {
    const enabled = new Set(policy.tools.enabled.filter(name => {
      const server = this.mcpServerForTool(name, policy);
      return (!server || this.mcpServerEnabled(policy, server.serverName)) && this.toolSourceMatches(name, scope, policy);
    }));
    for (const tool of this.ctx.tools.schemas(scope)) {
      const known = this.catalog.forPreset(policy).find(t => t.name === tool.name);
      if (known && !known.light && policy.tools.packages.includes(known.package) && this.toolSourceMatches(tool.name, scope, policy)) enabled.add(tool.name);
    }
    return { ...policy, tools: { ...policy.tools, enabled: [...enabled] } };
  }
  async attachAgent(agent) {
    const binding = this.ctx.agentPresets.composedPreset(agent.ctx);
    const source = this.scopePolicy(agent);
    const old = this.agents.get(agent);
    const parent = scopeParentOf(agent);
    const owner = !old && this.ctx.agents.list().find(candidate => this.ctx.agents.isOwnedBy(agent.id, candidate) && scopeParentOf(candidate) === parent);
    const retiredFallback = this.retired.get(binding);
    if (retiredFallback && this.isBlank(agent)) {
      try { await this.ctx.agentPresets.select(agent, retiredFallback); }
      catch (error) {
        if (error.code === 'agent-preset/locked') agent.session.append('agent-preset/selected', { agentPreset: retiredFallback });
        else throw error;
      }
      await this.ctx.sessions.flush(agent.session);
    }
    const policy = this.store.state.presets.find(p => p.id === binding && p.enabled)
      ?? (retiredFallback && this.store.state.presets.find(p => p.id === retiredFallback && p.enabled))
      ?? this.agents.get(owner)?.policy ?? source;
    if (!policy) { old?.dispose?.(); this.agents.delete(agent); return; }
    const wanted = this.effectivePolicy(policy, parent);
    const known = new Set(this.ctx.tools.schemas(parent).map(tool => tool.name));
    const allow = wanted.tools.enabled.filter(name => name !== 'run_code' && known.has(name)).sort();
    const key = allow.join('\u0000');
    const catalog = this.catalog.forPreset(wanted);
    if (old?.key === key && old.parent === parent) { old.policy = structuredClone(wanted); old.catalog = catalog; return; }
    old?.dispose?.();
    const dispose = agent.ctx.tools.restrict({ allow });
    this.agents.set(agent, { policy: structuredClone(wanted), catalog: structuredClone(catalog), key, parent, dispose });
  }
  isBlank(agent) {
    const boundary = this.ctx.sessionProjections.stateOf(agent.session, 'turnBoundary');
    return !boundary || (boundary.lastTurn === 0 && boundary.openTurnStartSeq === null);
  }
  pendingTools(agent) {
    const id = this.ctx.agentPresets.composedPreset(agent.ctx), preset = this.store.state.presets.find(p => p.id === id && p.enabled), key = this.currentScopes.get(id);
    if (!preset || !key || this.isBlank(agent)) return [];
    const visible = new Set(this.ctx.tools.schemas(scopeParentOf(agent)).map(tool => tool.name));
    const desired = new Set(this.effectivePolicy(preset, key).tools.enabled);
    return this.ctx.tools.schemas(key).map(tool => tool.name).filter(name => name !== 'run_code' && desired.has(name) && (!visible.has(name) || !this.toolSourceMatches(name, scopeParentOf(agent), preset)));
  }
  async refreshBlankAgents(ids) {
    for (const agent of this.ctx.agents.list()) {
      const id = this.ctx.agentPresets.composedPreset(agent.ctx);
      if (ids && !ids.includes(id)) continue;
      if (this.isBlank(agent) && this.currentScopes.has(id) && !this.ctx.agents.list().some(owner => this.ctx.agents.isOwnedBy(agent.id, owner))) {
        try {
          if (scopeParentOf(agent) !== this.currentScopes.get(id)) await this.ctx.agentPresets.select(agent, id);
        } catch (error) { if (error.code !== 'agent-preset/locked') this.warnings.push({ code: 'blank-refresh-failed', id, detail: error.message }); }
      }
      await this.attachAgent(agent);
    }
  }
  scheduleRestrictions() {
    if (this.refreshTimer || !this.store.state || this.stopping) return;
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      try {
        if (this.catalog.syncGlobalTools()) {
          this.catalogRevision = (this.catalogRevision ?? 0) + 1;
          if (this.lastScan) this.lastScan.tools = this.catalog.tools.filter(tool => tool.available).length;
        }
        for (const agent of this.ctx.agents.list()) await this.attachAgent(agent);
      }
      catch (error) { this.ctx.logger.warn(error); this.warnings.push({ code: 'restriction-failed', detail: error.message }); }
    }, 0);
  }
  async sourceSkills(cwd, signal) {
    const { skills, complete } = await this.sourceSkillCatalog(cwd, signal);
    return { skills, complete };
  }
  async sourceSkillCatalog(cwd, signal) {
    const [global, roster] = await Promise.all([this.ctx.skills.snapshot({ cwd, signal }), this.ctx.agentPresets.list()]);
    let complete = global.complete;
    const skills = new Map(global.skills.map(skill => [skill.name, skill]));
    const owners = new Map();
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
  ownsPreset(id) { return this.registrations.has(id) || this.store.state.presets.some(p => p.id === id); }
  async getSourceSkill(name, cwd, signal) {
    const { owners, skills } = await this.sourceSkillCatalog(cwd, signal);
    if (!skills.some(skill => skill.name === name)) return;
    const owner = owners.get(name);
    return owner ? this.withSourceRegistry(owner, (registry, scope) => registry.get(name, { cwd, scope, signal })) : this.ctx.skills.get(name, { cwd, signal });
  }
  async skillDetail(name, cwd) {
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
  async withSourceRegistry(id, read) {
    const lease = await this.ctx.agentPresets.acquireScope(id);
    const scope = createScope(this.ownerCtx, {}, { parent: lease.key });
    try { return await read(this.ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'skills') ?? this.ctx.skills, lease.key); }
    finally { await scope.dispose(); await lease[Symbol.asyncDispose](); }
  }
  invalidateSkills() {
    if (this.invalidatingSkills || this.stopping) return;
    this.invalidatingSkills = true;
    try { for (const registry of new Set([...this.scopes.values()].map(source => source.ctx.skills))) registry.invalidateCache(); }
    finally { this.invalidatingSkills = false; }
  }
  instructionConfig() {
    const row = [...this.ownerCtx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-instructions' && !entry.id.includes('workshop-agent-instructions'));
    return { maxBytes: 65536, ...row?.options.config };
  }
  globalInstructionPaths() {
    const dshHome = this.homePaths.resolveDshHome(this.homePaths.resolveAgentsHome ? undefined : this.instructionConfig().dshHome);
    const roots = [{ home: dshHome, display: this.homePaths.dshHomeDisplay(dshHome) }];
    if (this.homePaths.resolveAgentsHome) {
      const home = this.homePaths.resolveAgentsHome();
      if (home !== dshHome) roots.push({ home, display: this.homePaths.agentsHomeDisplay(home) });
    }
    return roots.map(root => ({ path: join(root.home, 'AGENTS.md'), displayPath: root.display + '/AGENTS.md' }));
  }
  directoryFileSystem(fs) {
    if (!fs) return;
    const globalPaths = new Set(this.globalInstructionPaths().map(source => source.path));
    // A read-only view for the native directory-instructions plugin alone.
    // The same global file must not re-enter as a cwd/ancestor instruction.
    return {
      resolve: (path, ...options) => {
        if (globalPaths.has(resolve(path))) throw Object.assign(new Error('Global AGENTS.md is managed separately'), { code: 'FS_NOT_FOUND' });
        return fs.resolve(path, ...options);
      },
      stat: (...args) => fs.stat(...args),
      streamText: (...args) => fs.streamText(...args),
    };
  }
  async workspaceInstructions(cwd, scope, preset, includeDirectory = true) {
    const fs = scope.get('fs');
    const config = this.instructionConfig(), paths = this.globalInstructionPaths(), path = paths[0].path;
    const files = [];
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
    const text = edit?.text ?? original;
    const renderedText = this.instructions && text ? this.instructions.renderAgentInstructions(edit ? [{ absolutePath: path, displayPath: paths[0].displayPath, content: text }] : files, { maxBytes: config.maxBytes }).text : '';
    const directory = includeDirectory && this.instructions && fs ? await this.instructions.loadBaselineInstructions({ ...config, cwd }, this.directoryFileSystem(fs)) : undefined;
    return { name: AGENT_SECTION, text, original, renderedText, directoryText: directory?.text ?? '', path, enabled: edit?.enabled ?? true, editable: Boolean(this.instructions && fs), reorderable: false, delivery: 'user-message', order: 0 };
  }
  async previewSkillCatalog(registry, scope, cwd, enabled) {
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
  async previewTimeContext(cwd) {
    // Only the native clock hook runs on a detached session; no Host hooks or history writes.
    let hook, projection;
    this.timeModule.apply({
      sessionProjections: { register(value) { projection = value; }, stateOf: () => projection.init() },
      on(event, listener) { if (event === 'agent/pre-step') hook = listener; },
    }, {});
    const session = this.ctx.sessions.prepare(undefined, { meta: { cwd } });
    const decision = await hook({ agent: { session }, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'continue', messages: [] }));
    return decision.messages.find(message => message.source.kind === TIME_CONTEXT)?.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n') ?? '';
  }
  configurePolling() {
    clearInterval(this.pollTimer);
    const c = this.store.state.config;
    if (c.polling) this.pollTimer = setInterval(() => this.action({ action: 'scan' }).catch(error => { if (!this.stopping) this.ctx.logger.warn(error); }), c.scanInterval * 1000);
  }
  async scanCatalog(id = this.store.state.config.selectedPresetId, context = {}) {
    await this.catalog.scan();
    this.invalidateSkills();
    await this.registerAll();
    await this.updateScanCounts(id, context);
    return this.snapshot();
  }
  async updateScanCounts(id, context = {}) {
    const selected = this.preset(id);
    const preview = await this.preview({ ...context, id: selected.id });
    const sources = await this.sourceSkills(preview.cwd);
    const mcp = preview.mcp ?? [];
    this.lastScan = {
      tools: this.catalog.tools.filter(tool => tool.available).length,
      mcpServers: mcp.length,
      mcpTools: mcp.reduce((total, server) => total + server.tools.length, 0),
      promptSections: preview.editableSections.filter(section => !section.managedBy).length,
      skills: sources.skills.length,
      complete: sources.complete,
    };
  }
  async sourceVersion(roster) {
    const promptSources = scope => ['sections', 'contexts', 'variables'].map(kind => [...this.ctx.systemPrompt.layers.merge(scope, layer => layer[kind])]);
    const sources = [[this.ctx.skills.revision, promptSources(), this.ctx.get('permissionPresets')?.defaultPreset]];
    sources.push(...await Promise.all(roster.filter(row => !this.ownsPreset(row.id) && !row.broken).map(row => this.withSourceRegistry(row.id, (registry, scope) => [row.id, registry.revision, promptSources(scope)]))));
    // Observe source registries, not transient draft scopes; a preview must not
    // cause its own next refresh. Never return source prompt text as a version.
    const signature = JSON.stringify(sources, (_, value) => {
      if (typeof value !== 'function') return value;
      // Equal function source can close over different plugin configuration.
      if (!this.sourceFunctionIds.has(value)) this.sourceFunctionIds.set(value, ++this.nextSourceFunctionId);
      return { functionId: this.sourceFunctionIds.get(value) };
    });
    return createHash('sha256').update(signature).digest('hex');
  }
  async snapshot() {
    const roster = await this.ctx.agentPresets.list();
    const sourcesVersion = await this.sourceVersion(roster);
    const nameConflicts = roster.filter(row => !this.ownsPreset(row.id) && this.store.state.presets.some(preset => preset.name === row.name));
    return structuredClone({
      ...this.store.state,
      defaultPresetId: this.ctx.agentPresets.defaultId,
      sourcesVersion,
      catalog: {
        tools: this.catalog.tools,
        packages: this.catalog.packages.map(({ row, parents, templates, candidates, ...pkg }) => pkg),
        mcpServers: this.catalog.mcpServers,
        scannedAt: this.catalog.scannedAt,
        revision: this.catalogRevision ?? 0,
        counts: this.lastScan,
      },
      roster, nameConflicts, warnings: this.warnings.slice(-100),
      sessions: this.ctx.agents.list().map(agent => ({
        id: agent.id, contextVersion: agent.session.seq,
        permissions: this.ctx.sessionProjections.stateOf(agent.session, 'permissions'),
        cwd: this.workingDirectory(agent.session),
        preset: this.ctx.agentPresets.composedPreset(agent.ctx),
        nextPreset: this.ctx.sessionProjections.stateOf(agent.session, 'agentPreset'),
        revision: this.agents.get(agent)?.policy.revision,
        pendingTools: this.pendingTools(agent), blank: this.isBlank(agent),
        model: agent.options.model, provider: agent.options.provider,
      })),
    });
  }
  async preview(input, value) {
    let preset = value ?? this.preset(input.id);
    if (input.draft) { record(input.draft, 'draft'); preset = await this.validatedPreset({ ...preset, ...input.draft }, preset); }
    await this.catalog.prepare(preset);
    const configuredToolNames = [...preset.tools.enabled];
    const useDraft = Boolean(input.draft) || !preset.enabled;
    const lease = useDraft ? undefined : await this.ctx.agentPresets.acquireScope(preset.id);
    const key = {};
    const scope = createScope(this.ownerCtx, key, { parent: lease?.key });
    this.previewPolicies.set(key, preset);
    try {
      if (useDraft) await mountRows(scope.ctx, this.definition(preset).plugins);
      preset = this.effectivePolicy(preset, key);
      this.previewPolicies.set(key, preset);
      const allowed = new Set(preset.tools.enabled);
      // A child boundary filters the tools registered on the draft's own scope too.
      const viewKey = {};
      const view = createScope(scope.ctx, viewKey, { parent: key });
      this.previewPolicies.set(viewKey, preset);
      const mcpToolNames = tool => tool.name.startsWith('mcp__');
      const availableMcpTools = this.ctx.tools.schemas(key).filter(tool => {
        if (!mcpToolNames(tool)) return false;
        const server = this.mcpServerForTool(tool.name, preset);
        return !server || this.mcpServerEnabled(preset, server.serverName);
      }).map(functionSchema);
      view.ctx.tools.restrict({ allow: this.ctx.tools.schemas(key).map(t => t.name).filter(name => name !== 'run_code' && allowed.has(name)) });
      const live = input.sessionId && this.ctx.agents.get(input.sessionId);
      if (input.sessionId && !live) fail('session-not-found', 'Preview session is not open', 404);
      const defaults = [...this.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-default-model')?.options.config ?? {};
      const cwd = live ? this.workingDirectory(live.session) : input.cwd || homedir();
      const session = live?.session ?? this.ctx.sessions.prepare(undefined, { meta: { cwd, agentPreset: preset.id } });
      let toolManagementPrompt = '', timePrompt = '';
      if (live && Array.isArray(session.surface?.nodes) && typeof session.eventAt === 'function') {
        const seen = new Set();
        for (const seq of session.surface.nodes.map(Number).filter(Number.isFinite).sort((a, b) => b - a)) {
          let event;
          try { event = session.eventAt(seq); } catch { continue; }
          const kind = event?.data?.source?.kind;
          if (event?.type !== 'user/message' || !['prompt-manager-catalog', 'time-context'].includes(kind) || seen.has(kind)) continue;
          seen.add(kind);
          if (event.data.source.form === 'notice') continue;
          const text = (event.data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n\n');
          if (kind === 'time-context') timePrompt = text; else toolManagementPrompt = text;
        }
      }
      // prepare() is detached and skips session/created. Seed only this throwaway
      // session through the same permission defaults as a real new session.
      if (!live) this.ctx.get('permissionPresets')?.pinInitialPermission(session);
      const agent = { id: session.id, ctx: view.ctx, options: { provider: input.provider || live?.options.provider || defaults.provider, model: input.model || live?.options.model || defaults.model }, session };
      const context = { scope: viewKey, agent, workshopPreview: preset };
      // The official file-reference service registers this on agent/created.
      // A detached preview never fires that lifecycle; use its exported text
      // at its native placement without publishing a fake Agent or Session.
      if (this.ctx.get('fileReferences') && !this.ctx.systemPrompt.layers.merge(viewKey, layer => layer.sections).has('context:file-reference')) view.ctx.systemPrompt.section({ name: 'context:file-reference', order: this.ctx.systemPrompt.getSectionOrder('FILE_REFERENCE'), text: allowed.has('read') ? this.fileReferencePrompt : '' });
      const assembly = await this.ctx.systemPrompt.assemble(context);
      const sourceSections = this.ctx.systemPrompt.layers.merge(viewKey, layer => layer.sections);
      const sections = assembly.sections.map((section, index) => ({ ...section, order: section.name === 'preset-workshop:persona' ? -1000 : preset.prompt.sections[section.name]?.order ?? sourceSections.get(section.name)?.order ?? index * 100 }));
      const editableSections = new Map((context.workshopSourceAssembly?.sections ?? []).filter(section => !PERSONA_SECTIONS.has(section.name)).map((section, index) => [section.name, { ...section, order: sourceSections.get(section.name)?.order ?? index * 100, enabled: true, ...(section.name.startsWith('tool:') ? { managedBy: 'tools', enabled: sections.some(active => active.name === section.name) } : {}) }]));
      for (const [name, section] of Object.entries(preset.prompt.sections)) if (section.custom || name === 'deployment:persona-suffix' || editableSections.get(name)?.text?.trim()) editableSections.set(name, { name, ...section });
      for (const section of sections) if (section.name.startsWith('tool:') && !editableSections.has(section.name)) editableSections.set(section.name, { ...section, managedBy: 'tools', enabled: true });
      const registry = this.scopes.get(useDraft ? key : lease.key)?.ctx.skills;
      const skillSnapshot = registry ? await registry.snapshot({ cwd, scope: viewKey }) : { skills: [], complete: true };
      const skills = skillSnapshot.skills;
      const prompt = this.renderPrompt(assembly);
      const contexts = this.renderContextSections(assembly);
      const runtimeContext = this.renderContextSnapshot(assembly);
      const agentInstructions = await this.workspaceInstructions(cwd, view.ctx, preset);
      const tools = assembly.tools.map(functionSchema);
      const skillMessage = registry ? await this.previewSkillCatalog(registry, viewKey, cwd, tools.some(tool => tool.function.name === 'skill')) : undefined;
      const skillCatalog = skillMessage?.source.entries ?? [];
      const skillWarnings = tools.some(tool => tool.function.name === 'skill') ? preset.skills.filter(name => !skillCatalog.some(entry => entry.name === name)) : [];
      const skillPrompt = skillMessage?.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n') ?? '';
      const catalog = this.catalog.forPreset(preset);
      const mcpTools = tools.filter(tool => mcpToolNames(tool.function));
      const mcpServers = [...new Map([
        ...((this.catalog.mcpServers ?? []).map(server => [server.serverName, { ...server, config: this.catalog.mcpConfigs?.get(server.serverName), source: 'global', enabled: this.mcpServerEnabled(preset, server.serverName) }])),
        ...((preset.mcp ?? []).map(server => [server.serverName, { ...server, source: 'preset', enabled: server.enabled !== false, connection: this.mcpStates.get(useDraft ? key : lease.key)?.get(server.serverName) ?? { state: server.enabled === false ? 'disabled' : 'connecting' } }])),
      ]).values()];
      const mcpServerForTool = name => mcpServers.filter(server => server.source !== 'unknown' && name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0];
      const unidentifiedMcpTools = availableMcpTools.filter(tool => !mcpServerForTool(tool.function.name));
      if (unidentifiedMcpTools.length) mcpServers.push({ serverName: '', source: 'unknown', tools: unidentifiedMcpTools });
      for (const tool of availableMcpTools) {
        const server = mcpServerForTool(tool.function.name);
        catalog.push({ name: tool.function.name, kind: 'mcp', mcpServer: server?.serverName, ...(server ? { package: MCP_CLIENT_MODULE } : {}), light: true, available: true, schema: tool, sections: [`tool:${tool.function.name}`], prompt: '' });
      }
      const toolSections = new Set(catalog.flatMap(tool => tool.sections ?? []));
      const supplemental = filterMcpSections([...editableSections.values()], preset).filter(section => section.text?.trim() && ![AGENT_SECTION, TOOL_GUIDANCE, TIME_CONTEXT].includes(section.name) && !(assembly.contexts.some(context => context.name === 'working-directory:current') && isLegacyCwdSection(section))).map(section => ({ ...section, ...(toolSections.has(section.name) || section.name.startsWith('tool:') ? { managedBy: 'tools' } : {}), renderedText: section.enabled ? this.renderPrompt({ ...assembly, sections: [section] }) : section.text, editable: section.editable !== false, reorderable: section.reorderable !== false }));
      const guidanceSections = sections.filter(section => section.name.startsWith('tool:') || toolSections.has(section.name));
      const selectedToolSections = new Set(catalog.filter(tool => allowed.has(tool.name)).flatMap(tool => tool.sections ?? []));
      const guidanceMembers = supplemental.filter(section => section.managedBy === 'tools' && (selectedToolSections.has(section.name) || allowed.has(section.name.slice(5))));
      if (guidanceMembers.length) supplemental.push({ name: TOOL_GUIDANCE, text: this.renderPrompt({ ...assembly, sections: guidanceSections }), order: preset.prompt.sections[TOOL_GUIDANCE]?.order ?? Math.min(...guidanceMembers.map(section => section.order)), enabled: preset.prompt.sections[TOOL_GUIDANCE]?.enabled ?? true, members: guidanceMembers, managedBy: 'tool-guidance', editable: true, reorderable: true });
      const personaSections = assembly.sections.filter(section => PERSONA_SECTIONS.has(section.name)).map(section => ({ name: section.name, text: section.text, renderedText: this.renderPrompt({ ...assembly, sections: [section] }), editable: false }));
      const agentText = [agentInstructions.enabled ? agentInstructions.renderedText : '', agentInstructions.directoryText].filter(Boolean).join('\n\n');
      const regularTools = tools.filter(tool => !mcpTools.includes(tool));
      const timeEnabled = preset.prompt.sections[TIME_CONTEXT]?.enabled !== false;
      timePrompt = timeEnabled ? (timePrompt || await this.previewTimeContext(cwd)) : '';
      const displayPrompt = ['# System\n\n' + prompt,
        regularTools.length ? '## TOOL\n\n' + regularTools.map(tool => tool.function.name + '：' + tool.function.description).join('\n\n') : '',
        mcpTools.length ? '## MCP服务器\n\n' + mcpTools.map(tool => tool.function.name + '：' + tool.function.description).join('\n\n') : '',
        '# User\n\n' + (input.language === 'en' ? '[First user message · placeholder only; Preset Workshop does not edit conversation messages.]' : '［用户第一句话 · 仅作占位，预设工坊不修改会话消息。］'),
        runtimeContext ? '## 环境\n\n' + runtimeContext : '',
        skillPrompt ? '## SKILL\n\n' + skillPrompt : '',
        timePrompt ? '## 时间与时区\n\n' + timePrompt : '',
        toolManagementPrompt ? '## 提示词管理（User）\n\n' + toolManagementPrompt : '',
        agentInstructions.enabled && agentInstructions.renderedText ? '## AGENTS（全局级）\n\n' + agentInstructions.renderedText : '',
        agentInstructions.directoryText ? '## AGENTS（目录级）\n\n' + agentInstructions.directoryText : ''].filter(Boolean).join('\n\n');
      const liveMatches = live && this.ctx.agentPresets.composedPreset(live.ctx) === preset.id;
      let liveAssembly, runtimeError;
      if (liveMatches) {
        try { liveAssembly = await this.ctx.systemPrompt.assemble({ scope: live, agent: live }); }
        catch (error) { runtimeError = error.message; }
      }
      let runtime;
      if (liveMatches) {
        let livePrompt = '';
        if (liveAssembly) {
          try { livePrompt = this.renderPrompt(liveAssembly); }
          catch (error) { runtimeError = error.message; }
        }
        runtime = { sessionId: live.id, tools: liveAssembly?.tools.map(functionSchema) ?? [], prompt: livePrompt, ...(runtimeError ? { error: runtimeError } : {}), pendingTools: liveAssembly ? tools.map(tool => tool.function.name).filter(name => !liveAssembly.tools.some(actual => actual.name === name) || !this.toolSourceMatches(name, scopeParentOf(live), preset)) : [] };
      }
      const mcp = mcpServers.map(server => {
        const toolsForServer = server.source === 'unknown'
          ? server.tools
          : availableMcpTools.filter(tool => mcpServerForTool(tool.function.name)?.serverName === server.serverName);
        const cached = server.enabled !== false && server.source !== 'preset' && server.source !== 'unknown'
          ? catalog.filter(tool => tool.kind === 'mcp' && tool.mcpServer === server.serverName && !tool.available && tool.schema).map(tool => ({ ...tool.schema, function: { ...tool.schema.function, unavailable: true } }))
          : [];
        const known = new Set([...toolsForServer, ...cached].map(tool => tool.function.name));
        const saved = configuredToolNames.filter(name => !known.has(name) && mcpServerForTool(name)?.serverName === server.serverName).map(name => ({ name, description: '', unavailable: true }));
        return { ...server, tools: [...toolsForServer, ...cached, ...saved] };
      });
      const userSections = [
        { name: TIME_CONTEXT, text: timePrompt, enabled: timeEnabled, toggleable: true, order: 0 },
        ...(toolManagementPrompt ? [{ name: 'prompt-manager-catalog', text: toolManagementPrompt, source: 'dsh-plugin-tool-management' }] : []),
      ].map(section => ({ ...section, managedBy: 'host', editable: false, reorderable: false, delivery: 'user-message' }));
      return { prompt, displayPrompt, runtime, sections, editableSections: supplemental, personaSections, agentInstructions, userSections, skillCatalog, skillPrompt, skillWarnings, runtimeContext, contexts, variables: assembly.variables, tools, skills, catalog, mcp, estimatedTokens: Math.ceil((prompt.length + agentText.length + JSON.stringify(assembly.tools).length + runtimeContext.length + skillPrompt.length + toolManagementPrompt.length + timePrompt.length) / 4), cwd, model: agent.options.model, provider: agent.options.provider };
    } finally { this.previewPolicies.delete(key); await scope.dispose(); await lease?.[Symbol.asyncDispose](); }
  }
  async references(id) {
    const query = this.ctx.get('sessionQuery');
    const persistence = this.ctx.get('sessionPersistence');
    if (!query || !persistence) fail('session-storage-unavailable', 'Session query and persistence are required for safe preset removal', 503);
    const result = new Map();
    for (const record of await query.listSessions()) {
      const sessionId = record.id ?? record.sessionId ?? record.header?.id;
      if (!sessionId) fail('incompatible-session-query', 'Session listing did not provide an id');
      const attached = this.ctx.sessions.get(sessionId);
      const binding = attached ? this.ctx.sessionProjections.stateOf(attached, 'agentPreset') : await query.readSession(sessionId).then(loaded => selectedBinding(loaded.session, loaded.events));
      if (binding === id) result.set(sessionId, { id: sessionId, live: Boolean(this.ctx.agents.get(sessionId)) });
    }
    for (const session of this.ctx.sessions.list()) if (this.ctx.sessionProjections.stateOf(session, 'agentPreset') === id) result.set(session.id, { id: session.id, live: Boolean(this.ctx.agents.get(session.id)) });
    return [...result.values()];
  }
  async setDefault(id) {
    const resolved = await this.ctx.agentPresets.resolve(id);
    if (resolved.broken) fail('broken-preset', resolved.broken, 503);
    const settings = this.ctx.get('settings');
    const row = [...this.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-preset-registry');
    if (!settings || !row) fail('default-reset-unavailable', 'Host settings and the preset registry entry are required to change selectedDefault', 503);
    await settings.update(row.options.id, { selectedDefault: id });
    if (this.ctx.agentPresets.defaultId !== id) fail('default-reset-failed', 'selectedDefault did not change', 503);
  }
  async migrate(id, fallback, references) {
    const resolved = await this.ctx.agentPresets.resolve(fallback);
    if (resolved.broken) fail('broken-fallback', resolved.broken, 503);
    const migrated = [];
    for (const reference of references) {
      const live = this.ctx.agents.get(reference.id);
      const attached = this.ctx.sessions.get(reference.id);
      if (attached) {
        if (this.ctx.sessionProjections.stateOf(attached, 'agentPreset') !== id) continue;
        if (!await this.ctx.sessions.flush(attached)) fail('session-not-persisted', `No durability listener for session ${reference.id}`);
        if (live) {
          try { await this.ctx.agentPresets.select(live, fallback); }
          catch (error) {
            if (error.code !== 'agent-preset/locked') throw error;
            attached.append('agent-preset/selected', { agentPreset: fallback });
          }
        } else attached.append('agent-preset/selected', { agentPreset: fallback });
        if (!await this.ctx.sessions.flush(attached)) fail('session-not-persisted', `No durability listener for session ${reference.id}`);
      } else {
        const handle = await this.ctx.sessionPersistence.open(reference.id, 'write');
        try {
          const { events } = await handle.read();
          if (selectedBinding(handle.header, events) !== id) continue;
          await handle.append([{ seq: events.length, time: Date.now(), type: 'agent-preset/selected', data: { agentPreset: fallback } }]);
          await handle.flush();
        } finally { await handle.close(); }
      }
      migrated.push(reference.id);
    }
    if (this.ctx.agentPresets.defaultId === id) await this.setDefault(fallback);
    return migrated;
  }
  async reconcile() {
    const disabled = this.store.state.presets.filter(p => !p.enabled);
    for (const preset of disabled) {
      try {
        const references = await this.references(preset.id);
        await this.migrate(preset.id, this.store.state.config.fallbackPresetId, references);
      } catch (error) {
        // A recovery registration keeps old sessions open until migration can be retried.
        await this.register(preset);
        this.warnings.push({ code: 'recovery-registration', id: preset.id, detail: error.message });
      }
    }
  }
  revision(input, current) {
    if (input.revision !== current.revision) fail('revision-conflict', 'This preset changed in another editor; reload before saving', 409);
  }
  async validatedPreset(value, previous, all = this.store.state.presets, roster = []) {
    const preset = validatePreset(value, previous, all, roster);
    this.assertMcpNames(preset);
    this.assertMcpToolSelections(preset);
    if (preset.enabled) await this.catalog.prepare(preset);
    const checked = validatePreset(preset, previous, all, roster, preset.enabled ? this.catalog.forPreset(preset) : []);
    this.assertMcpNames(checked);
    this.assertMcpToolSelections(checked);
    return checked;
  }
  async commitPreset(preset, previous) {
    const next = structuredClone(this.store.state);
    if (previous) next.presets[next.presets.findIndex(p => p.id === preset.id)] = preset;
    else { next.presets.push(preset); next.config.presetIds.push(preset.id); }
    next.config.selectedPresetId = preset.id;
    await this.commitState(next, [preset]);
    if (!previous) this.retired.delete(preset.id);
    return this.snapshot();
  }
  async commitState(next, changed) {
    const before = structuredClone(this.store.state);
    const definitions = new Map(this.definitions);
    const composition = p => JSON.stringify({ name: p.name, description: p.description, prompt: p.prompt, skills: p.skills, mcp: p.mcp, mcpEnabled: p.mcpEnabled, packages: p.tools.packages, overrides: p.tools.overrides });
    try {
      for (const preset of changed) {
        const previous = before.presets.find(p => p.id === preset.id);
        if (preset.enabled && (!previous || !this.registrations.has(preset.id) || composition(previous) !== composition(preset))) await this.register(preset);
        if (preset.enabled) await this.preview({ id: preset.id }, preset);
      }
      await this.store.save(next);
    } catch (error) {
      for (const preset of changed) {
        const previous = definitions.get(preset.id);
        if (this.definitions.get(preset.id) === previous) continue;
        try { await this.unregister(preset.id); if (previous) await this.installDefinition(previous); }
        catch (recovery) { this.warnings.push({ code: 'registration-recovery-failed', id: preset.id, detail: recovery.message }); }
      }
      if (error.recoveryError) this.warnings.push({ code: 'storage-recovery-failed', detail: error.recoveryError });
      throw error;
    }
    for (const preset of changed) {
      const source = this.scopes.get(this.currentScopes.get(preset.id));
      if (source) source.preset = structuredClone(preset);
    }
    await this.refreshBlankAgents(changed.map(p => p.id));
  }
  async action(input) {
    await this.ready;
    if (input?.action === 'mcp-probe') {
      if (this.stopping) fail('workshop-stopped', 'Preset Workshop is stopping', 503);
      let server = input.server;
      if (!server) {
        const preset = this.preset(input.id);
        server = this.catalog.mcpConfigs?.get(input.serverName) ?? preset.mcp.find(item => item.serverName === input.serverName);
      }
      return probeMcp(this.ownerCtx, { ...input, server });
    }
    return this.store.run(async () => {
      if (this.stopping) fail('workshop-stopped', 'Preset Workshop is stopping', 503);
      record(input, 'request');
      return this.performAction(input);
    }, !['snapshot', 'preview', 'skills', 'skill', 'references', 'export'].includes(input?.action));
  }
  freshPreset(id, name, builtin = false) {
    const shell = this.catalog.tools.some(tool => tool.name === 'pwsh' && tool.available) && !this.catalog.tools.some(tool => tool.name === 'bash' && tool.available) ? 'pwsh' : process.platform === 'win32' ? 'pwsh' : 'bash';
    return newPreset(id, name, builtin, shell);
  }
  async performAction(input) {
    switch (input.action) {
      case 'snapshot': return this.snapshot();
      case 'preview': return this.preview(input);
      case 'skills': return this.sourceSkills(input.cwd || homedir());
      case 'skill': return this.skillDetail(input.name, input.cwd || homedir());
      case 'apply': {
        const preset = this.preset(input.id);
        if (!preset.enabled) fail('preset-disabled', 'Preset must be enabled before applying');
        const agent = this.ctx.agents.get(input.sessionId);
        if (!agent) fail('session-not-found', 'Apply requires an open session', 404);
        if (!this.isBlank(agent)) fail('agent-preset/locked', 'This session has already started', 409);
        if (!await this.ctx.sessions.flush(agent.session)) fail('session-not-persisted', 'No durability listener for this session', 503);
        await this.ctx.agentPresets.select(agent, preset.id);
        await this.attachAgent(agent);
        if (!await this.ctx.sessions.flush(agent.session)) fail('session-not-persisted', 'No durability listener for this session', 503);
        return this.snapshot();
      }
      case 'default': {
        const preset = this.preset(input.id);
        if (!preset.enabled) fail('preset-disabled', 'Default preset must be enabled');
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
        const previous = this.preset(input.id); this.revision(input, previous);
        record(input.changes, 'changes');
        const preset = await this.validatedPreset({ ...previous, ...input.changes }, previous);
        if (preset.enabled !== previous.enabled) fail('use-toggle', 'Use the enable/disable action');
        return this.commitPreset(preset, previous);
      }
      case 'mcp-create': {
        const previous = this.preset(input.id); this.revision(input, previous);
        const server = structuredClone(input.server);
        const preset = await this.validatedPreset({ ...previous, mcp: [...(previous.mcp ?? []), server] }, previous);
        return this.commitPreset(preset, previous);
      }
      case 'mcp-update': {
        const previous = this.preset(input.id); this.revision(input, previous);
        if (typeof input.serverName !== 'string' || !input.serverName) fail('invalid-mcp', 'serverName is required');
        const current = (previous.mcp ?? []).find(server => server.serverName === input.serverName);
        if (!current) fail('mcp-not-found', `Unknown MCP server: ${input.serverName}`, 404);
        const server = structuredClone(input.server);
        if (server.serverName !== input.serverName) fail('immutable-mcp-name', 'MCP serverName cannot be changed');
        const preset = await this.validatedPreset({ ...previous, mcp: previous.mcp.map(item => item.serverName === input.serverName ? server : item) }, previous);
        return this.commitPreset(preset, previous);
      }
      case 'mcp-delete': {
        const previous = this.preset(input.id); this.revision(input, previous);
        if (typeof input.serverName !== 'string' || !input.serverName) fail('invalid-mcp', 'serverName is required');
        if (!(previous.mcp ?? []).some(server => server.serverName === input.serverName)) fail('mcp-not-found', `Unknown MCP server: ${input.serverName}`, 404);
        const servers = previous.mcp.filter(server => server.serverName !== input.serverName);
        const owner = name => (previous.mcp.filter(server => name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0]?.serverName);
        const enabled = previous.tools.enabled.filter(name => owner(name) !== input.serverName);
        const preset = await this.validatedPreset({ ...previous, mcp: servers, tools: { ...previous.tools, enabled } }, previous);
        return this.commitPreset(preset, previous);
      }
      case 'reset': {
        const previous = this.preset(input.id); this.revision(input, previous);
        const preset = { ...this.freshPreset(previous.id, previous.name, previous.builtin), enabled: previous.enabled, description: previous.description, revision: previous.revision + 1 };
        return this.commitPreset(preset, previous);
      }
      case 'toggle':
      case 'delete': {
        const previous = this.preset(input.id); this.revision(input, previous);
        if (previous.builtin) fail('protected-preset', 'The built-in preset cannot be disabled or deleted');
        if (input.action === 'toggle' && typeof input.enabled !== 'boolean') fail('invalid-enabled', 'enabled: expected a boolean');
        if (input.action === 'toggle' && input.enabled) { this.retired.delete(previous.id); return this.commitPreset({ ...previous, enabled: true, revision: previous.revision + 1 }, previous); }
        const references = await this.references(previous.id);
        if (references.length && input.confirm !== true) fail('confirmation-required', 'Session fallback must be confirmed', 409);
        const fallback = this.store.state.config.fallbackPresetId === previous.id ? BUILTIN_ID : this.store.state.config.fallbackPresetId;
        // Successful fallback events remain even if a later write fails.
        // Keep the original preset available; do not blindly reverse durable
        // session events that another process may already have observed.
        await this.migrate(previous.id, fallback, references);
        this.retired.set(previous.id, fallback);
        const next = structuredClone(this.store.state);
        if (input.action === 'delete') { next.presets = next.presets.filter(p => p.id !== previous.id); next.config.presetIds = next.config.presetIds.filter(id => id !== previous.id); }
        else next.presets[next.presets.findIndex(p => p.id === previous.id)] = { ...previous, enabled: false, revision: previous.revision + 1 };
        if (next.config.selectedPresetId === previous.id) next.config.selectedPresetId = fallback;
        if (next.config.fallbackPresetId === previous.id) next.config.fallbackPresetId = fallback;
        await this.store.save(next);
        await this.unregister(previous.id);
        await this.refreshBlankAgents();
        return this.snapshot();
      }
      case 'settings': {
        const next = structuredClone(this.store.state);
        const update = input.changes;
        const allowed = ['selectedPresetId', 'fallbackPresetId', 'polling', 'scanInterval', 'ui'];
        record(update, 'changes');
        if (Object.keys(update).some(key => !allowed.includes(key))) fail('invalid-settings', 'Unknown settings field');
        Object.assign(next.config, update);
        record(next.config.ui, 'ui');
        if (!Number.isInteger(next.config.scanInterval) || next.config.scanInterval < 1 || next.config.scanInterval > 2147483) fail('invalid-interval', 'scanInterval: expected 1-2147483 seconds');
        if (typeof next.config.polling !== 'boolean') fail('invalid-polling', 'polling: expected a boolean');
        if (!next.presets.some(p => p.id === next.config.selectedPresetId)) fail('invalid-selection', 'Unknown selected preset');
        if (!next.presets.some(p => p.id === next.config.fallbackPresetId && p.enabled)) fail('invalid-fallback', 'Fallback preset must be enabled');
        const fallback = await this.ctx.agentPresets.resolve(next.config.fallbackPresetId);
        if (fallback.broken) fail('broken-fallback', fallback.broken, 503);
        await this.store.save(next); this.configurePolling();
        return this.snapshot();
      }
      case 'export': {
        if (input.format && !['yaml', 'json'].includes(input.format)) fail('invalid-format', 'format: expected json or yaml');
        const ids = Array.isArray(input.ids) ? [...new Set(input.ids)] : undefined;
        if (ids && (!ids.length || ids.some(id => typeof id !== 'string'))) fail('invalid-export', 'ids: select one or more presets');
        const presets = input.all ? this.store.state.presets : ids ? ids.map(id => this.preset(id)) : [this.preset(input.id)];
        const document = { format: 'dsh-preset-workshop', version: 1, presets: structuredClone(presets) };
        return { text: input.format === 'yaml' ? yaml.dump(document, { noRefs: true, lineWidth: -1 }) : JSON.stringify(document, null, 2), format: input.format === 'yaml' ? 'yaml' : 'json' };
      }
      case 'import': {
        if (!['new', 'overwrite', 'rename'].includes(input.mode)) fail('invalid-import-mode', 'mode: expected new, overwrite or rename');
        if (!['yaml', 'json'].includes(input.format) || typeof input.text !== 'string' || Buffer.byteLength(input.text) > MAX_PAYLOAD_BYTES) fail('invalid-import', 'Expected json or yaml text up to 8 MiB');
        let document;
        try { document = input.format === 'yaml' ? yaml.load(input.text, { schema: yaml.JSON_SCHEMA }) : JSON.parse(input.text); }
        catch (error) { fail('import-syntax', error.message); }
        if (document?.format !== 'dsh-preset-workshop' || document.version !== 1 || !Array.isArray(document.presets) || !document.presets.length) fail('invalid-import', 'Expected a Preset Workshop v1 export');
        const next = structuredClone(this.store.state);
        const roster = await this.ctx.agentPresets.list();
        const changed = [], conflicts = [], plans = [], targets = new Set();
        if (input.id && document.presets.length !== 1) fail('invalid-import', 'An explicit overwrite target requires exactly one preset');
        for (const [index, imported] of document.presets.entries()) {
          record(imported, 'imported preset');
          const rename = input.renames?.find(row => row.index === index) ?? {};
          const value = { ...imported, id: rename.id ?? input.newId ?? imported.id, name: (rename.name ?? input.newName ?? imported.name)?.trim(), enabled: true };
          const matches = next.presets.filter(p => p.id === value.id || p.name === value.name);
          const foreign = roster.filter(p => !this.ownsPreset(p.id) && (p.id === value.id || p.name === value.name));
          if (input.mode !== 'overwrite' && (matches.length || foreign.length)) conflicts.push({ index, importedId: value.id, importedName: value.name, matches: matches.map(p => ({ id: p.id, name: p.name, revision: p.revision })), foreign: foreign.map(p => ({ id: p.id, name: p.name })) });
          let previous;
          if (input.mode === 'overwrite') {
            if (foreign.length || matches.length > 1) fail('ambiguous-import', 'This import would overwrite different presets or a preset owned by another plugin; rename it instead', 409);
            previous = input.id ? this.preset(input.id) : matches[0];
            if (previous) {
              const expected = input.revisions?.[previous.id] ?? input.revision;
              this.revision({ revision: expected }, previous);
              if (targets.has(previous.id)) fail('invalid-import', 'More than one imported preset targets the same existing preset');
              targets.add(previous.id);
              value.id = previous.id; value.enabled = previous.enabled;
            }
          }
          plans.push({ value, previous });
        }
        if (conflicts.length) fail('import-conflict', 'Preset IDs or names already exist', 409, { conflicts });
        for (const { value, previous } of plans) {
          const preset = await this.validatedPreset(value, previous, next.presets, roster);
          changed.push(preset);
          if (previous) next.presets[next.presets.findIndex(p => p.id === previous.id)] = preset;
          else { next.presets.push(preset); next.config.presetIds.push(preset.id); }
          next.config.selectedPresetId = preset.id;
        }
        await this.commitState(next, changed);
        return this.snapshot();
      }
      default: fail('unknown-action', 'Unknown action');
    }
  }
  async handle(req, res) {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const rejection = this.ctx.get('connection')?.requestRejection(req);
      if (rejection !== undefined) { res.writeHead(rejection); res.end(); return; }
      if (req.headers['sec-fetch-site'] === 'cross-site') fail('cross-site', 'Cross-site requests are not allowed', 403);
      await this.ready;
      if (req.method === 'GET') { send(200, await this.action({ action: 'snapshot' })); return; }
      if (req.method !== 'POST') { send(405, { error: 'method-not-allowed' }); return; }
      if (!req.headers['content-type']?.startsWith('application/json')) fail('content-type', 'Expected application/json', 415);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_REQUEST_BYTES) fail('payload-too-large', 'Encoded request exceeds 48 MiB plus envelope', 413); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input.action !== 'string') fail('invalid-action', 'action is required');
      send(200, await this.action(input));
    } catch (error) { send(error.status ?? 400, { error: error.code ?? 'request-failed', detail: error.message, ...error.details, ...(error.recoveryError ? { recoveryError: error.recoveryError } : {}) }); }
  }
}
