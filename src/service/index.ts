import { Service } from '@deepseek-ai/cordis';
import { createScope, scopeChainOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { WorkshopStore } from '../storage/store.js';
import { ToolCatalog } from '../catalog/catalog.js';
import { BUILTIN_ID, PERSONA_SECTIONS, AGENT_SECTION, DIRECTORY_AGENT, USER_DIRECTORY, TOOL_GUIDANCE, TIME_CONTEXT, USER_RUNTIME, USER_CWD, MCP_CLIENT_MODULE, newPreset, fail, validatePreset, validateToolJSON, selectedBinding, functionSchema, sameToolSchema, record, filterMcpSections, isLegacyCwdSection, splitRuntimeContext, renderRuntimeContextMessage } from '../domain/core.js';
import { mountRows } from '../runtime/scope.js';
import { probeMcp } from '../runtime/mcp.js';
import type { Preset, PromptSection, SkillGroup, SnapshotEntry, ToolOverride, ToolSchema } from '../domain/types.js';
import { performAction } from './actions.js';
import { preview } from './preview.js';
import { recordSnapshot, cleanupSnapshots, history } from './history.js';
import { handle } from './http.js';
import { sourceSkills, sourceSkillCatalog, ownsPreset, getSourceSkill, skillDetail, withSourceRegistry, invalidateSkills, instructionConfig, globalInstructionPaths, instructionFileSystem, workspaceInstructions, previewSkillCatalog, previewTimeContext } from './sources.js';
import type { HostContext, HostToolDefinition } from '../runtime/host.js';

type ScopedPreset = { ctx: HostContext; preset: Preset; catalog: ReturnType<ToolCatalog['forPreset']> };
type AgentPolicy = { policy: Preset; catalog: ScopedPreset['catalog']; key: string; parent: object; toolOverrides: Map<string, { source: HostToolDefinition; schema: ToolSchema; dispose: () => void }>; dispose?: () => void };

export const inject = ['loader', 'agentPresets', 'tools', 'systemPrompt', 'skills', 'agents', 'sessions', 'sessionPersistence', 'sessionProjections'];
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
    for (const deleted of workshop.deletedSnapshots.values()) clearTimeout(deleted.timer);
    for (const deleted of workshop.deletedGroups.values()) clearTimeout(deleted.timer);
    workshop.deletedGroups.clear();
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
      try { const body = await readFile(new URL((file.startsWith('assets/') ? '../../' : '../client/') + file, import.meta.url)); res.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : body); }
      catch { res.writeHead(503); res.end(); }
    } }));
  });
}

