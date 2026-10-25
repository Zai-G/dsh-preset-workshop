import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { BUILTINS, MCP_CLIENT_MODULE, functionSchema, sameToolSchema, fail } from './core.js';
import { atomicJSON, readJSON } from './store.js';
import { mountRows } from './scope.js';

const PREFIX = '@deepseek-ai/dsh-tool-';
// Unknown packages stay declaration-driven until their owner classifies them as lightweight.
const LIGHT = new Set([...Object.values(BUILTINS), 'subagent', 'fs-search', 'jobs', 'skill', 'present', 'working-directory']);
export class ToolCatalog {
  constructor(ctx, root) { this.ctx = ctx; this.root = root; this.tools = []; this.packages = []; this.mcpServers = []; this.scannedAt = null; }
  async scan() {
    const templates = new Map();
    const names = new Set(Object.values(BUILTINS).map(name => PREFIX + name));
    function walk(rows, parents = []) {
      for (const row of rows) {
        if (typeof row.name !== 'string') continue;
        if (row.name.startsWith(PREFIX)) {
          names.add(row.name);
          // A leaf alone loses its service siblings and isolation realms.
          if (!templates.has(row.name)) templates.set(row.name, new Map());
          const variants = templates.get(row.name);
          const signature = JSON.stringify(row.config ?? {});
          if (!variants.has(signature) || parents.length > variants.get(signature).parents.length) variants.set(signature, { row: structuredClone(row), parents: structuredClone(parents) });
        }
        if (row.group && Array.isArray(row.config)) walk(row.config, [...parents, row]);
        if (Array.isArray(row.config?.plugins)) walk(row.config.plugins);
      }
    }
    const hostRows = [...this.ctx.loader.entries()].filter(entry => !scopeOf(entry.parent.tree.ctx)).map(entry => entry.options);
    walk(hostRows);
    const bases = new Set([import.meta.url, this.ctx.baseUrl, this.ctx.loader.ctx?.baseUrl].filter(Boolean));
    for (const entry of this.ctx.loader.entries()) if (entry.parent.tree.ctx.baseUrl) bases.add(entry.parent.tree.ctx.baseUrl);
    const roots = new Set();
    for (const base of bases) {
      if (!base.startsWith('file:')) continue;
      try {
        const require = createRequire(base);
        const resolved = require.resolve('@deepseek-ai/dsh-tools');
        roots.add(dirname(dirname(dirname(resolved))));
      } catch { /* A profile can resolve official packages through a host resolver instead. */ }
    }
    for (const root of roots) {
      try { for (const entry of await readdir(root)) if (entry.startsWith('dsh-tool-')) names.add('@deepseek-ai/' + entry); }
      catch (error) { this.ctx.logger.warn(`Preset Workshop package scan: ${error.message}`); }
    }
    const known = await readJSON(join(this.root, 'catalog.json'), { tools: [] });
    const byName = new Map(known.tools.map(tool => [tool.name, { ...tool, available: false }]));
    const packages = [];
    const orderedNames = [...names].sort(), results = new Array(orderedNames.length);
    const baseline = this.ctx.systemPrompt?.assemble ? await this.ctx.systemPrompt.assemble() : undefined;
    let cursor = 0;
    const inspect = async name => {
      const light = LIGHT.has(name.slice(PREFIX.length));
      const candidates = [...(templates.get(name)?.values() ?? [{ row: { id: 'tool-' + name.slice(PREFIX.length), name, config: {} }, parents: [] }])].sort((a, b) => b.parents.length - a.parents.length);
      for (const candidate of candidates) if (typeof candidate.row.disabled === 'boolean') delete candidate.row.disabled;
      const template = candidates[0];
      const row = template.row;
      // Official shell schemas share the shell service; a successful probe
      // alone cannot prove that Bash/PowerShell matches the platform executor.
      const incompatibleShell = process.platform === 'win32' ? /^@deepseek-ai\/dsh-tool-bash(?:-persistent)?$/ : /^@deepseek-ai\/dsh-tool-pwsh(?:-persistent)?$/;
      if (incompatibleShell.test(name)) {
        return { name, light, available: false, row, error: 'This shell tool does not match the host platform executor' };
      }
      try { await this.ctx.loader.root.tree.import(name); }
      catch (error) {
        return { name, light, available: false, row, error: error.message };
      }
      const pkg = { name, light, available: true, row, parents: template.parents, candidates, tools: [...byName.values()].filter(tool => tool.package === name).map(tool => tool.name) };
      if (light) {
        try {
          await this.discover(pkg, baseline);
        } catch (error) { pkg.error = error.message; }
      }
      return pkg;
    };
    await Promise.all(Array.from({ length: Math.min(4, orderedNames.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= orderedNames.length) return;
        results[index] = await inspect(orderedNames[index]);
      }
    }));
    for (const pkg of results) {
      for (const tool of pkg.entries ?? []) byName.set(tool.name, tool);
      packages.push(pkg);
    }
    this.tools = [...byName.values()];
    this.syncGlobalTools();
    byName.clear();
    for (const tool of this.tools) byName.set(tool.name, tool);
    for (const [name, suffix] of Object.entries(BUILTINS)) {
      if (name === (process.platform === 'win32' ? 'bash' : 'pwsh')) continue;
      if (!byName.has(name)) byName.set(name, { name, package: PREFIX + suffix, kind: 'builtin', light: true, available: false, sections: ['tool:' + name] });
    }
    this.tools = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.packages = packages;
    this.scannedAt = new Date().toISOString();
    await atomicJSON(join(this.root, 'catalog.json'), { tools: this.tools, scannedAt: this.scannedAt });
    return this;
  }
  // Registration can finish after startup. Follow the unrestricted host registry,
  // without re-probing packages or taking another automatic scan.
  syncGlobalTools() {
    const previousServers = JSON.stringify(this.mcpServers);
    const mcpConfigs = new Map();
    for (const entry of this.ctx.loader.entries()) {
      if (scopeOf(entry.parent.tree.ctx) || entry.disabled || entry.fiber?.state !== 2 || entry.options.name !== MCP_CLIENT_MODULE) continue;
      const config = entry.options.config;
      if (config?.serverName) mcpConfigs.set(config.serverName, config);
    }
    this.mcpConfigs = mcpConfigs;
    this.mcpServers = [...mcpConfigs.values()].map(config => ({ serverName: config.serverName, transport: config.transport, source: 'global' })).sort((a, b) => a.serverName.localeCompare(b.serverName));
    const byName = new Map(this.tools.filter(tool => tool.kind !== 'thirdparty' && (tool.kind !== 'mcp' || mcpConfigs.has(tool.mcpServer))).map(tool => [tool.name, tool.kind === 'mcp' ? { ...tool, available: false } : tool]));
    for (const schema of this.ctx.tools.schemas()) {
      if (schema.name === 'run_code') continue;
      const knownTool = byName.get(schema.name);
      const mcp = schema.name.startsWith('mcp__')
        ? this.mcpServers.filter(server => schema.name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0]
        : undefined;
      const resource = ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(schema.name);
      const isMcp = Boolean(mcp || schema.name.startsWith('mcp__'));
      const current = functionSchema(schema);
      const packageName = knownTool?.package;
      // A late third-party registration must not replace a known official
      // executor just because it uses the same public tool name.
      if (knownTool && !['thirdparty', 'mcp'].includes(knownTool.kind) && (!knownTool.schema || !sameToolSchema(knownTool.schema, current))) continue;
      byName.set(schema.name, { ...knownTool, name: schema.name, kind: isMcp ? 'mcp' : resource ? 'official' : packageName ? knownTool?.kind ?? 'thirdparty' : 'thirdparty', mcpServer: mcp?.serverName, package: resource ? knownTool?.package ?? '@deepseek-ai/dsh-mcp-resources' : packageName, light: knownTool?.light ?? true, available: true, schema: current, sections: knownTool?.sections ?? ['tool:' + schema.name], prompt: knownTool?.prompt ?? '' });
    }
    const next = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    const changed = JSON.stringify(next) !== JSON.stringify(this.tools) || previousServers !== JSON.stringify(this.mcpServers);
    this.tools = next;
    return changed;
  }
  rows(packages) {
    const rows = new Map();
    for (const pkg of packages) for (const template of pkg.templates ?? [pkg]) {
      let nested = rows;
      for (const group of template.parents ?? []) {
        const id = JSON.stringify({ ...group, config: undefined });
        if (!nested.has(id)) nested.set(id, { ...structuredClone(group), config: new Map() });
        const target = nested.get(id).config;
        if (!pkg.light) for (const sibling of group.config) if (!sibling.group && !sibling.name?.startsWith(PREFIX) && !target.has(sibling.id ?? sibling.name)) target.set(sibling.id ?? sibling.name, structuredClone(sibling));
        nested = target;
      }
      nested.set(JSON.stringify({ name: template.row.name, config: template.row.config ?? {} }), structuredClone(template.row));
    }
    let serial = 0;
    function flatten(map) {
      // Cordis groups share one tree.store: ids must be unique across the whole tree.
      return [...map.values()].map(row => ({ ...row, id: 'workshop-row-' + serial++, ...(row.config instanceof Map ? { config: flatten(row.config) } : {}) }));
    }
    return flatten(rows);
  }
  async discover(pkg, baseline) {
    const tools = new Map();
    const accepted = [];
    const errors = [];
    baseline ??= await this.ctx.systemPrompt.assemble();
    for (const candidate of pkg.candidates ?? [pkg]) {
      try {
        const found = await this.probe({ ...pkg, ...candidate, templates: undefined }, baseline);
        if (!found.length || found.some(tool => tools.has(tool.name))) continue;
        accepted.push(candidate);
        for (const tool of found) tools.set(tool.name, tool);
      } catch (error) { errors.push(error.message); }
    }
    pkg.variantErrors = errors;
    if (!accepted.length) fail('tool-unavailable', errors.join('\n') || `No tools exposed by ${pkg.name}`, 503);
    pkg.templates = accepted;
    pkg.row = accepted[0].row;
    pkg.parents = accepted[0].parents;
    pkg.tools = [...tools.keys()];
    pkg.entries = [...tools.values()];
    pkg.probed = true;
    delete pkg.error;
    return [...tools.values()];
  }
  async probe(pkg, baseline) {
    const key = {};
    const scope = createScope(this.ctx, key);
    try {
      await mountRows(scope.ctx, this.rows([pkg]));
      const assembly = await this.ctx.systemPrompt.assemble({ scope: key });
      const ownSections = assembly.sections.filter(s => !baseline.sections.some(b => b.name === s.name && b.text === s.text));
      const tools = [];
      for (const schema of this.ctx.tools.schemas(key)) {
        if (schema.name === 'run_code' || this.ctx.tools.get(schema.name, key) === this.ctx.tools.get(schema.name)) continue;
        const exact = ownSections.filter(s => s.name === 'tool:' + schema.name);
        const shared = exact.length ? exact : ownSections.filter(s => s.name.startsWith('tool:'));
        tools.push({ name: schema.name, package: pkg.name, kind: pkg.name === PREFIX + BUILTINS[schema.name] ? 'builtin' : 'official', light: pkg.light, available: true, schema: functionSchema(schema), sections: shared.map(s => s.name), prompt: shared.map(s => s.text).join('\n\n') });
      }
      pkg.tools = tools.map(tool => tool.name);
      pkg.probed = true;
      delete pkg.error;
      return tools;
    } finally { await scope.dispose(); }
  }
  async prepare(preset) {
    for (const pkg of this.packages.filter(pkg => pkg.available && !pkg.light && !pkg.probed && preset.tools.packages.includes(pkg.name))) {
      try {
        for (const tool of await this.discover(pkg)) {
          if (!this.tools.some(known => known.name === tool.name && known.light)) {
            this.tools = this.tools.filter(known => known.name !== tool.name);
            this.tools.push(tool);
          }
        }
      } catch (error) { pkg.error = error.message; throw error; }
    }
  }
  forPreset(preset) {
    const tools = new Map(this.tools.map(tool => [tool.name, tool]));
    for (const pkg of this.packages) if (!pkg.light && preset.tools.packages.includes(pkg.name)) for (const tool of pkg.entries ?? []) tools.set(tool.name, tool);
    return [...tools.values()];
  }
}
