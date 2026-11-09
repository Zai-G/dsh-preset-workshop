import { isDeepStrictEqual } from 'node:util';

export const BUILTIN_ID = 'preset_workshop';
export const BUILTINS = {
  bash: 'bash', pwsh: 'pwsh', read: 'fs', edit: 'fs', write: 'fs',
  web_search: 'web', web_fetch: 'web', ask_user_question: 'ask-user',
  todo_write: 'todo',
};
export const PERSONA_SECTIONS = new Set(['harness:identity', 'deployment:persona-prefix']);
// Workspace instructions are durable user context, never a system-prompt section.
export const AGENT_SECTION = 'workshop:agent-instructions';
export const DIRECTORY_AGENT = 'workshop:directory-instructions';
export const TOOL_GUIDANCE = 'workshop:tool-guidance';
export const TIME_CONTEXT = 'time-context';
export const USER_RUNTIME = 'workshop:user-runtime';
export const USER_DIRECTORY = 'workshop:user-directory';
export const USER_CWD = 'workshop:user-cwd';
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client';
export const isLegacyCwdSection = section => section.name === 'deployment:persona-suffix' && /^\s*Your working directory is\s+\{\{\s*cwd\s*\}\}\.?\s*$/.test(section.text);
// Split the live snapshot at its quoted cwd field; never synthesize either display block.
export function splitRuntimeContext(snapshot = '') {
  let text = typeof snapshot === 'string' ? snapshot.trim() : '';
  text = text.replace(/^Current runtime context\. This snapshot supersedes earlier runtime-context snapshots\.\s*/i, '').trim();
  const match = /(?:^|\n\n)(Current working directory:\s*"(?:[^"\\]|\\.)*"\.?)(?=\s|$)/i.exec(text);
  if (!match) return { workingDirectory: '', environment: text };
  const environment = text.slice(0, match.index) + text.slice(match.index + match[0].length);
  return { workingDirectory: match[1].trim(), environment: environment.trim() };
}
// An explicit per-preset binding overrides a source manager's invocation switch,
// without changing that manager or the original skill file.
export const boundSkill = skill => ({ ...skill, invocation: { modelInvocable: true, userInvocable: true } });