export class PresetWorkshop extends Service {
  declare ctx: HostContext;
  declare ownerCtx: HostContext;
  declare store: WorkshopStore;
  declare catalog: ToolCatalog;
  declare registrations: Map<string, () => void | Promise<void>>;
  declare definitions: Map<string, ReturnType<PresetWorkshop['definition']>>;
  declare currentScopes: Map<string, object>;
  declare retired: Map<string, string>;
  declare previewPolicies: WeakMap<object, Preset>;
  declare scopes: Map<object, ScopedPreset>;
  declare mcpStates: Map<object, Map<string, { state: string; error?: string }>>;
  declare agents: Map<object, AgentPolicy>;
  declare warnings: { code: string; detail: string; id?: string }[];
  declare sourceFunctionIds: WeakMap<object, number>;
  declare nextSourceFunctionId: number;
  declare deletedSnapshots: Map<string, { presetId: string; entry: SnapshotEntry; expiresAt: number; timer?: ReturnType<typeof setTimeout> }>;
  declare deletedGroups: Map<string, { group: SkillGroup; following: string[]; expiresAt: number; timer: ReturnType<typeof setTimeout> }>;
  declare ready: Promise<void>;
  declare error: string;
  declare stopping: boolean;
  declare pollTimer: ReturnType<typeof setInterval>;
  declare refreshTimer: ReturnType<typeof setTimeout>;
  declare renderPrompt: any;
  declare renderContextSections: any;
  declare renderContextSnapshot: any;
  declare Session: any;
  declare sessionFormatVersion: number;
  declare fileReferencePrompt: string;
  declare createUserMessage: any;
  declare skillModule: any;
  declare timeModule: any;
  declare homePaths: any;
  declare instructions: any;
  declare invalidatingSkills: boolean;
  declare lastScan: { tools: number; mcpServers: number; mcpTools: number; promptSections: number; skills: number; complete: boolean };
  declare catalogRevision: number;
  constructor(ctx: HostContext, store = new WorkshopStore()) {
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
    this.deletedSnapshots = new Map();
    this.deletedGroups = new Map();
  }
  async start() {
    this.store.lock = (await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-atomic-write')).withFileLock;
    await this.store.run(() => this.store.init());
    await this.catalog.scan();
    await this.migrateStoredToolSelections();
    const source = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-system-prompt');
    const sessions = await this.ctx.loader.root.tree.import('@deepseek-ai/dsh-session');
    this.renderPrompt = source.renderPrompt;
    this.renderContextSections = source.renderContextSections;
    this.renderContextSnapshot = source.renderContextSnapshot;
    this.Session = sessions.Session;
    this.sessionFormatVersion = sessions.SESSION_FORMAT_VERSION;
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
  preset(id: string): Preset {
    const p = this.store.state.presets.find(p => p.id === id);
    if (!p) fail('preset-not-found', `Unknown preset: ${id}`, 404);
    return p;
  }
  workingDirectory(session) { return this.ctx.get('workingDirectory')?.get(session) ?? session.header.cwd ?? homedir(); }
  isChildAgent(agent, owner) {
    const parentSession = agent?.session?.header?.parentSession;
    return Boolean(parentSession && owner?.session?.id === parentSession && agent.session.header.origin === 'subagent');
  }
  previewSession(cwd: string, presetId: string) {
    const id = `preset-workshop-preview-${randomUUID()}`;
    return this.Session.create(id, undefined, { version: this.sessionFormatVersion, id, createdAt: Date.now(), cwd, isSeeded: false, agentPreset: presetId });
  }
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
  definition(preset: Preset) {
    const enabled = new Set(preset.tools.enabled);
    const sourceFor = (name: string) => preset.tools.sources?.[name] || this.catalog.tools.find(tool => tool.name === name)?.package;
    let packages = this.catalog.packages.filter(pkg => pkg.available && !pkg.error && pkg.tools?.length && (pkg.light || preset.tools.packages.includes(pkg.name) && pkg.tools.some(name => enabled.has(name) && sourceFor(name) === pkg.name)) && !(pkg.tools.length === 1 && Object.entries(preset.tools.sources ?? {}).some(([name, source]) => pkg.tools[0] === name && source !== pkg.name)));
    const replacements = new Set([
      ...packages.filter(pkg => !pkg.light).flatMap(pkg => pkg.tools),
      ...this.catalog.tools.filter(tool => tool.kind === 'thirdparty' && tool.providerPackage && this.catalog.packages.find(pkg => pkg.name === tool.providerPackage)?.tools?.length === 1).map(tool => tool.name),
    ]);
    packages = packages.filter(pkg => !pkg.light || !pkg.tools.length || !pkg.tools.every(name => replacements.has(name)));
    const skillPackage = this.catalog.packages.find(pkg => pkg.name === '@deepseek-ai/dsh-tool-skill');
    const rows = this.catalog.rows(packages.filter(pkg => pkg !== skillPackage));
    rows.unshift({
      id: 'workshop-skills', name: 'cordis:group', group: true,
      isolate: { skills: true },
      config: [
        { id: 'registry', name: '@deepseek-ai/dsh-skill', config: {} },
        { id: 'binding', name: new URL('../runtime/scope.js', import.meta.url).href, config: { preset: JSON.stringify(preset) } },
        // Skill tools must resolve the filtered registry in this same realm.
        ...(skillPackage ? [{ id: 'skill-tool', name: skillPackage.name, config: structuredClone(skillPackage.row.config ?? {}) }] : []),
      ],
    });
    for (const server of preset.mcp ?? []) if (server.enabled !== false) {
      const { enabled, ...config } = server;
      rows.push({ id: `workshop-mcp-${server.serverName}`, name: new URL('../runtime/mcp.js', import.meta.url).href, config });
    }
    return { id: preset.id, name: preset.name, description: preset.description, order: 100, plugins: rows };
  }
  async register(preset: Preset) {
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
  async installDefinition(definition: ReturnType<PresetWorkshop['definition']>) {
    this.registrations.set(definition.id, await this.ownerCtx.agentPresets.register(definition));
    const row = (await this.ctx.agentPresets.list()).find(row => row.id === definition.id);
    if (!row || row.broken) fail('broken-preset', row?.broken ?? 'Preset registration disappeared', 503);
    this.definitions.set(definition.id, definition);
    const lease = await this.ctx.agentPresets.acquireScope(definition.id);
    this.currentScopes.set(definition.id, lease.key);
    await lease[Symbol.asyncDispose]();
  }
  async unregister(id: string) {
    await this.registrations.get(id)?.();
    this.registrations.delete(id);
    this.definitions.delete(id);
    this.currentScopes.delete(id);
  }
  scopeRecord(scope: object) {
    for (const key of scopeChainOf(scope)) if (this.scopes.has(key)) return this.scopes.get(key);
  }
  scopePolicy(scope: object) { return this.scopeRecord(scope)?.preset; }
  policyFor(scope: object, fallback: Preset) {
    for (const key of scopeChainOf(scope)) {
      if (this.previewPolicies.has(key)) return this.previewPolicies.get(key);
      if (this.agents.has(key)) { const saved = this.agents.get(key).policy; return this.store.state.presets.find(p => p.id === saved.id && p.enabled) ?? saved; }
    }
    const saved = this.scopePolicy(scope) ?? fallback;
    return this.store.state.presets.find(p => p.id === saved?.id && p.enabled) ?? saved;
  }
  catalogFor(scope: object, policy: Preset) {
    for (const key of scopeChainOf(scope)) {
      if (this.previewPolicies.has(key)) return this.catalog.forPreset(policy);
      if (this.agents.has(key)) return this.catalog.forPreset(policy);
    }
    return this.scopeRecord(scope)?.catalog ?? this.catalog.forPreset(policy);
  }
  mcpServerForTool(name: string, preset: { mcp?: Preset['mcp'] }) {
    return [...(this.catalog.mcpServers ?? []), ...(preset.mcp ?? [])]
      .filter(server => name.startsWith(`mcp__${server.serverName}__`))
      .sort((a, b) => b.serverName.length - a.serverName.length)[0];
  }
  mcpServerEnabled(preset: Preset, serverName: string) {
    const server = (preset.mcp ?? []).find(item => item.serverName === serverName);
    return server ? server.enabled !== false : preset.mcpEnabled?.[serverName] !== false;
  }
  assertMcpNames(preset: Preset) {
    const global = new Set((this.catalog.mcpServers ?? []).map(server => server.serverName));
    for (const server of preset.mcp ?? []) if (global.has(server.serverName)) fail('duplicate-mcp', `MCP serverName: ${server.serverName} is already provided by the environment`);
  }
  assertMcpToolSelections(preset: Preset) {
    for (const name of preset.tools.enabled) {
      const server = this.mcpServerForTool(name, preset);
      if (server && !this.mcpServerEnabled(preset, server.serverName)) fail('mcp-disabled', `MCP server ${server.serverName} is disabled; enable the server before selecting its tools`);
    }
  }
  toolSourceMatches(name: string, scope: object, policy: Preset) {
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
  effectivePolicy(policy: Preset, scope: object): Preset {
    const enabled = new Set(policy.tools.enabled.filter(name => {
      const server = this.mcpServerForTool(name, policy);
      return (!server || this.mcpServerEnabled(policy, server.serverName)) && this.toolSourceMatches(name, scope, policy);
    }));
    return { ...policy, tools: { ...policy.tools, enabled: [...enabled] } };
  }
  async attachAgent(agent) {
    const binding = this.ctx.agentPresets.composedPreset(agent.ctx);
    const source = this.scopePolicy(agent);
    const old = this.agents.get(agent);
    const parent = scopeParentOf(agent);
    const owner = !old && this.ctx.agents.list().find(candidate => this.isChildAgent(agent, candidate) && scopeParentOf(candidate) === parent);
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
    if (old?.key === key && old.parent === parent) {
      old.policy = structuredClone(wanted);
      old.catalog = catalog;
      this.syncToolOverrides(agent, wanted, parent, old);
      return;
    }
    old?.dispose?.();
    const state: AgentPolicy = { policy: structuredClone(wanted), catalog: structuredClone(catalog), key, parent, toolOverrides: new Map() };
    this.syncToolOverrides(agent, wanted, parent, state);
    const disposeRestriction = agent.ctx.tools.restrict({ allow });
    state.dispose = () => { disposeRestriction(); for (const item of state.toolOverrides.values()) item.dispose(); state.toolOverrides.clear(); };
    this.agents.set(agent, state);
  }
  isBlank(agent) {
    const boundary = this.ctx.agents.turnBoundaryOf(agent.session);
    return !boundary || (boundary.lastTurn === 0 && boundary.openTurnStartSeq === null);
  }
  pendingTools(agent) {
    const id = this.ctx.agentPresets.composedPreset(agent.ctx), preset = this.store.state.presets.find(p => p.id === id && p.enabled), key = this.currentScopes.get(id);
    if (!preset || !key || this.isBlank(agent)) return [];
    const visible = new Set(this.ctx.tools.schemas(scopeParentOf(agent)).map(tool => tool.name));
    const available = new Set([
      ...this.ctx.tools.schemas(key).map(tool => tool.name),
      ...this.catalog.forPreset(preset).map(tool => tool.name),
    ]);
    const desired = new Set([...this.effectivePolicy(preset, key).tools.enabled, ...preset.tools.enabled]);
    return [...desired].filter(name => {
      const server = this.mcpServerForTool(name, preset);
      return name !== 'run_code' && available.has(name) && (!server || this.mcpServerEnabled(preset, server.serverName)) && (!visible.has(name) || !this.toolSourceMatches(name, scopeParentOf(agent), preset));
    });
  }
  toolActivation(name, scope, source) {
    // shortcut: DSH 0.2.2 has no public condition reader; replace this when tools exposes one.
    const registry = this.ctx.tools.layers;
    if (!registry?.global?.tools?.get || typeof registry.chainLayers !== 'function') throw new Error('DSH tools registry does not expose activation conditions');
    let registration = registry.global.tools.get(name);
    for (const layer of registry.chainLayers(scope)) registration = layer.tools.get(name) ?? registration;
    if (registration?.definition !== source) throw new Error(`Cannot read the source activation condition for tool "${name}"`);
    return registration.when;
  }
  async toolSourceAdmitted(name, when, agent, modelSelection, signal) {
    signal.throwIfAborted();
    if (!this.ctx.tools.layers.chainLayers(agent).every(layer => layer.admits(name))) return false;
    const admitted = when === undefined || await when({ agent, modelSelection, signal });
    signal.throwIfAborted();
    return admitted;
  }
  syncToolOverrides(agent, policy, parent, state) {
    const overrides = state.toolOverrides ??= new Map();
    const configured = policy.tools.overrides ?? {};
    const enabled = new Set(policy.tools.enabled);
    for (const name of new Set([...overrides.keys(), ...Object.keys(configured)])) {
      const override = configured[name]?.schema;
      const source = override && this.ctx.tools.get(name, parent);
      const current = overrides.get(name);
      if (!source || !override || !enabled.has(name)) {
        current?.dispose();
        overrides.delete(name);
        continue;
      }
      if (current?.source === source && isDeepStrictEqual(current.schema, override)) continue;
      validateToolJSON(override, name, functionSchema(source));
      const when = this.toolActivation(name, parent, source);
      current?.dispose();
      const dispose = agent.ctx.tools.register({ ...source, description: override.function.description, parameters: structuredClone(override.function.parameters) }, {
        when: ({ agent, modelSelection, signal }) => this.toolSourceAdmitted(name, when, agent, modelSelection, signal),
      });
      overrides.set(name, { source, schema: structuredClone(override), dispose });
    }
  }
  async refreshBlankAgents(ids?: string[]) {
    for (const agent of this.ctx.agents.list()) {
      const id = this.ctx.agentPresets.composedPreset(agent.ctx);
      if (ids && !ids.includes(id)) continue;
      if (this.isBlank(agent) && this.currentScopes.has(id) && !this.ctx.agents.list().some(owner => this.isChildAgent(agent, owner))) {
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
  declare sourceSkills: typeof sourceSkills;
  declare sourceSkillCatalog: typeof sourceSkillCatalog;
  declare ownsPreset: typeof ownsPreset;
  declare getSourceSkill: typeof getSourceSkill;
  declare skillDetail: typeof skillDetail;
  declare withSourceRegistry: typeof withSourceRegistry;
  declare invalidateSkills: typeof invalidateSkills;
  declare instructionConfig: typeof instructionConfig;
  declare globalInstructionPaths: typeof globalInstructionPaths;
  declare instructionFileSystem: typeof instructionFileSystem;
  declare workspaceInstructions: typeof workspaceInstructions;
  declare previewSkillCatalog: typeof previewSkillCatalog;
  declare previewTimeContext: typeof previewTimeContext;
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
    const systemSections = preview.editableSections.filter(section => section.role !== 'user' && section.managedBy !== 'tools' && (!section.name.startsWith('mcp:') || section.text?.trim()) && (!section.custom || Object.hasOwn(selected.prompt.sections, section.name)));
    const customUserSections = Object.values(selected.prompt.sections as Record<string, PromptSection>).filter(section => section.custom && section.role === 'user' && section.enabled && section.text.trim());
    const promptSections = systemSections.length
      + Number(Boolean(preview.agentInstructions?.requestText?.trim()))
      + Number(Boolean(preview.runtimeContextEnvironment?.trim()) && selected.prompt.sections[USER_CWD]?.enabled !== false && selected.prompt.sections[USER_RUNTIME]?.enabled !== false)
      + Number(Boolean(preview.skillPrompt?.trim()))
      + preview.userSections.filter(section => section.enabled !== false && section.text?.trim()).length
      + customUserSections.length;
    this.lastScan = {
      tools: this.catalog.tools.filter(tool => tool.available && tool.kind !== 'mcp').length,
      mcpServers: mcp.filter(server => server.source !== 'unknown').length,
      mcpTools: mcp.reduce((total, server) => total + server.tools.length, 0),
      promptSections,
      skills: sources.skills.length,
      complete: sources.complete,
    };
  }
  async sourceVersion(roster) {
    const promptSources = (scope?) => ['sections', 'contexts', 'variables'].map(kind => [...this.ctx.systemPrompt.layers.merge(scope, layer => layer[kind])]);
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
        packages: this.catalog.packages.filter(pkg => pkg.entries?.length).map(({ name, light, tools }) => ({ name, light, tools })),
        mcpServers: this.catalog.mcpServers,
        scannedAt: this.catalog.scannedAt,
        revision: this.catalogRevision ?? 0,
        counts: this.lastScan,
      },
      roster, nameConflicts, warnings: this.warnings.slice(-100),
      sessions: this.ctx.agents.list().map(agent => ({
        id: agent.id, contextVersion: agent.session.seq,
        permissions: this.ctx.sessionProjections.snapshot(agent.session, ['permissions']).values.permissions,
        cwd: this.workingDirectory(agent.session),
        preset: this.ctx.agentPresets.composedPreset(agent.ctx),
        nextPreset: this.ctx.agentPresets.presetForSession(agent.session),
        revision: this.agents.get(agent)?.policy.revision,
        pendingTools: this.pendingTools(agent), blank: this.isBlank(agent),
        model: agent.options.model, provider: agent.options.provider,
      })),
    });
  }
  preview(input, value?) { return preview.call(this, input, value); }
  async references(id) {
    const query = this.ctx.get('sessionQuery');
    const persistence = this.ctx.get('sessionPersistence');
    if (!query || !persistence) fail('session-storage-unavailable', 'Session query and persistence are required for safe preset removal', 503);
    const result = new Map();
    const records = await query.listSessions();
    let cursor = 0;
    const inspect = async record => {
      const sessionId = record.id ?? record.sessionId ?? record.header?.id;
      if (!sessionId) fail('incompatible-session-query', 'Session listing did not provide an id');
      const attached = this.ctx.sessions.get(sessionId);
      if (attached) return this.ctx.agentPresets.presetForSession(attached);
      let handle;
      try { handle = await persistence.open(sessionId, 'read'); }
      catch { return query.readSession(sessionId).then(loaded => selectedBinding(loaded.session, loaded.events)); }
      try {
        const snapshot = this.ctx.get('sessionProjectionCache')?.cachedSnapshot(record.header ?? handle.header, ['agentPreset']);
        const hasCheckpoint = snapshot && Object.hasOwn(snapshot.values, 'agentPreset') && Number.isSafeInteger(snapshot.asOfSeq);
        let binding = hasCheckpoint ? snapshot.values.agentPreset : handle.header.agentPreset;
        const { events } = await handle.read(hasCheckpoint ? Math.max(0, snapshot.asOfSeq + 1) : 0);
        for (const event of events) if (event.type === 'agent-preset/selected') binding = event.data.agentPreset;
        return binding;
      } catch {
        return query.readSession(sessionId).then(loaded => selectedBinding(loaded.session, loaded.events));
      } finally { await handle.close(); }
    };
    await Promise.all(Array.from({ length: Math.min(4, records.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= records.length) return;
        const record = records[index], sessionId = record.id ?? record.sessionId ?? record.header?.id;
        const binding = await inspect(record);
        if (binding === id) result.set(sessionId, { id: sessionId, live: Boolean(this.ctx.agents.get(sessionId)) });
      }
    }));
    for (const session of this.ctx.sessions.list()) if (this.ctx.agentPresets.presetForSession(session) === id) result.set(session.id, { id: session.id, live: Boolean(this.ctx.agents.get(session.id)) });
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
        if (this.ctx.agentPresets.presetForSession(attached) !== id) continue;
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
    if (preset.enabled && preset.tools.packages.length) await this.catalog.prepare(preset);
    this.migrateLegacyPackageSelection(preset);
    const packages = new Set<string>();
    for (const [name, source] of Object.entries(preset.tools.sources)) {
      if (!preset.tools.enabled.includes(name)) { delete preset.tools.sources[name]; continue; }
      const pkg = this.catalog.packages.find(item => item.name === source && item.available && !item.error && item.entries?.some(tool => tool.name === name));
      if (!pkg) fail('package-unavailable', `Official tool source is unavailable: ${source}`);
      packages.add(source);
    }
    for (const name of preset.tools.enabled) {
      if (preset.tools.sources[name]) continue;
      const source = this.catalog.tools.find(tool => tool.name === name)?.package;
      const pkg = this.catalog.packages.find(item => item.name === source);
      if (pkg && !pkg.light) packages.add(pkg.name);
    }
    preset.tools.packages = [...packages];
    if (preset.enabled) await this.catalog.prepare(preset);
    const selectedCatalog = this.catalog.forPreset(preset);
    const previousCatalog = previous ? this.catalog.forPreset(previous) : [];
    for (const [name, override] of Object.entries(preset.tools.overrides as Record<string, ToolOverride>)) {
      if (!override.schema) continue;
      const originalTool = selectedCatalog.find(tool => tool.name === name);
      const previousTool = previousCatalog.find(tool => tool.name === name);
      const previousSource = previous?.tools.sources?.[name] || previousTool?.package || this.catalog.tools.find(tool => tool.name === name)?.package;
      const sourceChanged = previousSource && originalTool && previousSource !== originalTool.package;
      const previousSchema = previous?.tools.overrides?.[name]?.schema;
      const carriedSchema = previousSchema && isDeepStrictEqual(override.schema, previousSchema);
      if (!(sourceChanged && carriedSchema) && (!originalTool?.schema || sameToolSchema(override.schema, originalTool.schema))) continue;
      delete override.schema;
      if (override.prompt === undefined && override.promptEnabled === undefined) delete preset.tools.overrides[name];
    }
    const checked = validatePreset(preset, previous, all, roster, preset.enabled ? selectedCatalog : []);
    this.assertMcpNames(checked);
    this.assertMcpToolSelections(checked);
    return checked;
  }
  migrateLegacyPackageSelection(preset) {
    const enabled = new Set(preset.tools.enabled);
    for (const name of preset.tools.packages) {
      const pkg = this.catalog.packages.find(item => item.name === name);
      if (!pkg?.entries?.length) continue;
      const selected = pkg.entries.some(tool => enabled.has(tool.name));
      for (const tool of pkg.entries) {
        if (!selected) enabled.add(tool.name);
        if (enabled.has(tool.name) && !preset.tools.sources[tool.name] && this.catalog.tools.find(item => item.name === tool.name)?.package !== pkg.name) {
          preset.tools.sources[tool.name] = pkg.name;
        }
      }
    }
    preset.tools.enabled = [...enabled];
  }
  async migrateStoredToolSelections() {
    const next = structuredClone(this.store.state);
    let changed = false;
    for (const previous of this.store.state.presets) {
      try {
        const migrated = await this.validatedPreset(previous, previous, next.presets);
        if (JSON.stringify(migrated.tools) === JSON.stringify(previous.tools)) continue;
        migrated.revision = previous.revision + 1;
        next.presets[next.presets.findIndex(preset => preset.id === previous.id)] = migrated;
        changed = true;
      } catch (error) {
        this.warnings.push({ code: 'tool-migration-failed', id: previous.id, detail: error.message });
      }
    }
    if (changed) await this.store.run(() => this.store.save(next));
  }
  recordSnapshot = recordSnapshot;
  cleanupSnapshots = cleanupSnapshots;
  history = history;
  async commitPreset(preset, previous?, reason?, input?) {
    const next = structuredClone(this.store.state);
    if (previous) next.presets[next.presets.findIndex(p => p.id === preset.id)] = preset;
    else { next.presets.push(preset); next.config.presetIds.push(preset.id); }
    next.config.selectedPresetId = preset.id;
    const writes = await this.recordSnapshot(next, previous, reason, input);
    await this.commitState(next, [preset], writes);
    if (writes.length) await this.cleanupSnapshots(preset.id);
    if (!previous) this.retired.delete(preset.id);
    return this.snapshot();
  }
  async commitState(next, changed, snapshotWrites = []) {
    const before = structuredClone(this.store.state);
    const definitions = new Map(this.definitions);
    const composition = p => JSON.stringify({ name: p.name, description: p.description, prompt: p.prompt, skills: p.skills, mcp: p.mcp, mcpEnabled: p.mcpEnabled, packages: p.tools.packages, sources: p.tools.sources, overrides: p.tools.overrides });
    try {
      for (const preset of changed) {
        const previous = before.presets.find(p => p.id === preset.id);
        if (preset.enabled && (!previous || !this.registrations.has(preset.id) || composition(previous) !== composition(preset))) await this.register(preset);
        if (preset.enabled) await this.preview({ id: preset.id }, preset);
      }
      await this.store.save(next, false, snapshotWrites);
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
    }, !['snapshot', 'preview', 'skills', 'skill', 'references', 'export', 'import-inspect', 'history', 'history-detail'].includes(input?.action));
  }
  freshPreset(id, name, builtin = false) {
    const shell = this.catalog.tools.some(tool => tool.name === 'pwsh' && tool.available) && !this.catalog.tools.some(tool => tool.name === 'bash' && tool.available) ? 'pwsh' : process.platform === 'win32' ? 'pwsh' : 'bash';
    return newPreset(id, name, builtin, shell);
  }
  performAction(input) { return performAction.call(this, input); }
  handle = handle;
}

Object.assign(PresetWorkshop.prototype, { sourceSkills, sourceSkillCatalog, ownsPreset, getSourceSkill, skillDetail, withSourceRegistry, invalidateSkills, instructionConfig, globalInstructionPaths, instructionFileSystem, workspaceInstructions, previewSkillCatalog, previewTimeContext });
