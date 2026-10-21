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
    tools: { enabled: [shell, ...Object.keys(BUILTINS).filter(name => !['bash', 'pwsh'].includes(name))], packages: [], overrides: {} },
    skills: [],
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
    if (section?.custom && (name.startsWith('tool:') || [AGENT_SECTION, TOOL_GUIDANCE].includes(name))) fail('managed-section', `prompt.sections.${name}: cannot be a custom section`);
    if (!name.trim() || name !== name.trim() || name.length > 256 || /[\x00-\x1f\x7f]/.test(name) || !section || typeof section.text !== 'string' || section.text.length > 200000 || !Number.isFinite(section.order) || typeof section.enabled !== 'boolean' || (section.custom !== undefined && typeof section.custom !== 'boolean')) fail('invalid-section', `prompt.sections.${name}: expected a name, text (max 200000 characters), finite order and enabled`);
  }
  if (!p.tools) fail('invalid-tools', 'tools: required');
  stringList(p.tools.enabled, 'tools.enabled');
  stringList(p.tools.packages, 'tools.packages');
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
  p.revision = (previous?.revision ?? 0) + 1;
  return { id: p.id, name: p.name, description: p.description, builtin: p.builtin, enabled: p.enabled, revision: p.revision, prompt: p.prompt, tools: p.tools, skills: p.skills };
}
export function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) fail('invalid-object', `${path}: expected a plain record`);
}
function stringList(value, path) {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x.trim() || x !== x.trim() || x.length > 256) || new Set(value).size !== value.length) fail('invalid-list', `${path}: expected unique nonempty strings`);
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
export function transformPrompt(assembly, preset, catalog, definitions = new Map()) {
  const enabled = new Set(preset.tools.enabled);
  // The cwd suffix is a normal, editable supplemental section.
  const sections = assembly.sections.filter(x => !PERSONA_SECTIONS.has(x.name) && x.name !== AGENT_SECTION);
  const activeSections = new Set();
  const knownSections = new Set();
  for (const tool of catalog) for (const name of tool.sections ?? []) {
    knownSections.add(name);
    if (enabled.has(tool.name)) activeSections.add(name);
  }
  const tools = assembly.tools.filter(x => x.name === 'run_code' || enabled.has(x.name)).map(tool => {
    const override = preset.tools.overrides[tool.name]?.schema;
    if (!override) return tool;
    validateToolJSON(override, tool.name, functionSchema(tool));
    return { ...tool, ...structuredClone(override.function) };
  });
  const result = [{ name: 'preset-workshop:persona', text: preset.prompt.persona, order: -1000 }];
  for (const [index, section] of sections.entries()) {
    const toolName = section.name.startsWith('tool:') ? section.name.slice(5) : undefined;
    if (knownSections.has(section.name) && !activeSections.has(section.name)) continue;
    if (toolName && !knownSections.has(section.name) && !enabled.has(toolName)) continue;
    const candidates = catalog.filter(tool => enabled.has(tool.name) && (tool.sections ?? []).includes(section.name));
    const toolOverride = preset.tools.overrides[toolName];
    if (toolOverride?.promptEnabled === false) continue;
    // A shared section remains only while an enabled tool still uses its native text.
    if (candidates.length && !candidates.some(tool => {
      const override = preset.tools.overrides[tool.name];
      return !override || (override.promptEnabled !== false && override.prompt === undefined);
    })) continue;
    const edit = preset.prompt.sections[section.name];
    if (edit?.enabled === false) continue;
    result.push({ ...section, text: edit?.text ?? toolOverride?.prompt ?? section.text, order: edit?.order ?? definitions.get(section.name)?.order ?? (index + 1) * 100 });
  }
  for (const [name, section] of Object.entries(preset.prompt.sections)) {
    if (![AGENT_SECTION, DIRECTORY_AGENT, TOOL_GUIDANCE].includes(name) && !knownSections.has(name) && !name.startsWith('tool:') && section.enabled && !sections.some(x => x.name === name)) result.push({ name, text: section.text, order: section.order });
  }
  for (const tool of tools) {
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
  return { ...assembly, sections: result.map(({ order, ...section }) => section), tools };
}