export function fail(code, detail, status = 400, details = {}) {
  throw Object.assign(new Error(detail), { code, status, details });
}
export function newPreset(id, name = id, builtin = false, shell = 'bash') {
  return {
    id, name, description: '', enabled: true, builtin, revision: 1,
    prompt: { persona: 'You are a helpful assistant.', sections: {} },
    tools: { enabled: [shell, ...Object.keys(BUILTINS).filter(name => !['bash', 'pwsh'].includes(name))], packages: [], overrides: {}, sources: {} },
    skills: [],
    mcp: [],
    mcpEnabled: {},
  };
}
export function validatePreset(input, previous, all = [], roster = [], catalog = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-preset', 'preset: expected an object');
  const p = structuredClone(input);
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.id)) fail('invalid-id', 'id: use 1-64 lowercase letters, digits, hyphens or underscores');
  if (previous && previous.id !== p.id) fail('immutable-id', 'id cannot be changed');
  if (!previous && (all.some(x => x.id === p.id) || roster.some(x => x.id === p.id))) fail('duplicate-id', `id: ${p.id} is already registered`);
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 160) fail('invalid-name', 'name: expected 1-160 characters');
  p.name = p.name.trim();
  if (all.some(x => x.id !== p.id && x.name === p.name)) fail('duplicate-name', `name: ${p.name} is already used`);
  if (typeof p.description !== 'string' || p.description.length > 4000) fail('invalid-description', 'description: expected at most 4000 characters');
  p.builtin = previous?.builtin ?? false;
  if (typeof p.enabled !== 'boolean') fail('invalid-enabled', 'enabled: expected a boolean');
  p.enabled = p.builtin || p.enabled;
  if (!p.prompt || typeof p.prompt.persona !== 'string' || p.prompt.persona.length > 200000) fail('invalid-prompt', 'prompt.persona: expected text, at most 200000 characters');
  record(p.prompt.sections, 'prompt.sections');
  for (const [name, section] of Object.entries(p.prompt.sections)) {
    if (PERSONA_SECTIONS.has(name) || name === 'preset-workshop:persona' || name === DIRECTORY_AGENT) fail('managed-section', `prompt.sections.${name}: managed by persona or native directory instructions`);
    if (section?.custom && (name.startsWith('tool:') || [AGENT_SECTION, TOOL_GUIDANCE, TIME_CONTEXT, USER_RUNTIME, USER_DIRECTORY, USER_CWD].includes(name))) fail('managed-section', `prompt.sections.${name}: cannot be a custom section`);
    if (!name.trim() || name !== name.trim() || name.length > 256 || /[\x00-\x1f\x7f]/.test(name) || !section || typeof section.text !== 'string' || section.text.length > 200000 || !Number.isFinite(section.order) || typeof section.enabled !== 'boolean' || (section.custom !== undefined && typeof section.custom !== 'boolean') || (section.role !== undefined && !['system', 'user'].includes(section.role))) fail('invalid-section', `prompt.sections.${name}: expected a name, text (max 200000 characters), finite order, enabled and optional system/user role`);
  }
  if (!p.tools) fail('invalid-tools', 'tools: required');
  stringList(p.tools.enabled, 'tools.enabled');
  stringList(p.tools.packages, 'tools.packages');
  p.tools.sources ??= {};
  record(p.tools.sources, 'tools.sources');
  for (const [name, source] of Object.entries(p.tools.sources)) if (!/^[A-Za-z0-9_:-]{1,256}$/.test(name) || typeof source !== 'string' || !/^@deepseek-ai\/dsh-tool-[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(source)) fail('invalid-tool-source', `tools.sources.${name}: expected a tool name and official package source`);
  for (const [name, source] of Object.entries(p.tools.sources)) {
    const provider = catalog.find(tool => tool.name === name);
    if (catalog.length && provider?.package !== source) fail('invalid-tool-source', `tools.sources.${name}: source does not provide this discovered tool`);
  }
  if (p.tools.packages.some(name => !/^@deepseek-ai\/dsh-tool-[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(name))) fail('invalid-package', 'tools.packages: expected discovered official tool packages');
  if (p.tools.enabled.includes('run_code')) fail('reserved-tool', 'run_code is a reserved transport');
  record(p.tools.overrides, 'tools.overrides');
  for (const [name, override] of Object.entries(p.tools.overrides)) {
    if (!override || typeof override !== 'object') fail('invalid-override', `tools.overrides.${name}: expected an object`);
    if (override.prompt !== undefined && typeof override.prompt !== 'string') fail('invalid-override', `tools.overrides.${name}.prompt: expected text`);
    if (override.promptEnabled !== undefined && typeof override.promptEnabled !== 'boolean') fail('invalid-override', `tools.overrides.${name}.promptEnabled: expected boolean`);
    if (override.schema) validateToolJSON(override.schema, name, catalog.find(x => x.name === name)?.schema);
  }
  stringList(p.skills, 'skills');
  p.mcpEnabled ??= {};
  record(p.mcpEnabled, 'mcpEnabled');
  for (const [name, enabled] of Object.entries(p.mcpEnabled)) if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || typeof enabled !== 'boolean') fail('invalid-mcp', `mcpEnabled.${name}: expected a valid server name and boolean`);
  p.mcp ??= [];
  if (!Array.isArray(p.mcp) || p.mcp.some(server => !server || typeof server !== 'object' || Array.isArray(server))) fail('invalid-mcp', 'mcp: expected an array of server configurations');
  const serverNames = new Set();
  p.mcp = p.mcp.map((server, index) => validateMcp(server, `mcp[${index}]`, serverNames));
  p.revision = (previous?.revision ?? 0) + 1;
  return { id: p.id, name: p.name, description: p.description, builtin: p.builtin, enabled: p.enabled, revision: p.revision, prompt: p.prompt, tools: p.tools, skills: p.skills, mcp: p.mcp, mcpEnabled: p.mcpEnabled };
}
export function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) fail('invalid-object', `${path}: expected a plain record`);
}
function stringList(value, path) {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x.trim() || x !== x.trim() || x.length > 256) || new Set(value).size !== value.length) fail('invalid-list', `${path}: expected unique nonempty strings`);
}
export function validateMcp(value, path = 'mcp', names = new Set()) {
  record(value, path);
  const p = structuredClone(value);
  if (typeof p.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(p.serverName)) fail('invalid-mcp', `${path}.serverName: expected 1-32 letters, digits, hyphens or underscores`);
  if (names.has(p.serverName)) fail('duplicate-mcp', `mcp.serverName: ${p.serverName} is already used in this preset`);
  names.add(p.serverName);
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') fail('invalid-mcp', `${path}.enabled: expected boolean`);
  if (!['stdio', 'streamable-http'].includes(p.transport)) fail('invalid-mcp', `${path}.transport: expected stdio or streamable-http`);
  const expression = item => typeof item === 'string' || Boolean(item && typeof item === 'object' && typeof item.__jsExpr === 'string' && Object.keys(item).length === 1);
  const map = (value, name) => { record(value, `${path}.${name}`); if (Object.values(value).some(item => !expression(item))) fail('invalid-mcp', `${path}.${name}: values must be strings or !!js expressions`); return value; };
  if (p.transport === 'stdio') {
    if (typeof p.command !== 'string' || !p.command.trim()) fail('invalid-mcp', `${path}.command: expected a command`);
    p.args ??= [];
    if (!Array.isArray(p.args) || p.args.some(item => typeof item !== 'string' || item.includes('\n'))) fail('invalid-mcp', `${path}.args: expected string arguments`);
    p.env = map(p.env ?? {}, 'env');
    p.cwd ??= '';
    if (typeof p.cwd !== 'string') fail('invalid-mcp', `${path}.cwd: expected text`);
  } else {
    let url; try { url = new URL(p.url); } catch {}
    if (!url || !['http:', 'https:'].includes(url.protocol)) fail('invalid-mcp', `${path}.url: expected an http(s) URL`);
    p.headers = map(p.headers ?? {}, 'headers');
  }
  for (const key of ['toolCallTimeoutMs', 'maxInstructionBytes']) if (p[key] !== undefined && (!Number.isFinite(p[key]) || p[key] < 1)) fail('invalid-mcp', `${path}.${key}: expected a positive number`);
  if (p.failOnStartupError !== undefined && typeof p.failOnStartupError !== 'boolean') fail('invalid-mcp', `${path}.failOnStartupError: expected boolean`);
  if (p.reconnect !== undefined) {
    record(p.reconnect, `${path}.reconnect`);
    for (const key of ['enabled']) if (p.reconnect[key] !== undefined && typeof p.reconnect[key] !== 'boolean') fail('invalid-mcp', `${path}.reconnect.${key}: expected boolean`);
    for (const key of ['initialDelayMs', 'maxDelayMs', 'maxAttempts']) if (p.reconnect[key] !== undefined && (!Number.isInteger(p.reconnect[key]) || p.reconnect[key] < 1)) fail('invalid-mcp', `${path}.reconnect.${key}: expected a positive integer`);
  }
  return p;
}
export function validateToolJSON(value, name, original) {
  if (value?.type !== 'function') fail('invalid-schema', 'type: expected "function"');
  if (value.function?.name !== name) fail('invalid-schema', `function.name: must remain "${name}"`);
  if (typeof value.function.description !== 'string') fail('invalid-schema', 'function.description: expected text');
  const parameters = value.function.parameters;
  if (parameters?.type !== 'object') fail('invalid-schema', 'function.parameters.type: expected "object"');
  record(parameters.properties, 'function.parameters.properties');
  stripSchemaDescriptions(parameters, 'function.parameters');
  if (original && !sameToolSchema(value, original)) fail('immutable-schema', 'Only description fields can change; parameter names, types, required fields and constraints must remain unchanged');
  return value;
}
export const sameToolSchema = (a, b) => isDeepStrictEqual(stripDescriptions(a), stripDescriptions(b));
function stripDescriptions(value) {
  if (!value?.function) return value;
  const { description, ...definition } = value.function;
  return { ...value, function: { ...definition, parameters: stripSchemaDescriptions(definition.parameters) } };
}
function stripSchemaDescriptions(value, path = 'parameters', depth = 0) {
  if (!value || typeof value !== 'object') return value;
  if (depth > 64) fail('invalid-schema', `${path}: schema nesting exceeds 64 levels`);
  // Only schema nodes own editable descriptions. Instance values (const,
  // default, enum, examples) and unknown extension payloads remain exact.
  const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
  const children = ['items', 'additionalItems', 'additionalProperties', 'unevaluatedItems', 'unevaluatedProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema'];
  const arrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
  return Object.fromEntries(Object.entries(value).filter(([key, child]) => {
    if (key !== 'description') return true;
    if (typeof child !== 'string') fail('invalid-schema', `${path}.description: expected text`);
    return false;
  }).map(([key, child]) => [key,
    maps.includes(key) && child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, stripSchemaDescriptions(schema, `${path}.${key}.${name}`, depth + 1)]))
      : arrays.includes(key) || (key === 'items' && Array.isArray(child))
        ? Array.isArray(child) ? child.map((schema, index) => stripSchemaDescriptions(schema, `${path}.${key}[${index}]`, depth + 1)) : child
        : children.includes(key) ? stripSchemaDescriptions(child, `${path}.${key}`, depth + 1) : child
  ]));
}
export function functionSchema(schema) {
  return { type: 'function', function: { name: schema.name, description: schema.description ?? '', parameters: structuredClone(schema.parameters) } };
}
export function selectedBinding(header, events) {
  let id = header.agentPreset;
  for (const event of events) if (event.type === 'agent-preset/selected') id = event.data.agentPreset;
  return id;
}
export function filterMcpSections(sections, preset) {
  const disabledMcp = new Set([
    ...Object.entries(preset.mcpEnabled ?? {}).filter(([, value]) => value === false).map(([name]) => name),
    ...(preset.mcp ?? []).filter(server => server.enabled === false).map(server => server.serverName),
  ]);
  return sections.flatMap(section => {
    if (section.name.startsWith('mcp:') && (disabledMcp.has(section.name.slice(4)) || !section.text?.trim())) return [];
    if (section.name !== 'mcp-resource-servers') return [section];
    const start = section.text.lastIndexOf('['), end = section.text.lastIndexOf(']');
    let servers;
    try { servers = JSON.parse(section.text.slice(start, end + 1)); } catch { return []; }
    if (!Array.isArray(servers) || servers.some(name => typeof name !== 'string')) return [];
    const visible = servers.filter(name => !disabledMcp.has(name));
    return visible.length ? [{ ...section, text: section.text.slice(0, start) + JSON.stringify(visible) + section.text.slice(end + 1) }] : [];
  });
}
export function transformPrompt(assembly, preset, catalog, definitions = new Map(), admittedTools) {
  const enabled = new Set(preset.tools.enabled);
  const selected = name => enabled.has(name) && (!admittedTools || admittedTools.has(name));
  const movedCwd = assembly.contexts?.some(context => context.name === 'working-directory:current');
  const sections = assembly.sections.filter(x => !PERSONA_SECTIONS.has(x.name) && x.name !== AGENT_SECTION);
  const activeSections = new Set();
  const knownSections = new Set();
  for (const tool of catalog) for (const name of tool.sections ?? []) {
    knownSections.add(name);
    if (selected(tool.name)) activeSections.add(name);
  }
  const result = [{ name: 'preset-workshop:persona', text: preset.prompt.persona, order: -1000 }];
  for (const [index, section] of sections.entries()) {
    const toolName = section.name.startsWith('tool:') ? section.name.slice(5) : undefined;
    const edit = preset.prompt.sections[section.name];
    if (!section.text?.trim() && !toolName && !(section.name === 'deployment:persona-suffix' && edit?.text.trim())) continue;
    if (knownSections.has(section.name) && !activeSections.has(section.name)) continue;
    if (toolName && !knownSections.has(section.name) && !selected(toolName)) continue;
    const candidates = catalog.filter(tool => selected(tool.name) && (tool.sections ?? []).includes(section.name));
    const toolOverride = preset.tools.overrides[toolName];
    if (toolOverride?.promptEnabled === false) continue;
    // A shared section remains only while an enabled tool still uses its native text.
    if (candidates.length && !candidates.some(tool => {
      const override = preset.tools.overrides[tool.name];
      return !override || (override.promptEnabled !== false && override.prompt === undefined);
    })) continue;
    if (edit?.enabled === false) continue;
    if (movedCwd && isLegacyCwdSection({ ...section, text: edit?.text ?? section.text })) continue;
    result.push({ ...section, text: edit?.text ?? toolOverride?.prompt ?? section.text, order: edit?.order ?? definitions.get(section.name)?.order ?? (index + 1) * 100 });
  }
  for (const [name, section] of Object.entries(preset.prompt.sections)) {
    if (section.custom && section.role !== 'user' && ![AGENT_SECTION, DIRECTORY_AGENT, TOOL_GUIDANCE, TIME_CONTEXT, USER_RUNTIME].includes(name) && !knownSections.has(name) && !name.startsWith('tool:') && section.enabled && !sections.some(x => x.name === name)) result.push({ name, text: section.text, order: section.order });
  }
  for (const tool of catalog.filter(tool => selected(tool.name))) {
    const override = preset.tools.overrides[tool.name];
    const name = 'tool:' + tool.name;
    if (!override || override.promptEnabled === false || result.some(section => section.name === name)) continue;
    const text = override.prompt;
    if (text === undefined) continue;
    const source = catalog.find(known => known.name === tool.name)?.sections?.[0];
    result.push({ name, text, order: definitions.get(name)?.order ?? definitions.get(source)?.order ?? 1000 });
  }
  const guidance = preset.prompt.sections[TOOL_GUIDANCE];
  if (guidance) {
    const isGuidance = section => section.name.startsWith('tool:') || knownSections.has(section.name);
    const members = result.filter(isGuidance).sort((a, b) => a.order - b.order);
    if (!guidance.enabled) members.forEach(section => result.splice(result.indexOf(section), 1));
    else {
      const upper = Math.min(...result.filter(section => !isGuidance(section) && section.order > guidance.order).map(section => section.order), guidance.order + 100);
      members.forEach((section, index) => { section.order = guidance.order + (upper - guidance.order) * index / Math.max(1, members.length); });
    }
  }
  result.sort((a, b) => a.name === 'preset-workshop:persona' ? -1 : b.name === 'preset-workshop:persona' ? 1 : a.order - b.order);
  const visibleSections = filterMcpSections(result.map(({ order, ...section }) => section), preset);
  return { ...assembly, sections: visibleSections };
}
