import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { newPreset, validatePreset, validateMcp, record, fail, USER_CWD, USER_RUNTIME, USER_DIRECTORY, TIME_CONTEXT } from '../domain/core.js';
import type { ImportEdits, McpServer, Preset, PromptSection, SkillResourceBase, ToolOverride, ToolSchema } from '../domain/types.js';

type TransferTool = { name: string; package?: string; kind?: string; available?: boolean; schema?: ToolSchema; alternates?: TransferTool[] };
type TransferSkill = { name: string; path?: string; resourceBase?: SkillResourceBase };
type PortableTool = { name: string; description: string; override?: { description?: string; prompt?: string; promptEnabled?: boolean } };
type PortablePreset = { id: string; name: string; description: string; prompt: Preset['prompt']; tools: PortableTool[]; mcp: McpServer[]; skills: { name: string; path: string }[] };

export const ARCHIVE_MARKER = 'dsh-preset-workshop';
const ARCHIVE_LIMIT = 8 * 1024 * 1024;
const MANIFEST = 'dsh-preset-workshop.json';
const dynamicUser = new Set([USER_CWD, USER_RUNTIME, USER_DIRECTORY, TIME_CONTEXT, 'workshop:user-skill']);
const toolExcerpt = (text: unknown) => String(text ?? '').trim().split(/(?<=[.!?。！？])\s+|\n\s*\n/).slice(0, 2).join(' ').slice(0, 320);

function privateUrl(value: unknown): string {
  if (typeof value !== 'string') return ARCHIVE_MARKER;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    if (url.username) url.username = ARCHIVE_MARKER;
    if (url.password) url.password = ARCHIVE_MARKER;
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, ARCHIVE_MARKER);
    if (url.hash) url.hash = ARCHIVE_MARKER;
    url.pathname = url.pathname.replace(/(\/(?:key|token|secret|auth)\/)[^/]+/gi, '$1' + ARCHIVE_MARKER).replace(/\/[^/]{32,}(?=\/|$)/g, '/' + ARCHIVE_MARKER);
    return url.href;
  } catch { return value; }
}
function privateHeader(value: string) {
  const prefix = value.match(/^(\s*[^:\s][^:]*\s*:\s*)/)?.[1];
  return prefix ? prefix + ARCHIVE_MARKER : ARCHIVE_MARKER;
}
export function portableMcp(server: McpServer) {
  const value: McpServer = { serverName: server.serverName, transport: server.transport, enabled: false };
  if (server.transport === 'stdio') {
    value.command = typeof server.command === 'string' ? server.command : ARCHIVE_MARKER;
    let secret = false, header = false;
    value.args = (server.args ?? []).map(arg => {
      if (typeof arg !== 'string') return ARCHIVE_MARKER;
      const hideSecret = secret, hideHeader = header;
      secret = /(?:token|key|secret|password|authorization)$/i.test(arg);
      header = /^(?:--headers?|-H)$/i.test(arg);
      const inlineHeader = arg.match(/^(--headers?=|-H(?:=)?)(.*)$/i);
      if (inlineHeader) return inlineHeader[1] + privateHeader(inlineHeader[2]);
      if (hideHeader) return privateHeader(arg);
      if (hideSecret) return ARCHIVE_MARKER;
      return privateUrl(arg).replace(/((?:token|key|secret|password|authorization)=).*/i, '$1' + ARCHIVE_MARKER);
    });
    value.env = Object.fromEntries(Object.keys(server.env ?? {}).map(key => [key, ARCHIVE_MARKER]));
    if (server.cwd) value.cwd = typeof server.cwd === 'string' ? server.cwd : ARCHIVE_MARKER;
  } else {
    value.url = privateUrl(server.url);
    value.headers = Object.fromEntries(Object.keys(server.headers ?? {}).map(key => [key, ARCHIVE_MARKER]));
  }
  return validateMcp(value);
}
export function portablePreset(preset: Preset, catalog: TransferTool[], skills: TransferSkill[], servers: McpServer[], native: Record<string, string> = {}): PortablePreset {
  const sections = Object.fromEntries(Object.entries(preset.prompt.sections as Record<string, PromptSection>).map(([name, section]) => {
    if (section.custom) return [name, structuredClone(section)];
    const inherit = section.inherit || dynamicUser.has(name) || section.text === native[name];
    return [name, { text: inherit ? '' : section.text, enabled: section.enabled, order: section.order, ...(inherit ? { inherit: true } : {}) }];
  }));
  return {
    id: preset.id, name: preset.name, description: preset.description,
    prompt: { persona: preset.prompt.persona, sections },
    tools: preset.tools.enabled.filter(name => !name.startsWith('mcp__')).map(name => {
      const tool = catalog.find(item => item.name === name);
      const override = preset.tools.overrides[name] ?? {};
      const portableOverride = {
        ...(override.schema?.function?.description === undefined ? {} : { description: override.schema.function.description }),
        ...(override.prompt === undefined ? {} : { prompt: override.prompt }),
        ...(override.promptEnabled === undefined ? {} : { promptEnabled: override.promptEnabled }),
      };
      return { name, description: toolExcerpt(tool?.schema?.function?.description), ...(Object.keys(portableOverride).length ? { override: portableOverride } : {}) };
    }),
    mcp: servers.map(portableMcp),
    skills: preset.skills.map(name => { const skill = skills.find(item => item.name === name); return { name, path: skill?.path ?? (skill?.resourceBase?.kind === 'directory' ? skill.resourceBase.path.replace(/[\\/]$/, '') + '/SKILL.md' : '') }; }),
  };
}
export function writePresetArchive(presets: PortablePreset[]) {
  const bytes = strToU8(JSON.stringify({ format: ARCHIVE_MARKER, version: 2, hostPrompts: 'target-environment', presets }));
  if (bytes.length > ARCHIVE_LIMIT) fail('payload-too-large', 'Export exceeds 8 MiB');
  const zip = zipSync({ [MANIFEST]: bytes }, { level: 6 });
  let binary = ''; for (let start = 0; start < zip.length; start += 8192) binary += String.fromCharCode(...zip.subarray(start, start + 8192));
  return { format: 'zip', data: btoa(binary) };
}
export function readPresetArchive(data: string): PortablePreset[] {
  if (typeof data !== 'string' || data.length > Math.ceil(ARCHIVE_LIMIT * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail('invalid-import', 'Expected one ZIP file up to 8 MiB');
  let document: { format: string; version: number; hostPrompts: string; presets: PortablePreset[] };
  try {
    const zip = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (zip.length > ARCHIVE_LIMIT) throw Error('ZIP exceeds 8 MiB');
    let count = 0;
    const files = unzipSync(zip, { filter: file => {
      if (++count !== 1 || file.name !== MANIFEST || file.originalSize > ARCHIVE_LIMIT) throw Error('Expected one Preset Workshop manifest up to 8 MiB');
      return true;
    } });
    if (!files[MANIFEST] || files[MANIFEST].length > ARCHIVE_LIMIT) throw Error('Missing Preset Workshop manifest');
    document = JSON.parse(strFromU8(files[MANIFEST]), (key, value) => {
      if (['__proto__', 'prototype', 'constructor', '__jsExpr'].includes(key)) throw Error('Executable expressions and unsafe keys are not allowed');
      return value;
    });
  } catch (error) { fail('invalid-import', 'Invalid Preset Workshop ZIP: ' + error.message); }
  if (document?.format !== ARCHIVE_MARKER || document.version !== 2 || document.hostPrompts !== 'target-environment' || !Array.isArray(document.presets) || !document.presets.length) fail('invalid-import', 'ZIP is missing the dsh-preset-workshop marker or uses an unsupported format');
  for (const item of document.presets) {
    record(item, 'imported preset');
    const names = (list: { name: string }[]) => Array.isArray(list) && list.every(row => row && typeof row.name === 'string' && row.name.trim() && row.name.length <= 256) && new Set(list.map(row => row.name)).size === list.length;
    if (!names(item.tools) || item.tools.some(row => typeof row.description !== 'string' || row.description.length > 320 || row.name.startsWith('mcp__')) || !names(item.skills) || item.skills.some(row => typeof row.path !== 'string' || row.path.length > 4096)) fail('invalid-import', 'Invalid tool or skill inventory');
    const overrides: Record<string, ToolOverride> = {};
    for (const row of item.tools) {
      if (row.override === undefined) continue;
      record(row.override, `tools.${row.name}.override`);
      if (Object.keys(row.override).some(key => !['description', 'prompt', 'promptEnabled'].includes(key)) || row.override.description !== undefined && typeof row.override.description !== 'string' || row.override.prompt !== undefined && typeof row.override.prompt !== 'string' || row.override.promptEnabled !== undefined && typeof row.override.promptEnabled !== 'boolean') fail('invalid-import', `Invalid override for tool ${row.name}`);
      const { prompt, promptEnabled } = row.override;
      if (prompt !== undefined || promptEnabled !== undefined) overrides[row.name] = { ...(prompt === undefined ? {} : { prompt }), ...(promptEnabled === undefined ? {} : { promptEnabled }) };
    }
    validatePreset({ ...newPreset(item.id, item.name), description: item.description, prompt: item.prompt, tools: { enabled: item.tools.map(row => row.name), packages: [], sources: {}, overrides }, skills: item.skills.map(row => row.name), mcp: item.mcp });
  }
  return document.presets;
}
export function importPlan(item: PortablePreset, catalog: TransferTool[], edit: ImportEdits = {}) {
  record(edit, 'import edits');
  const choices = item.tools.map(row => {
    const canonical = catalog.find(tool => tool.name === row.name && tool.kind !== 'mcp');
    const candidates = canonical ? [canonical, ...(canonical.alternates ?? [])].filter(tool => tool.available) : [];
    const matches = candidates.filter(tool => toolExcerpt(tool.schema?.function?.description) === row.description);
    const matched = matches.length === 1 ? matches[0] : matches.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
    return { name: row.name, available: Boolean(matched), source: matched?.package ?? '', canonical: canonical?.package ?? '' };
  });
  for (const key of ['tools', 'skills'] as const) if (edit[key] !== undefined && (!Array.isArray(edit[key]) || edit[key].some(name => !item[key].some(row => row.name === name)) || new Set(edit[key]).size !== edit[key].length)) fail('invalid-import', `Invalid ${key} selection`);
  const selected = edit.tools ?? choices.filter(row => row.available).map(row => row.name);
  if (selected.some(name => !choices.find(row => row.name === name)?.available)) fail('tool-unavailable', 'An imported tool is unavailable in this environment');
  const prompt = structuredClone(item.prompt);
  if (edit.persona !== undefined) prompt.persona = edit.persona;
  if (edit.custom !== undefined) {
    record(edit.custom, 'custom sections');
    for (const [name, text] of Object.entries(edit.custom)) {
      if (!prompt.sections[name]?.custom || prompt.sections[name].role === 'user' || typeof text !== 'string') fail('invalid-import', 'Only custom System sections are editable during import');
      prompt.sections[name].text = text;
    }
  }
  const overrides = Object.fromEntries(item.tools.flatMap(row => {
    if (!selected.includes(row.name) || !row.override) return [];
    const { description, prompt, promptEnabled } = row.override, override: ToolOverride = {};
    if (description !== undefined) {
      const tool = catalog.find(candidate => candidate.name === row.name);
      const matched = tool && [tool, ...(tool.alternates ?? [])].find(candidate => candidate.package === choices.find(choice => choice.name === row.name)?.source);
      if (!matched?.schema) fail('tool-unavailable', `Cannot restore the schema override for ${row.name}`);
      override.schema = structuredClone(matched.schema);
      override.schema.function.description = description;
    }
    if (prompt !== undefined) override.prompt = prompt;
    if (promptEnabled !== undefined) override.promptEnabled = promptEnabled;
    return Object.keys(override).length ? [[row.name, override]] : [];
  }));
  const preset = { ...newPreset(edit.id ?? item.id, edit.name ?? item.name), description: edit.description ?? item.description, prompt,
    tools: { enabled: selected, packages: [] as string[], overrides, sources: Object.fromEntries(choices.filter(row => selected.includes(row.name) && row.source && row.source !== row.canonical).map(row => [row.name, row.source])) },
    skills: edit.skills ?? item.skills.map(row => row.name), mcp: item.mcp.map(server => ({ ...server, enabled: false })),
  };
  return { preset, tools: choices };
}
