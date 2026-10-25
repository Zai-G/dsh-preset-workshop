import assert from 'node:assert/strict';
import { access, rm, readFile, writeFile, mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { host } from './host-harness.mjs';
import * as plugin from '../src/index.js';
import { createScope } from '@deepseek-ai/dsh-scope';
import { selectedBinding, AGENT_SECTION, TOOL_GUIDANCE } from '../src/core.js';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { WorkshopStore, atomicJSON } from '../src/store.js';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { fileURLToPath } from 'node:url';

const { ctx, home } = await host({ personaSuffix: 'Your working directory is {{cwd}}.' });
const workspace = await mkdtemp(join(tmpdir(), 'preset-workshop-workspace-test-'));
try {
  const referencesModule = await ctx.loader.root.tree.import('@deepseek-ai/dsh-file-reference-local');
  await ctx.plugin(referencesModule.default, {}).await();
  await ctx.plugin(plugin, {}).await();
  const workshop = ctx.presetWorkshop;
  await workshop.ready;
  const roster = await ctx.agentPresets.list();
  assert.ok(roster.some(p => p.id === 'preset_workshop' && !p.broken), JSON.stringify(roster));
  console.log('PASS: underscore id, isolated skill registry and real official tool rows activate');
  const probeServerPath = fileURLToPath(new URL('./fixtures/mcp-probe-server.mjs', import.meta.url));
  const probeCallMarker = join(home, 'probe-tool-called');
  const beforeProbe = JSON.stringify(workshop.store.state.presets);
  const detected = await workshop.action({ action: 'mcp-probe', server: { serverName: 'probe', transport: 'stdio', command: process.execPath, args: [probeServerPath], env: { MCP_PROBE_CALL_MARKER: probeCallMarker }, cwd: home } });
  assert.equal(detected.ok, true, detected.message);
  assert.equal(detected.count, 1);
  const missingProbe = await workshop.action({ action: 'mcp-probe', server: { serverName: 'probe', transport: 'stdio', command: '/definitely/not/a/command', args: [], env: {}, cwd: home } });
  assert.equal(missingProbe.ok, false);
  assert.equal(JSON.stringify(workshop.store.state.presets), beforeProbe, 'connection checks must not save configurations');
  assert.equal(await access(probeCallMarker).then(() => true, () => false), false, 'MCP detection must not invoke tools');
  assert.ok(!ctx.tools.schemas().some(tool => tool.name === 'mcp__probe__ping'), 'detection must dispose its temporary tool registration');
  console.log('PASS: MCP detection lists tools without invoking them, saving configuration or leaking scoped registrations');
  const initial = await workshop.preview({ id: 'preset_workshop' });
  assert.ok((await workshop.snapshot()).catalog.counts.tools >= 9, 'startup must complete one catalog scan');
  assert.ok(initial.displayPrompt.includes('read：') && initial.displayPrompt.includes('\n\nwrite：'));
  assert.deepEqual(initial.tools.map(t => t.function.name).sort(), ['ask_user_question', 'bash', 'edit', 'read', 'todo_write', 'web_fetch', 'web_search', 'write'].sort());
  assert.ok(initial.displayPrompt.includes('# TOOL\n'));
  assert.ok(!initial.displayPrompt.includes('"parameters"'));
  assert.deepEqual(initial.skillCatalog, []);
  assert.ok(initial.catalog.some(tool => tool.name === 'subagent' && tool.available));
  assert.equal(initial.agentInstructions.reorderable, false);
  assert.ok(initial.prompt.includes('Tokens prefixed with @'));
  assert.ok(initial.displayPrompt.startsWith('# System\n\n'));
  assert.ok(initial.sections.find(section => section.name === 'context:file-reference').order < initial.sections.find(section => section.name.startsWith('tool:')).order);
  assert.ok(initial.editableSections.some(section => section.name === TOOL_GUIDANCE && section.editable && section.reorderable && section.members.length));
  const resourceFixture = ctx.tools.register(defineTool({ name: 'list_mcp_resources', package: '@test/incorrect-source', description: 'List resources', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'ok' }));
  try {
    workshop.catalog.syncGlobalTools();
    const resourcePreview = await workshop.preview({ id: 'preset_workshop', draft: { tools: { ...workshop.preset('preset_workshop').tools, enabled: [...initial.tools.map(tool => tool.function.name), 'list_mcp_resources'] } } });
    const resourceTool = resourcePreview.catalog.find(tool => tool.name === 'list_mcp_resources');
    assert.equal(resourceTool.kind, 'official');
    assert.equal(resourceTool.package, '@deepseek-ai/dsh-mcp-resources');
    assert.ok(resourcePreview.tools.some(tool => tool.function.name === 'list_mcp_resources'));
    assert.ok(!resourcePreview.mcp.some(server => server.tools.some(tool => tool.function?.name === 'list_mcp_resources')));
  } finally { resourceFixture(); workshop.catalog.syncGlobalTools(); }
  console.log('PASS: official MCP resource tools stay in Tools > Official and out of server groups');
  const mcpFixture = ctx.tools.register(defineTool({ name: 'mcp__local__ping', description: 'MCP fixture ping', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'pong' }));
  try {
    const mcpPreset = { mcp: [{ serverName: 'local', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }] };
    const disabledMcp = await workshop.preview({ id: 'preset_workshop', draft: { ...mcpPreset, tools: { ...workshop.preset('preset_workshop').tools, enabled: initial.tools.map(tool => tool.function.name) } } });
    assert.deepEqual(disabledMcp.mcp.find(server => server.serverName === 'local').tools.map(tool => tool.function.name), ['mcp__local__ping']);
    assert.ok(!disabledMcp.tools.some(tool => tool.function.name === 'mcp__local__ping'));
    const enabledMcp = await workshop.preview({ id: 'preset_workshop', draft: { ...mcpPreset, tools: { ...workshop.preset('preset_workshop').tools, enabled: [...initial.tools.map(tool => tool.function.name), 'mcp__local__ping'] } } });
    assert.deepEqual(enabledMcp.tools.map(tool => tool.function.name).filter(name => name.startsWith('mcp__')), ['mcp__local__ping']);
    assert.ok(enabledMcp.displayPrompt.includes('## MCP服务器\n\nmcp__local__ping：MCP fixture ping'));
  } finally { mcpFixture(); }
  console.log('PASS: MCP inventory remains visible when its tools are disabled, and enabled MCP tools enter preview without crashing');
  workshop.catalog.syncGlobalTools();
  const offlineMcp = await workshop.preview({ id: 'preset_workshop', draft: { mcp: [{ serverName: 'local', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }], tools: { ...workshop.preset('preset_workshop').tools, enabled: [...initial.tools.map(tool => tool.function.name), 'mcp__local__ping'] } } });
  const offlineTool = offlineMcp.mcp.find(server => server.serverName === 'local')?.tools[0];
  assert.deepEqual(offlineTool, { name: 'mcp__local__ping', description: '', unavailable: true });
  assert.ok(!offlineMcp.tools.some(tool => tool.function.name === 'mcp__local__ping'));
  console.log('PASS: offline preset MCP selections remain visible without inventing a callable schema');
  const originalRows = [...ctx.loader.root.data];
  const environmentMcp = serverName => ({ id: 'environment-' + serverName, name: '@deepseek-ai/dsh-mcp-client', config: { serverName, transport: 'stdio', command: process.execPath, args: [probeServerPath], env: {}, cwd: home } });
  const resourceSections = [
    ctx.systemPrompt.section({ name: 'mcp-resource-servers', order: 3100, text: 'Servers: ["a","a__b"]' }),
    ctx.systemPrompt.section({ name: 'mcp:a', order: 3101, text: 'ENV A INSTRUCTIONS' }),
  ];
  try {
    await ctx.loader.root.update([...originalRows, environmentMcp('a'), environmentMcp('a__b'), { ...environmentMcp('closed'), disabled: true }]);
    await ctx.loader.await();
    workshop.catalog.syncGlobalTools();
    assert.deepEqual(workshop.catalog.mcpServers.map(server => server.serverName), ['a', 'a__b']);
    assert.equal((await workshop.snapshot()).catalog.tools.find(tool => tool.name === 'mcp__a__b__ping').mcpServer, 'a__b');
    const globalMcpPreview = await workshop.preview({ id: 'preset_workshop' });
    assert.deepEqual(globalMcpPreview.mcp.find(server => server.serverName === 'a').config, environmentMcp('a').config);
    await workshop.action({ action: 'create', id: 'mcp_switches', name: 'MCP switches' });
    let current = workshop.preset('mcp_switches');
    await assert.rejects(workshop.action({ action: 'save', id: current.id, revision: current.revision, changes: { mcpEnabled: { a: false }, tools: { ...current.tools, enabled: ['mcp__a__ping'] } } }), error => error.code === 'mcp-disabled');
    await assert.rejects(workshop.preview({ id: current.id, draft: { mcpEnabled: { a: false }, tools: { ...current.tools, enabled: ['mcp__a__ping'] } } }), error => error.code === 'mcp-disabled');
    await assert.rejects(workshop.action({ action: 'mcp-create', id: current.id, revision: current.revision, server: environmentMcp('a').config }), error => error.code === 'duplicate-mcp');
    const custom = { serverName: 'custom', transport: 'stdio', command: process.execPath, args: ['--version'], env: { TEST_VALUE: 'visible', TOKEN: { __jsExpr: 'process.env.TEST_TOKEN' } }, cwd: home, enabled: false };
    await workshop.action({ action: 'save', id: current.id, revision: current.revision, changes: { mcpEnabled: { a: false }, mcp: [custom], tools: { ...current.tools, enabled: ['mcp__a__b__ping'] } } });
    current = workshop.preset(current.id);
    const reopened = new WorkshopStore(workshop.store.root); await reopened.init();
    assert.equal(reopened.state.presets.find(p => p.id === current.id).mcpEnabled.a, false);
    assert.ok(!workshop.definition(current).plugins.some(row => row.name === '@deepseek-ai/dsh-mcp-client'));
    const closed = await workshop.preview({ id: current.id });
    assert.deepEqual(closed.mcp.find(server => server.serverName === 'custom').env, custom.env);
    assert.deepEqual(closed.mcp.find(server => server.serverName === 'custom').args, custom.args);
    for (const pool of [closed.sections, closed.editableSections]) {
      assert.ok(!pool.some(section => section.name === 'mcp:a'));
      assert.equal(pool.find(section => section.name === 'mcp-resource-servers').text, 'Servers: ["a__b"]');
    }
    assert.deepEqual(closed.tools.map(tool => tool.function.name), ['mcp__a__b__ping']);
    assert.equal(closed.mcp.find(server => server.serverName === 'a').enabled, false);
    assert.equal(closed.mcp.find(server => server.serverName === 'a').tools.length, 0);
    assert.equal((await workshop.action({ action: 'mcp-probe', id: current.id, serverName: 'a__b' })).count, 1);
    const beforeDisabledProbe = JSON.stringify(workshop.store.state);
    assert.equal((await workshop.action({ action: 'mcp-probe', id: current.id, serverName: 'a' })).count, 1);
    assert.equal(JSON.stringify(workshop.store.state), beforeDisabledProbe, 'detecting a disabled environment server must not enable or save it');
    const localProbe = { ...custom, serverName: 'disabled_local', command: process.execPath, args: [probeServerPath], env: { MCP_PROBE_CALL_MARKER: probeCallMarker } };
    await workshop.action({ action: 'save', id: current.id, revision: current.revision, changes: { mcp: [localProbe] } });
    current = workshop.preset(current.id);
    assert.equal((await workshop.action({ action: 'mcp-probe', id: current.id, serverName: localProbe.serverName })).count, 1);
    assert.equal(workshop.preset(current.id).mcp[0].enabled, false);
    assert.equal(await access(probeCallMarker).then(() => true, () => false), false);
    const disabledEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'environment-a');
    await disabledEntry.update({ disabled: true });
    const originalAssemble = ctx.systemPrompt.assemble.bind(ctx.systemPrompt);
    let globalAssemblies = 0;
    ctx.systemPrompt.assemble = options => { if (!options?.scope) globalAssemblies++; return originalAssemble(options); };
    try { await workshop.catalog.scan(); }
    finally { ctx.systemPrompt.assemble = originalAssemble; }
    assert.equal(globalAssemblies, 1, 'one scan reuses its global prompt baseline across all package probes');
    assert.ok(!workshop.catalog.mcpServers.some(server => server.serverName === 'a'));
    assert.ok(!workshop.catalog.tools.some(tool => tool.name === 'mcp__a__ping'));
    await workshop.action({ action: 'delete', id: current.id, revision: current.revision });
  } finally { resourceSections.forEach(dispose => dispose()); await ctx.loader.root.update(originalRows); workshop.catalog.syncGlobalTools(); }
  console.log('PASS: active environment MCP discovery, per-preset switches, longest-name ownership, resource filtering and read-only detection');
  let mcpActionPreset;
  try {
    await workshop.action({ action: 'create', id: 'mcp_actions', name: 'MCP actions' });
    mcpActionPreset = workshop.preset('mcp_actions');
    await workshop.action({ action: 'mcp-create', id: mcpActionPreset.id, revision: mcpActionPreset.revision, server: { serverName: 'docs', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {} } });
    mcpActionPreset = workshop.preset('mcp_actions');
    assert.equal(mcpActionPreset.mcp[0].serverName, 'docs');
    const emptyMcpPrompt = await workshop.preview({ id: mcpActionPreset.id });
    assert.ok(!emptyMcpPrompt.displayPrompt.includes('mcp:docs'), 'empty MCP system sections must not create duplicate preview entries');
    await workshop.action({ action: 'mcp-update', id: mcpActionPreset.id, revision: mcpActionPreset.revision, serverName: 'docs', server: { serverName: 'docs', transport: 'streamable-http', url: 'http://127.0.0.1:2/mcp', headers: {} } });
    mcpActionPreset = workshop.preset('mcp_actions');
    assert.equal(mcpActionPreset.mcp[0].url, 'http://127.0.0.1:2/mcp');
    await workshop.action({ action: 'mcp-delete', id: mcpActionPreset.id, revision: mcpActionPreset.revision, serverName: 'docs' });
    assert.deepEqual(workshop.preset('mcp_actions').mcp, []);
  } finally {
    if (mcpActionPreset) {
      const current = workshop.preset('mcp_actions');
      await workshop.action({ action: 'delete', id: current.id, revision: current.revision });
    }
  }
  console.log('PASS: MCP servers can be created, updated and deleted with revision checks');
  const guidanceDraft = { prompt: { persona: 'GUIDANCE PERSONA', sections: {
    [TOOL_GUIDANCE]: { text: '', order: 10300, enabled: true },
    'tool:read': { text: 'EDITED NATIVE READ INSTRUCTIONS', order: 1000, enabled: true },
  } } };
  const movedGuidance = await workshop.preview({ id: 'preset_workshop', draft: guidanceDraft });
  assert.ok(movedGuidance.prompt.indexOf('Your working directory is') < movedGuidance.prompt.indexOf('EDITED NATIVE READ INSTRUCTIONS'));
  assert.equal(movedGuidance.tools.find(schema => schema.function.name === 'read').function.description, initial.tools.find(schema => schema.function.name === 'read').function.description);
  guidanceDraft.tools = { ...workshop.preset('preset_workshop').tools, enabled: ['write'] };
  const fewerGuidance = await workshop.preview({ id: 'preset_workshop', draft: guidanceDraft });
  assert.ok(!fewerGuidance.prompt.includes('EDITED NATIVE READ INSTRUCTIONS'));
  assert.ok(fewerGuidance.editableSections.find(section => section.name === TOOL_GUIDANCE).members.every(member => member.name !== 'tool:read'));
  guidanceDraft.prompt.sections[TOOL_GUIDANCE].enabled = false;
  const disabledGuidance = await workshop.preview({ id: 'preset_workshop', draft: guidanceDraft });
  assert.deepEqual(disabledGuidance.tools.map(schema => schema.function.name), ['write']);
  assert.ok(!disabledGuidance.sections.some(section => section.name.startsWith('tool:')));
  console.log('PASS: tool guidance edits, ordering and disabling preserve dynamic tool membership and independent schemas');
  const retainedLayers = [ctx.tools.layers.scoped.size, ctx.systemPrompt.layers.scoped.size, ctx.sessions.list().length];
  for (let index = 0; index < 4; index++) await workshop.preview({ id: 'preset_workshop' });
  assert.deepEqual([ctx.tools.layers.scoped.size, ctx.systemPrompt.layers.scoped.size, ctx.sessions.list().length], retainedLayers, 'parent preview scope owns child registrations; detached sessions are not published');
  console.log('PASS: repeated preview reclaims child scope overlays and publishes no temporary sessions');
  console.log('PASS: default preview contains exactly eight tools; subagent is discoverable but optional');
  const beforeLate = await workshop.snapshot(), scanAt = beforeLate.catalog.scannedAt;
  const lateDispose = ctx.tools.register({ name: 'review_late_tool', package: '@test/review-plugin', description: 'Late registered global tool', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'ok' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const lateSnapshot = await workshop.snapshot();
  assert.ok(lateSnapshot.catalog.tools.some(tool => tool.name === 'review_late_tool' && tool.available));
  assert.equal(lateSnapshot.catalog.tools.find(tool => tool.name === 'review_late_tool').package, undefined, 'uncontracted definition metadata must not be presented as a scanned plugin source');
  assert.ok(lateSnapshot.catalog.revision > beforeLate.catalog.revision);
  assert.equal(lateSnapshot.catalog.scannedAt, scanAt);
  const latePreview = await workshop.preview({ id: 'preset_workshop', draft: { tools: { ...workshop.preset('preset_workshop').tools, enabled: ['review_late_tool'] } } });
  assert.deepEqual(latePreview.tools.map(tool => tool.function.name), ['review_late_tool']);
  const officialRead = structuredClone((await workshop.snapshot()).catalog.tools.find(tool => tool.name === 'read'));
  const collidingRead = ctx.tools.register(defineTool({ name: 'read', description: 'Late collision', parameters: { other: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'collision' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  const collisionSnapshot = await workshop.snapshot();
  assert.deepEqual(collisionSnapshot.catalog.tools.find(tool => tool.name === 'read').schema, officialRead.schema);
  assert.deepEqual((await workshop.preview({ id: 'preset_workshop', draft: { tools: { ...workshop.preset('preset_workshop').tools, enabled: ['read'] } } })).tools.map(tool => tool.function.name), ['read']);
  collidingRead();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual((await workshop.snapshot()).catalog.tools.find(tool => tool.name === 'read').schema, officialRead.schema);
  lateDispose();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(!(await workshop.snapshot()).catalog.tools.some(tool => tool.name === 'review_late_tool'), 'tools from revoked source plugins must leave the catalog');
  assert.equal((await workshop.snapshot()).catalog.scannedAt, scanAt);
  const unknownMcp = ctx.tools.register(defineTool({ name: 'mcp__unknown__late', description: 'Unknown MCP fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'ok' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await workshop.snapshot()).catalog.tools.find(tool => tool.name === 'mcp__unknown__late').kind, 'mcp');
  unknownMcp();
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log('PASS: late global tool registration/revocation refreshes unrestricted inventory without a scan, collision pollution or preview contamination');
  const beforeSource = await workshop.snapshot();
  const latePromptDispose = ctx.systemPrompt.section({ name: 'review:late-prompt', order: 75, text: 'Late prompt-only plugin' });
  const latePromptSnapshot = await workshop.snapshot();
  assert.notEqual(latePromptSnapshot.sourcesVersion, beforeSource.sourcesVersion);
  assert.equal(latePromptSnapshot.catalog.scannedAt, beforeSource.catalog.scannedAt);
  assert.ok((await workshop.preview({ id: 'preset_workshop' })).editableSections.some(section => section.name === 'review:late-prompt'));
  const afterSourcePreview = await workshop.snapshot();
  assert.equal(afterSourcePreview.sourcesVersion, latePromptSnapshot.sourcesVersion);
  const lateSkillDispose = ctx.skills.register({ name: 'review-late-skill', description: 'Late skill-only plugin', content: 'Late skill instructions', source: 'test' });
  const lateSkillSnapshot = await workshop.snapshot();
  assert.notEqual(lateSkillSnapshot.sourcesVersion, latePromptSnapshot.sourcesVersion);
  await workshop.preview({ id: 'preset_workshop', draft: { skills: ['review-late-skill'] } });
  assert.equal((await workshop.snapshot()).sourcesVersion, lateSkillSnapshot.sourcesVersion);
  latePromptDispose(); lateSkillDispose();
  assert.notEqual((await workshop.snapshot()).sourcesVersion, lateSkillSnapshot.sourcesVersion);
  const computedSection = text => ctx.systemPrompt.section({ name: 'review:computed', order: 76, text: () => text });
  let computedDispose = computedSection('FIRST CONFIG CONTENT');
  const firstComputed = await workshop.snapshot();
  computedDispose(); computedDispose = computedSection('SECOND CONFIG CONTENT');
  assert.ok((await workshop.preview({ id: 'preset_workshop' })).prompt.includes('SECOND CONFIG CONTENT'));
  assert.notEqual((await workshop.snapshot()).sourcesVersion, firstComputed.sourcesVersion);
  computedDispose();
  const beforeLateVariable = await workshop.snapshot();
  const lateVariableDispose = ctx.systemPrompt.variable('review_late_variable', () => 'LATE VARIABLE VALUE');
  assert.notEqual((await workshop.snapshot()).sourcesVersion, beforeLateVariable.sourcesVersion);
  assert.equal((await workshop.preview({ id: 'preset_workshop' })).variables.review_late_variable, 'LATE VARIABLE VALUE');
  lateVariableDispose();
  const beforeContext = await workshop.snapshot(), computedContext = text => ctx.systemPrompt.context({ name: 'review:late-context', order: 76, text: () => text });
  let contextDispose = computedContext('FIRST CONTEXT CONFIG');
  const firstContext = await workshop.snapshot();
  assert.notEqual(firstContext.sourcesVersion, beforeContext.sourcesVersion);
  contextDispose(); contextDispose = computedContext('SECOND CONTEXT CONFIG');
  const contextPreview = await workshop.preview({ id: 'preset_workshop' });
  assert.ok(JSON.stringify(contextPreview.contexts).includes('SECOND CONTEXT CONFIG'));
  assert.notEqual((await workshop.snapshot()).sourcesVersion, firstContext.sourcesVersion);
  contextDispose();
  console.log('PASS: late prompt-only and skill-only sources update versions, while previews do not trigger another refresh');
  const customVariable = ctx.systemPrompt.variable('custom_value', () => 'ACTUAL CUSTOM VALUE');
  try {
    const variables = await workshop.preview({ id: 'preset_workshop', draft: { prompt: { persona: 'Variable {{cwd}} {{custom_value}} literal $PHISTORY_WORKSPACE', sections: {} } } });
    assert.ok(variables.prompt.includes('literal $PHISTORY_WORKSPACE'));
    assert.ok(!variables.prompt.includes('{{cwd}}'));
    assert.ok(variables.prompt.includes('ACTUAL CUSTOM VALUE'));
    assert.equal(variables.variables.custom_value, 'ACTUAL CUSTOM VALUE');
  } finally { customVariable(); }
  const p = workshop.preset('preset_workshop');
  await workshop.action({ action: 'save', id: p.id, revision: p.revision, changes: { tools: { ...p.tools, enabled: ['read'] } } });
  const preview = await workshop.preview({ id: p.id });
  assert.deepEqual(preview.tools.map(t => t.function.name), ['read']);
  const noRead = await workshop.preview({ id: p.id, draft: { tools: { ...workshop.preset(p.id).tools, enabled: ['web_search'] } } });
  assert.ok(!noRead.prompt.includes('Tokens prefixed with @'));
  assert.ok(!noRead.prompt.includes('Use the read tool'));
  assert.ok(noRead.prompt.includes('web_search results are external'));
  assert.ok(preview.prompt.includes('helpful assistant'));
  assert.ok(!preview.sections.some(s => s.name === 'tool:edit'));
  console.log('PASS: read/edit/write separate cleanly and hidden prompt sections are removed');
  ctx.skills.register({ name: 'selected-skill', description: 'Selected', content: 'Skill body', source: 'test' });
  ctx.skills.register({ name: 'hidden-skill', description: 'Hidden', content: 'Do not show', source: 'test' });
  const updated = workshop.preset(p.id);
  await workshop.action({ action: 'save', id: p.id, revision: updated.revision, changes: { skills: ['selected-skill'] } });
  const lease = await ctx.agentPresets.acquireScope(p.id);
  try {
    const registry = workshop.scopes.get(lease.key).ctx.skills;
    assert.deepEqual((await registry.list({ scope: lease.key, cwd: home })).map(s => s.name), ['selected-skill']);
    assert.equal(await registry.get('hidden-skill', { scope: lease.key, cwd: home }), undefined);
  } finally { await lease[Symbol.asyncDispose](); }
  console.log('PASS: inherited skills are filtered by an isolated borrowed provider');
  await workshop.action({ action: 'create', id: 'disposable', name: 'Disposable' });
  const session = ctx.sessions.prepare('cold-test', { meta: { cwd: home, agentPreset: 'disposable' } });
  const handle = await ctx.sessionPersistence.create(session.header);
  await handle.flush(); await handle.close();
  const refs = await workshop.references('disposable'); assert.equal(refs.length, 1);
  const disposable = workshop.preset('disposable');
  await workshop.action({ action: 'delete', id: disposable.id, revision: disposable.revision, confirm: true });
  const reopened = await ctx.sessionPersistence.open('cold-test', 'read');
  try { assert.equal(selectedBinding(reopened.header, (await reopened.read()).events), p.id); }
  finally { await reopened.close(); }
  console.log('PASS: cold-session fallback persists, and deleted presets leave the roster');
  const agentKey = {};
  const agentScope = createScope(ctx, agentKey);
  try { await ctx.agentPresets.mount(agentScope.ctx, p.id); }
  finally { await agentScope.dispose(); }
  console.log('PASS: real scoped preset mount remains resolvable');

  const draft = await workshop.preview({ id: p.id, draft: { skills: ['hidden-skill'], prompt: { persona: 'Draft {{cwd}}', sections: { 'draft-section': { text: 'hidden draft text', order: 10, enabled: false, custom: true } } } } });
  assert.deepEqual(draft.skills.map(skill => skill.name), ['hidden-skill']);
  assert.ok(draft.editableSections.some(section => section.name === 'draft-section' && !section.enabled));
  assert.ok(!draft.prompt.includes('hidden draft text'));
  assert.deepEqual(workshop.preset(p.id).skills, ['selected-skill']);
  console.log('PASS: complete draft preview changes skills and retains disabled sections without saving');

  const sharedOverrides = Object.fromEntries(['job_list', 'todo_write'].map(name => {
    const schema = structuredClone(workshop.catalog.tools.find(tool => tool.name === name).schema);
    schema.function.description = 'CUSTOM ' + name;
    return [name, { schema }];
  }));
  const sharedDraft = { tools: { ...workshop.preset(p.id).tools, enabled: ['job_list', 'job_output', 'todo_write'], overrides: sharedOverrides } };
  const sharedPreview = await workshop.preview({ id: p.id, draft: sharedDraft });
  for (const name of ['job_list', 'todo_write']) {
    assert.equal(sharedPreview.tools.find(tool => tool.function.name === name).function.description, 'CUSTOM ' + name);
    assert.ok(!sharedPreview.prompt.includes('CUSTOM ' + name), 'schema description is separate from System instructions');
  }
  assert.ok(sharedPreview.sections.some(section => section.name === 'tool:jobs'));
  sharedOverrides.job_list.prompt = 'EXPLICIT JOB LIST';
  const explicitPreview = await workshop.preview({ id: p.id, draft: sharedDraft });
  assert.ok(explicitPreview.prompt.includes('EXPLICIT JOB LIST') && !explicitPreview.prompt.includes('CUSTOM job_list'));
  sharedOverrides.job_list.promptEnabled = false;
  const hiddenPreview = await workshop.preview({ id: p.id, draft: sharedDraft });
  assert.ok(!hiddenPreview.sections.some(section => section.name === 'tool:job_list'));
  assert.ok(!hiddenPreview.prompt.includes('CUSTOM todo_write'));
  console.log('PASS: official shared jobs and sectionless todo keep schema descriptions separate from System instructions');

  await workshop.action({ action: 'create', id: 'live-policy', name: 'Live policy' });
  const readSchema = structuredClone(workshop.catalog.tools.find(tool => tool.name === 'read').schema);
  readSchema.function.description = 'CUSTOM READ DESCRIPTION';
  const pathParameter = Object.keys(readSchema.function.parameters.properties)[0];
  readSchema.function.parameters.properties[pathParameter].description = 'CUSTOM PATH DESCRIPTION';
  let policy = workshop.preset('live-policy');
  await workshop.action({ action: 'save', id: policy.id, revision: policy.revision, changes: { tools: { ...policy.tools, enabled: ['read', 'skill'], overrides: { read: { schema: readSchema } } }, skills: ['selected-skill'], prompt: { persona: 'Live {{cwd}} {{model}}', sections: {} } } });
  const createAgent = (id, presetId, parent, cwd = workspace) => (parent?.ctx ?? ctx).agents.create({ sessionId: id, parentAgent: parent, meta: { cwd, agentPreset: presetId }, agentOptions: { provider: 'test', model: 'test-model' }, setup: async (agentCtx) => { if (parent) ctx.agentPresets.composeFrom(agentCtx, parent.ctx); else await ctx.agentPresets.mount(agentCtx, presetId); } });
  const attachAgent = workshop.attachAgent.bind(workshop);
  const failedLayers = ctx.tools.layers.scoped.size;
  workshop.attachAgent = async () => { throw Error('Injected agent/created failure'); };
  try { await assert.rejects(createAgent('failed-admission-session', policy.id), /Injected agent\/created failure/); }
  finally { workshop.attachAgent = attachAgent; }
  assert.equal(ctx.agents.get('failed-admission-session'), undefined);
  assert.equal(ctx.tools.layers.scoped.size, failedLayers);
  console.log('PASS: official serial agent/created dispatch contains listener rejection and rolls admission back');
  const live = await createAgent('live-policy-session', 'live-policy');
  const requests = [];
  class LocalAdapter extends LlmAdapter {
    async *stream(request) {
      requests.push(request);
      yield { type: 'text-delta', index: 0, text: 'local response' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['test'], new LocalAdapter());
  const agentErrors = [];
  ctx.on('agent/error', event => agentErrors.push(event.error));
  const eventsBeforePreview = live.agent.session.snapshotEvents().length, sessionsBeforePreview = ctx.sessions.list().length;
  const expected = await workshop.preview({ id: 'live-policy', sessionId: live.agent.id });
  assert.equal(live.agent.session.snapshotEvents().length, eventsBeforePreview);
  assert.equal(ctx.sessions.list().length, sessionsBeforePreview);
  const beforeSkillCatalog = await workshop.preview({ id: 'live-policy', draft: { tools: { ...workshop.preset('live-policy').tools, enabled: ['read'] } } });
  assert.ok(expected.skillPrompt.includes('<available_skills>'));
  assert.ok(expected.displayPrompt.includes('# SKILL\n\n' + expected.skillPrompt));
  assert.ok(expected.estimatedTokens > beforeSkillCatalog.estimatedTokens);
  assert.equal(beforeSkillCatalog.skillPrompt, '');
  live.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Local verification' }], source: { kind: 'user' } }));
  await live.agent.whenIdle();
  assert.equal(requests.length, 1, agentErrors.map(error => error?.stack).join('\n'));
  assert.deepEqual(requests[0].tools.map(tool => tool.name).sort(), ['read', 'skill']);
  assert.equal(requests[0].tools.find(tool => tool.name === 'read').description, 'CUSTOM READ DESCRIPTION');
  assert.equal(requests[0].tools.find(tool => tool.name === 'read').parameters.properties[pathParameter].description, 'CUSTOM PATH DESCRIPTION');
  assert.ok(requests[0].messages.some(message => message.role === 'system' && message.content.some(block => block.text === expected.prompt)));
  assert.ok(!expected.prompt.includes('CUSTOM READ DESCRIPTION') && !expected.prompt.includes('CUSTOM PATH DESCRIPTION'));
  const requestText = JSON.stringify(requests[0].messages);
  assert.ok(requestText.includes('selected-skill') && !requestText.includes('hidden-skill'));
  const actualSkillCatalog = live.agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog');
  assert.equal(actualSkillCatalog.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n'), expected.skillPrompt);
  assert.ok(expected.prompt.includes('Tokens prefixed with @'));
  const fileRefDraft = await workshop.preview({ id: policy.id, cwd: workspace, draft: { prompt: { ...policy.prompt, sections: { 'context:file-reference': { text: 'CUSTOM FILE REFERENCE', order: 910, enabled: true } } } } });
  assert.ok(fileRefDraft.prompt.includes('CUSTOM FILE REFERENCE') && !fileRefDraft.prompt.includes('Tokens prefixed with @'));
  console.log('PASS: real Agent request matches preview, schema descriptions and selected skill catalog (local adapter, no network)');

  live.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'PLUGIN USER INSTRUCTIONS' }], source: { kind: 'prompt-manager-catalog', form: 'instructions' } }), { surfaceOp: 'append' });
  const beforeInjectedPreview = live.agent.session.seq;
  const injectedPreview = await workshop.preview({ id: policy.id, sessionId: live.agent.id });
  assert.equal(injectedPreview.userSections.find(section => section.name === 'prompt-manager-catalog').text, 'PLUGIN USER INSTRUCTIONS');
  assert.equal(injectedPreview.userSections.find(section => section.name === 'prompt-manager-catalog').source, 'dsh-plugin-tool-management');
  assert.equal(injectedPreview.userSections.find(section => section.name === 'prompt-manager-catalog').editable, false);
  assert.ok(injectedPreview.displayPrompt.includes('PLUGIN USER INSTRUCTIONS'));
  assert.ok(!injectedPreview.prompt.includes('PLUGIN USER INSTRUCTIONS'));
  assert.equal(live.agent.session.seq, beforeInjectedPreview, 'preview must not rerun pre-step injection or append events');
  live.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'cleared' }], source: { kind: 'prompt-manager-catalog', form: 'notice' } }), { surfaceOp: 'append' });
  assert.ok(!(await workshop.preview({ id: policy.id, sessionId: live.agent.id })).userSections.some(section => section.name === 'prompt-manager-catalog'));
  assert.ok(!(await workshop.preview({ id: policy.id })).userSections.some(section => section.name === 'prompt-manager-catalog'));
  console.log('PASS: User prompt-manager instructions preview exact live surface text, clear notices and have no preview side effects');


  // Explicit preset bindings win over a source manager's invocation switch.
  const disabledSource = { name: 'manager-disabled', description: 'Explicitly selected but source-disabled', content: 'FULL DISABLED SOURCE BODY', source: 'manager', provider: 'review-disabled-source', invocation: { modelInvocable: false, userInvocable: false } };
  const removeDisabled = ctx.skills.registerProvider(() => ({ name: 'review-disabled-source', list: async () => ({ candidates: [{ ...disabledSource, provider: 'review-disabled-source', rank: 0, locator: disabledSource.name }], complete: false }), get: async () => disabledSource }));
  try {
    await workshop.action({ action: 'create', id: 'explicit-binding', name: 'Explicit binding' });
    let bound = workshop.preset('explicit-binding');
    await workshop.action({ action: 'save', id: bound.id, revision: bound.revision, changes: { tools: { ...bound.tools, enabled: ['read', 'skill'] }, skills: [disabledSource.name] } });
    const boundPreview = await workshop.preview({ id: bound.id, cwd: workspace });
    assert.ok(boundPreview.skillPrompt.includes(disabledSource.name));
    assert.ok(boundPreview.skillPrompt.includes(disabledSource.description));
    assert.ok(!boundPreview.skillPrompt.includes(disabledSource.content));
    assert.equal((await workshop.sourceSkills(workspace)).complete, false);
    const boundAgent = await createAgent('bound-session', bound.id);
    const askBound = async text => { boundAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await boundAgent.agent.whenIdle(); return requests.at(-1); };
    try {
      const actual = await askBound('Unique private user content never in preview');
      const skillCatalog = boundAgent.agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog');
      assert.equal(skillCatalog.data.content.map(block => block.text ?? '').join('\n\n'), boundPreview.skillPrompt);
      assert.ok(actual.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(disabledSource.name)));
      const skillTool = boundAgent.agent.ctx.tools.get('skill', boundAgent.agent);
      const loaded = await skillTool.execute({ name: disabledSource.name }, { agent: boundAgent.agent, signal: new AbortController().signal });
      assert.equal(loaded.content, disabledSource.content);
      const boundChild = await createAgent('bound-child', bound.id, boundAgent.agent);
      try {
        const childTool = boundChild.agent.ctx.tools.get('skill', boundChild.agent);
        assert.equal((await childTool.execute({ name: disabledSource.name }, { agent: boundChild.agent, signal: new AbortController().signal })).content, disabledSource.content);
        boundChild.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Child explicit skill verification' }], source: { kind: 'user' } })); await boundChild.agent.whenIdle();
        assert.ok(JSON.stringify(requests.at(-1).messages).includes(disabledSource.name));
      } finally { await boundChild.dispose(); }
      assert.deepEqual((await workshop.getSourceSkill(disabledSource.name, workspace)).invocation, { modelInvocable: false, userInvocable: false });
      assert.deepEqual(disabledSource.invocation, { modelInvocable: false, userInvocable: false });
      const safePreview = await workshop.preview({ id: bound.id, sessionId: boundAgent.agent.id });
      assert.ok(!safePreview.displayPrompt.includes('Unique private user content'));
      assert.ok(safePreview.displayPrompt.indexOf('# System') < safePreview.displayPrompt.indexOf('# TOOL'));
      assert.ok(safePreview.displayPrompt.indexOf('# TOOL') < safePreview.displayPrompt.indexOf('# User'));
      assert.ok(safePreview.displayPrompt.indexOf('# User') < safePreview.displayPrompt.indexOf('## 环境'));
      assert.ok(safePreview.displayPrompt.indexOf('## 环境') < safePreview.displayPrompt.indexOf('# SKILL'));
      const sandbox = await ctx.loader.root.tree.import('@deepseek-ai/dsh-sandbox-policy');
      const priorContextVersion = (await workshop.snapshot()).sessions.find(row => row.id === boundAgent.agent.id).contextVersion;
      sandbox.setSandboxMode(boundAgent.agent.session, 'danger-full-access');
      const full = await workshop.preview({ id: bound.id, sessionId: boundAgent.agent.id });
      assert.ok(full.runtimeContext.includes('danger-full-access'));
      assert.ok((await workshop.snapshot()).sessions.find(row => row.id === boundAgent.agent.id).contextVersion > priorContextVersion);
      sandbox.setSandboxMode(boundAgent.agent.session, 'read-only');
      const readOnly = await workshop.preview({ id: bound.id, sessionId: boundAgent.agent.id });
      assert.ok(readOnly.runtimeContext.includes('read-only') && readOnly.runtimeContext !== full.runtimeContext);
      const nextRequest = await askBound('Check changed runtime policy');
      assert.ok(nextRequest.messages.some(message => message.role === 'user' && message.content.some(block => block.text === readOnly.runtimeContext)));
      bound = workshop.preset(bound.id);
      await workshop.action({ action: 'save', id: bound.id, revision: bound.revision, changes: { skills: ['hidden-skill'] } });
      await askBound('Check changed binding on started Agent');
      const lastCatalog = boundAgent.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog').at(-1);
      assert.ok(JSON.stringify(lastCatalog.data).includes('hidden-skill') && !JSON.stringify(lastCatalog.data).includes(disabledSource.name));
      await assert.rejects(skillTool.execute({ name: disabledSource.name }, { agent: boundAgent.agent, signal: new AbortController().signal }), /unknown|no longer available/);
    } finally { await boundAgent.dispose(); }
  } finally { removeDisabled(); }
  console.log('PASS: explicit source-disabled skills publish exact catalogs and load in real Agents, incomplete unrelated discovery is tolerated, source remains unchanged, bindings and policy update live');

  // Original file text and provider runtime additions remain visibly distinct.
  const detailDir = join(workspace, 'skill-source'); await mkdir(detailDir);
  const detailPath = join(detailDir, 'SKILL.md'), originalBody = '# Actual source body\n\nOnly source instructions.';
  await writeFile(detailPath, '---\nname: detail-skill\ndescription: Detail source\n---\n\n' + originalBody + '\n');
  const detailSkill = { name: 'detail-skill', description: 'Detail source', content: originalBody + '\n\n## Runtime only\nProvider supplement', source: 'test', path: detailPath };
  const removeDetail = ctx.skills.register(detailSkill), removeMissing = ctx.skills.register({ name: 'missing-source', description: 'Missing source', source: 'test', path: join(detailDir, 'missing.md'), content: 'Provider fallback body' });
  try {
    const detail = await workshop.action({ action: 'skill', name: detailSkill.name, cwd: workspace });
    assert.equal(detail.content, originalBody);
    assert.equal(detail.runtimeContent, '## Runtime only\nProvider supplement');
    assert.equal(detail.bodySource, 'file'); assert.equal(detail.canOpen, undefined);
    await assert.rejects(workshop.action({ action: 'open-skill', name: detailSkill.name, cwd: workspace }), error => error.code === 'unknown-action');
    const missing = await workshop.action({ action: 'skill', name: 'missing-source', cwd: workspace });
    assert.equal(missing.content, 'Provider fallback body'); assert.equal(missing.bodySource, 'provider'); assert.ok(missing.fileError);
    assert.equal(await readFile(detailPath, 'utf8'), '---\nname: detail-skill\ndescription: Detail source\n---\n\n' + originalBody + '\n');
  } finally { removeDetail(); removeMissing(); }
  console.log('PASS: details separate untouched original bodies from runtime supplements; missing files report fallback and native open is removed');


  // Discover official packaged providers from another isolated preset, plus generic user and bundled filesystem roots.
  const officialAssets = join(workspace, 'official-assets');
  await mkdir(join(officialAssets, 'scripts'), { recursive: true }); await writeFile(join(officialAssets, 'scripts/check_office.py'), '# fixture only');
  for (const name of ['office', 'office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-recalculate', 'office-export-pdf']) { await mkdir(join(officialAssets, name)); await writeFile(join(officialAssets, name, 'SKILL.md'), '---\nname: ' + name + '\ndescription: Bundled ' + name + '\n---\nOFFICIAL ' + name); }
  const userSkills = join(workspace, 'user-skills'), genericBundle = join(workspace, 'generic-bundle');
  await mkdir(join(userSkills, 'office-docx'), { recursive: true }); await writeFile(join(userSkills, 'office-docx/SKILL.md'), '---\nname: office-docx\ndescription: User override\n---\nUSER OVERRIDE');
  await mkdir(join(genericBundle, 'generic-new-skill'), { recursive: true }); await writeFile(join(genericBundle, 'generic-new-skill/SKILL.md'), '---\nname: generic-new-skill\ndescription: Any bundled skill\n---\nGENERIC BUNDLED BODY');
  const filesystemModule = await ctx.loader.root.tree.import('@deepseek-ai/dsh-skill-filesystem');
  const fsSkills = ctx.plugin(filesystemModule, { includeDefaultRoots: false, customSkillDirs: [userSkills], bundledSkillDir: genericBundle }); await fsSkills.await();
  const removePackaged = await ctx.agentPresets.register({ id: 'packaged-official-source', plugins: [{ id: 'realm', name: 'cordis:group', group: true, isolate: { skills: true }, config: [{ id: 'registry', name: '@deepseek-ai/dsh-skill', config: {} }, { id: 'office', name: '@deepseek-ai/dsh-skill-office', config: { assetRoot: officialAssets, cli: false } }] }] });
  try {
    const discovered = await workshop.sourceSkills(workspace);
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx', 'generic-new-skill']) assert.ok(discovered.skills.some(skill => skill.name === name), name);
    assert.equal(discovered.skills.find(skill => skill.name === 'office-docx').description, 'User override');
    assert.equal((await workshop.getSourceSkill('office-docx', workspace)).content, 'USER OVERRIDE');
    const officialDetail = await workshop.skillDetail('office-pptx', workspace);
    assert.equal(officialDetail.content, 'OFFICIAL office-pptx');
    const officeHasOperations = discovered.skills.some(skill => skill.name === 'office-render');
    assert.ok(officeHasOperations ? !officialDetail.runtimeContent : officialDetail.runtimeContent.includes('LibreOffice Kit is disabled'));
    if (officeHasOperations) assert.ok((await workshop.skillDetail('office-render', workspace)).runtimeContent.includes('LibreOffice Kit is disabled'));
    assert.equal(officialDetail.path, join(officialAssets, 'office-pptx', 'SKILL.md'));
    const newBundled = await workshop.skillDetail('generic-new-skill', workspace); assert.equal(newBundled.content, 'GENERIC BUNDLED BODY');

    const scopedSkills = join(workspace, 'native-scoped-skills'); await mkdir(join(scopedSkills, 'office-xlsx'), { recursive: true }); await writeFile(join(scopedSkills, 'office-xlsx/SKILL.md'), '---\nname: office-xlsx\ndescription: Native scoped override\n---\nSCOPED OVERRIDE BODY');
    const officeModule = await ctx.loader.root.tree.import('@deepseek-ai/dsh-skill-office');
    const globalOffice = ctx.plugin(officeModule, { assetRoot: officialAssets, cli: false }); await globalOffice.await();
    const removeScoped = await ctx.agentPresets.register({ id: 'shared-native-skill-source', plugins: [{ id: 'filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { includeDefaultRoots: false, customSkillDirs: [scopedSkills] } }] });
    try {
      assert.equal((await ctx.skills.list({ cwd: workspace })).find(skill => skill.name === 'office-xlsx').description, 'Bundled office-xlsx');
      assert.equal((await workshop.sourceSkills(workspace)).skills.find(skill => skill.name === 'office-xlsx').description, 'Native scoped override');
      assert.equal((await workshop.getSourceSkill('office-xlsx', workspace)).content, 'SCOPED OVERRIDE BODY');
      const scopedDetail = await workshop.skillDetail('office-xlsx', workspace); assert.equal(await realpath(scopedDetail.path), await realpath(join(scopedSkills, 'office-xlsx/SKILL.md'))); assert.equal(scopedDetail.content, 'SCOPED OVERRIDE BODY');
      const scopedPreview = await workshop.preview({ id: p.id, cwd: workspace, draft: { skills: ['office-xlsx'], tools: { ...workshop.preset(p.id).tools, enabled: ['skill'] } } });
      assert.ok(scopedPreview.skillPrompt.includes('Native scoped override') && !scopedPreview.skillPrompt.includes('Bundled office-xlsx'));
      await workshop.action({ action: 'create', id: 'scoped-winner', name: 'Scoped winner' }); const winner = workshop.preset('scoped-winner');
      await workshop.action({ action: 'save', id: winner.id, revision: winner.revision, changes: { skills: ['office-xlsx'], tools: { ...winner.tools, enabled: ['skill'] } } });
      const winnerAgent = await createAgent('scoped-winner-session', winner.id);
      try {
        const loaded = await winnerAgent.agent.ctx.tools.get('skill', winnerAgent.agent).execute({ name: 'office-xlsx' }, { agent: winnerAgent.agent, signal: new AbortController().signal }); assert.equal(loaded.content, 'SCOPED OVERRIDE BODY');
        winnerAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Same-name scoped winner request' }], source: { kind: 'user' } })); await winnerAgent.agent.whenIdle();
        assert.ok(JSON.stringify(requests.at(-1).messages).includes('Native scoped override') && !JSON.stringify(requests.at(-1).messages).includes('Bundled office-xlsx'));
      } finally { await winnerAgent.dispose(); }
    } finally { await removeScoped(); await globalOffice.dispose(); }

    const officialPreview = await workshop.preview({ id: p.id, cwd: workspace, draft: { skills: ['office-pptx', 'generic-new-skill'], tools: { ...workshop.preset(p.id).tools, enabled: ['skill'] } } });
    assert.ok(officialPreview.skillPrompt.includes('office-pptx') && officialPreview.skillPrompt.includes('generic-new-skill'));
  } finally { await removePackaged(); await fsSkills.dispose(); }
  console.log('PASS: actual official isolated-preset provider and generic user/bundled filesystem roots are discovered; global same-name user override wins and runtime additions stay separate');

  // Custom System content round-trips, orders and updates without touching sources.
  await workshop.action({ action: 'create', id: 'custom-system', name: 'Custom system' });
  let custom = workshop.preset('custom-system');
  await workshop.action({ action: 'save', id: custom.id, revision: custom.revision, changes: { prompt: { persona: 'CUSTOM PERSONA', sections: { 'custom:after': { text: 'AFTER CUSTOM', order: 500, enabled: true, custom: true }, 'custom:before': { text: 'BEFORE CUSTOM {{cwd}}', order: 100, enabled: true, custom: true } } } } });
  const customPreview = await workshop.preview({ id: custom.id, cwd: workspace });
  assert.ok(customPreview.prompt.indexOf('BEFORE CUSTOM ' + workspace) < customPreview.prompt.indexOf('AFTER CUSTOM'));
  assert.ok(customPreview.editableSections.some(row => row.name === 'custom:before' && row.custom && row.editable && row.reorderable));
  const customExport = await workshop.action({ action: 'export', id: custom.id, format: 'json' });
  await workshop.action({ action: 'import', mode: 'rename', format: 'json', text: customExport.text, renames: [{ index: 0, id: 'custom-system-copy', name: 'Custom copy' }] });
  assert.deepEqual(workshop.preset('custom-system-copy').prompt, workshop.preset(custom.id).prompt);
  custom = workshop.preset(custom.id); const modifiedCustom = structuredClone(custom.prompt); delete modifiedCustom.sections['custom:after']; modifiedCustom.sections['custom:before'].enabled = false;
  const disabledCustomDraft = await workshop.preview({ id: custom.id, cwd: workspace, draft: { prompt: modifiedCustom } });
  assert.ok(!disabledCustomDraft.prompt.includes('BEFORE CUSTOM') && !disabledCustomDraft.prompt.includes('AFTER CUSTOM'));
  assert.ok(workshop.preset(custom.id).prompt.sections['custom:after']);
  await workshop.action({ action: 'save', id: custom.id, revision: custom.revision, changes: { prompt: modifiedCustom } });
  assert.ok(!workshop.preset(custom.id).prompt.sections['custom:after']);
  const customAgent = await createAgent('custom-system-session', custom.id);
  try {
    customAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Custom System request' }], source: { kind: 'user' } })); await customAgent.agent.whenIdle();
    assert.ok(requests.at(-1).messages.some(message => message.role === 'system' && message.content.some(block => block.text === (disabledCustomDraft.prompt))));
    custom = workshop.preset(custom.id);
    await workshop.action({ action: 'save', id: custom.id, revision: custom.revision, changes: { prompt: { ...custom.prompt, sections: { 'custom:before': { text: 'LIVE CUSTOM CHANGE', order: 950, enabled: true, custom: true }, 'context:file-reference': { text: 'LIVE FILE REFERENCE OVERRIDE', order: 940, enabled: true } } } } });
    const changedCustom = await workshop.preview({ id: custom.id, cwd: workspace });
    customAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Custom System updated request' }], source: { kind: 'user' } })); await customAgent.agent.whenIdle();
    assert.ok(requests.at(-1).messages.some(message => message.role === 'system' && message.content.some(block => block.text === changedCustom.prompt)));
    assert.ok(changedCustom.prompt.includes('LIVE FILE REFERENCE OVERRIDE') && !changedCustom.prompt.includes('Tokens prefixed with @'));
  } finally { await customAgent.dispose(); }
  console.log('PASS: custom System content supports variables, order, preview-only cancel, delete, disable, save and export/import');

  await writeFile(join(home, 'AGENTS.md'), 'NATIVE GLOBAL INSTRUCTIONS');
  await writeFile(join(workspace, 'AGENTS.md'), 'NATIVE DIRECTORY INSTRUCTIONS');
  const sourceA = ctx.systemPrompt.section({ name: 'example:first', order: 50, text: 'FIRST PLUGIN INJECTION' });
  const sourceB = ctx.systemPrompt.section({ name: 'example:second', order: 60, text: 'SECOND PLUGIN INJECTION' });
  const metadata = ctx.systemPrompt.section({ name: 'harness:source', order: 10000, text: 'HOST METADATA' });
  const webSurface = ctx.systemPrompt.section({ name: 'app:web-surface', order: 10001, text: 'WEB SURFACE METADATA' });
  const emptySource = ctx.systemPrompt.section({ name: 'test:empty-source', order: 99, text: '' });
  try {
    await workshop.action({ action: 'create', id: 'context-policy', name: 'Context policy' });
    const native = await workshop.preview({ id: 'context-policy', cwd: workspace });
    assert.ok(native.agentInstructions.text.includes('NATIVE GLOBAL INSTRUCTIONS'));
    assert.ok(native.agentInstructions.directoryText.includes('NATIVE DIRECTORY INSTRUCTIONS'));
    assert.ok(!native.prompt.includes('NATIVE GLOBAL INSTRUCTIONS'));
    assert.ok(!native.agentInstructions.text.includes('NATIVE DIRECTORY INSTRUCTIONS'));
    const contextPolicy = workshop.preset('context-policy');
    await workshop.action({ action: 'save', id: contextPolicy.id, revision: contextPolicy.revision, changes: {
      tools: { ...contextPolicy.tools, enabled: ['read', 'skill'] }, skills: ['selected-skill'],
      prompt: { persona: 'Context persona', sections: {
        'example:first': { text: 'EDITED FIRST', order: 200, enabled: true },
        'example:second': { text: 'EDITED SECOND', order: 100, enabled: true },
        [AGENT_SECTION]: { text: 'PRESET WORKSPACE OVERRIDE', order: 0, enabled: true },
      } },
    } });
    const contextPreview = await workshop.preview({ id: contextPolicy.id, cwd: workspace });
    for (const name of ['harness:source', 'app:web-surface', ...(!ctx.get('workingDirectory') ? ['deployment:persona-suffix'] : [])]) {
      const section = contextPreview.editableSections.find(section => section.name === name);
      assert.ok(section && section.editable && section.reorderable && !section.managedBy, name);
    }
    assert.ok(!contextPreview.editableSections.some(section => section.name === 'test:empty-source'));
    assert.ok(contextPreview.prompt.includes('HOST METADATA'));
    if (ctx.get('workingDirectory')) { assert.ok(contextPreview.runtimeContext.includes(workspace)); assert.ok(!contextPreview.prompt.includes('Your working directory is ')); }
    else assert.ok(contextPreview.prompt.includes('Your working directory is ' + workspace + '.'));
    assert.ok(!contextPreview.personaSections.some(section => section.name === 'deployment:persona-suffix'));
    assert.ok(contextPreview.prompt.indexOf('EDITED SECOND') < contextPreview.prompt.indexOf('EDITED FIRST'));
    assert.ok(contextPreview.displayPrompt.indexOf('# SKILL') < contextPreview.displayPrompt.indexOf('## AGENTS（全局级）'));
    assert.ok(contextPreview.displayPrompt.indexOf('## AGENTS（全局级）') < contextPreview.displayPrompt.indexOf('## AGENTS（目录级）'));
    assert.ok(contextPreview.displayPrompt.indexOf('# TOOL') < contextPreview.displayPrompt.indexOf('# User') && contextPreview.displayPrompt.indexOf('# User') < contextPreview.displayPrompt.indexOf('# SKILL'));
    assert.ok(contextPreview.displayPrompt.includes('read：'));
    assert.ok(!contextPreview.prompt.includes('PRESET WORKSPACE OVERRIDE'));
    const contextAgent = await createAgent('context-policy-session', contextPolicy.id);
    try {
      contextAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check workspace override' }], source: { kind: 'user' } }));
      await contextAgent.agent.whenIdle();
      const actual = requests.at(-1);
      assert.ok(actual.messages.some(message => message.role === 'user' && message.content.some(block => block.text?.includes('PRESET WORKSPACE OVERRIDE'))));
      assert.ok(!JSON.stringify(actual.messages).includes('NATIVE GLOBAL INSTRUCTIONS'));
      assert.ok(JSON.stringify(actual.messages).includes('NATIVE DIRECTORY INSTRUCTIONS'));
      assert.ok(contextAgent.agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'preset-workshop-global-instructions'));
      assert.ok(actual.messages.some(message => message.role === 'system' && message.content.some(block => block.text === contextPreview.prompt)));
      const ask = async text => {
        contextAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
        await contextAgent.agent.whenIdle();
        return requests.at(-1);
      };
      const metadataPolicy = workshop.preset(contextPolicy.id);
      await workshop.action({ action: 'save', id: metadataPolicy.id, revision: metadataPolicy.revision, changes: { prompt: { ...metadataPolicy.prompt, sections: { ...metadataPolicy.prompt.sections,
        'harness:source': { text: 'REMOVED HOST METADATA', order: 100, enabled: false },
        'app:web-surface': { text: 'EDITED WEB SURFACE', order: 150, enabled: true },
        'deployment:persona-suffix': { text: 'EDITED CWD {{cwd}}', order: 120, enabled: true },
      } } } });
      const editedMetadata = await workshop.preview({ id: contextPolicy.id, cwd: workspace });
      assert.ok(!editedMetadata.prompt.includes('HOST METADATA'));
      assert.ok(editedMetadata.prompt.indexOf('EDITED CWD') < editedMetadata.prompt.indexOf('EDITED WEB SURFACE'));
      const editedRequest = await ask('Check edited host sections in begun session');
      assert.ok(editedRequest.messages.some(message => message.role === 'system' && message.content.some(block => block.text === editedMetadata.prompt)));
      const freshMetadata = await createAgent('metadata-new-session', contextPolicy.id);
      try {
        freshMetadata.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check metadata in fresh request' }], source: { kind: 'user' } }));
        await freshMetadata.agent.whenIdle();
        assert.ok(requests.at(-1).messages.some(message => message.role === 'system' && message.content.some(block => block.text === editedMetadata.prompt)));
      } finally { await freshMetadata.dispose(); }
      const setAgent = async (text, enabled) => {
        const preset = workshop.preset(contextPolicy.id);
        await workshop.action({ action: 'save', id: preset.id, revision: preset.revision, changes: { prompt: { ...preset.prompt, sections: { ...preset.prompt.sections, [AGENT_SECTION]: { text, enabled, order: 0 } } } } });
      };
      await setAgent('UPDATED WORKSPACE BASELINE', true);
      const changed = await ask('Verify AGENT update');
      assert.ok(changed.messages.some(message => message.role === 'user' && message.content.some(block => block.text?.includes('# AGENT update') && block.text.includes('UPDATED WORKSPACE BASELINE'))));
      const updates = () => contextAgent.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.workshopOverride);
      const updateCount = updates().length;
      await ask('Verify unchanged baseline is not duplicated');
      assert.equal(updates().length, updateCount);
      await setAgent('UPDATED WORKSPACE BASELINE', false);
      const disabled = await ask('Verify disabled workspace instructions');
      assert.ok(disabled.messages.some(message => message.role === 'user' && message.content.some(block => block.text?.includes('AGENT workspace instructions are now disabled'))));
      await writeFile(join(workspace, 'AGENTS.md'), 'CHANGED DIRECTORY INSTRUCTIONS WHILE GLOBAL DISABLED');
      const changedDirectory = await ask('Verify directory baseline updates while global is disabled');
      assert.ok(JSON.stringify(changedDirectory.messages).includes('CHANGED DIRECTORY INSTRUCTIONS WHILE GLOBAL DISABLED'));
      const restoredPolicy = workshop.preset(contextPolicy.id);
      const restoredSections = { ...restoredPolicy.prompt.sections }; delete restoredSections[AGENT_SECTION];
      await workshop.action({ action: 'save', id: restoredPolicy.id, revision: restoredPolicy.revision, changes: { prompt: { ...restoredPolicy.prompt, sections: restoredSections } } });
      const restored = await ask('Verify native baseline restores');
      assert.ok(restored.messages.some(message => message.role === 'user' && message.content.some(block => block.text?.includes('# AGENT update') && block.text.includes('NATIVE GLOBAL INSTRUCTIONS'))));
      contextAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'NATIVE SUBDIRECTORY UPDATE' }], source: { kind: 'agent-instructions', form: 'instructions', changes: [] } }));
      await contextAgent.agent.whenIdle();
      assert.ok(JSON.stringify(requests.at(-1).messages).includes('NATIVE SUBDIRECTORY UPDATE'));
      const beforeHeavy = workshop.preset(contextPolicy.id);
      await workshop.action({ action: 'save', id: beforeHeavy.id, revision: beforeHeavy.revision, changes: { tools: { ...beforeHeavy.tools, packages: ['@deepseek-ai/dsh-tool-str-replace-editor'] } } });
      const heavyPreview = await workshop.preview({ id: beforeHeavy.id, sessionId: contextAgent.agent.id });
      assert.ok(heavyPreview.tools.some(tool => tool.function.name === 'str_replace_editor'));
      assert.ok(!heavyPreview.runtime.tools.some(tool => tool.function.name === 'str_replace_editor'));
      assert.ok(heavyPreview.runtime.pendingTools.includes('str_replace_editor'));
      assert.ok((await workshop.snapshot()).sessions.find(session => session.id === contextAgent.agent.id).pendingTools.includes('str_replace_editor'));
      const heavyRequest = await ask('Verify request accurately reports unavailable new composition');
      assert.ok(!heavyRequest.tools.some(tool => tool.name === 'str_replace_editor'));
      const fresh = await createAgent('context-heavy-new-session', contextPolicy.id);
      try { assert.ok(ctx.tools.schemas(fresh.agent).some(tool => tool.name === 'str_replace_editor')); }
      finally { await fresh.dispose(); }
      console.log('PASS: started AGENT baselines update/disable/restore without duplicating history; new heavy tools report pending while fresh scopes mount them');
    } finally { await contextAgent.dispose(); }
    assert.equal(await readFile(join(home, 'AGENTS.md'), 'utf8'), 'NATIVE GLOBAL INSTRUCTIONS');
    assert.equal(await readFile(join(workspace, 'AGENTS.md'), 'utf8'), 'CHANGED DIRECTORY INSTRUCTIONS WHILE GLOBAL DISABLED');
    await workshop.action({ action: 'create', id: 'global-boundary', name: 'Global boundary' });
    const boundary = workshop.preset('global-boundary');
    const boundaryNative = await workshop.preview({ id: boundary.id, cwd: home });
    assert.equal((boundaryNative.displayPrompt.match(/NATIVE GLOBAL INSTRUCTIONS/g) || []).length, 1);
    await workshop.action({ action: 'save', id: boundary.id, revision: boundary.revision, changes: { prompt: { ...boundary.prompt, sections: { [AGENT_SECTION]: { text: 'DISABLED GLOBAL', order: 0, enabled: false } } } } });
    const boundaryPreview = await workshop.preview({ id: boundary.id, cwd: home });
    assert.ok(!boundaryPreview.displayPrompt.includes('NATIVE GLOBAL INSTRUCTIONS'));
    assert.ok(!boundaryPreview.agentInstructions.directoryText.includes('NATIVE GLOBAL INSTRUCTIONS'));
    const boundaryAgent = await createAgent('global-boundary-session', boundary.id, undefined, home);
    try {
      boundaryAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check disabled global file with cwd equal to DSH_HOME' }], source: { kind: 'user' } }));
      await boundaryAgent.agent.whenIdle();
      assert.ok(!JSON.stringify(requests.at(-1).messages).includes('NATIVE GLOBAL INSTRUCTIONS'));
    } finally { await boundaryAgent.dispose(); }
    console.log('PASS: the official global file has one authority and remains disabled when cwd equals DSH_HOME');
    const scan = await workshop.action({ action: 'scan', id: contextPolicy.id, cwd: home });
    assert.equal(scan.catalog.counts.promptSections, (await workshop.preview({ id: contextPolicy.id, cwd: home })).editableSections.filter(section => !section.managedBy).length);
    assert.ok(scan.catalog.counts.skills >= 2);
    console.log('PASS: multiple plugin sections reorder in real requests; AGENT remains user context, overrides preserve files, and scan refreshes all sources');
  } finally { sourceA(); sourceB(); metadata(); webSurface(); emptySource(); await rm(join(home, 'AGENTS.md')); await rm(join(workspace, 'AGENTS.md')); }

  policy = workshop.preset('live-policy');
  await workshop.action({ action: 'save', id: policy.id, revision: policy.revision, changes: { tools: { ...policy.tools, enabled: ['edit'] }, skills: ['hidden-skill'], prompt: { persona: 'New revision', sections: {} } } });
  await workshop.attachAgent(live.agent);
  assert.deepEqual(ctx.tools.schemas(live.agent).map(tool => tool.name).sort(), ['edit']);
  const oldAssembly = await ctx.systemPrompt.assemble({ scope: live.agent, agent: live.agent });
  assert.ok(workshop.renderPrompt(oldAssembly).startsWith('New revision'));
  live.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Verify updated policy on the next request' }], source: { kind: 'user' } }));
  await live.agent.whenIdle();
  assert.deepEqual(requests.at(-1).tools.map(tool => tool.name), ['edit']);
  assert.ok(requests.at(-1).messages.some(message => message.role === 'system' && message.content.some(block => block.text?.startsWith('New revision'))));
  const descendantKey = {};
  const descendant = createScope(live.agent.ctx, descendantKey, { parent: live.agent });
  try {
    const assembly = await ctx.systemPrompt.assemble({ scope: descendantKey, agent: live.agent });
    assert.deepEqual(assembly.tools.map(tool => tool.name).sort(), ['edit']);
    assert.ok(workshop.renderPrompt(assembly).startsWith('New revision'));
  } finally { await descendant.dispose(); }
  const child = await createAgent('child-policy-session', 'live-policy', live.agent);
  assert.deepEqual(ctx.tools.schemas(child.agent).map(tool => tool.name).sort(), ['edit']);
  const childRegistry = ctx.agentPresets.serviceFor(child.agent, 'skills');
  assert.deepEqual((await childRegistry.list({ scope: child.agent, cwd: home })).map(skill => skill.name), ['hidden-skill']);
  await workshop.action({ action: 'delete', id: policy.id, revision: workshop.preset(policy.id).revision, confirm: true });
  await workshop.attachAgent(live.agent);
  assert.equal(ctx.sessionProjections.stateOf(live.agent.session, 'agentPreset'), 'preset_workshop');
  assert.equal(ctx.agentPresets.composedPreset(live.agent.ctx), 'live-policy');
  assert.deepEqual(ctx.tools.schemas(live.agent).map(tool => tool.name).sort(), ['read']);
  assert.ok(!(await ctx.agentPresets.list()).some(row => row.id === 'live-policy'));
  const postDeleteChild = await createAgent('post-delete-child', 'live-policy', live.agent);
  try { assert.equal(selectedBinding(postDeleteChild.agent.session.header, postDeleteChild.agent.session.snapshotEvents()), p.id); }
  finally { await postDeleteChild.dispose(); }
  await child.dispose(); await live.dispose();
  console.log('PASS: started Agents and children use edited tools/prompts/skills on their next request; removal drops stale allow lists and persists fallback for new descendants');

  const blank = await createAgent('blank-policy-session', 'preset_workshop');
  const otherRestriction = blank.agent.ctx.tools.restrict({ deny: ['read'] });
  const current = workshop.preset(p.id);
  await workshop.action({ action: 'save', id: p.id, revision: current.revision, changes: { tools: { ...current.tools, enabled: ['read', 'edit'] } } });
  assert.deepEqual(ctx.tools.schemas(blank.agent).map(tool => tool.name), ['edit']);
  otherRestriction();
  await workshop.attachAgent(blank.agent);
  assert.deepEqual(ctx.tools.schemas(blank.agent).map(tool => tool.name).sort(), ['edit', 'read']);
  await workshop.action({ action: 'create', id: 'apply-target', name: 'Apply target' });
  await workshop.action({ action: 'apply', id: 'apply-target', sessionId: blank.agent.id });
  assert.equal(ctx.agentPresets.composedPreset(blank.agent.ctx), 'apply-target');
  blank.agent.session.append('turn/start', { turn: 1 });
  await assert.rejects(workshop.action({ action: 'apply', id: p.id, sessionId: blank.agent.id }), error => error.code === 'agent-preset/locked');
  await blank.dispose();
  console.log('PASS: blank updates preserve other restriction layers; apply persists and rejects begun sessions');

  await workshop.action({ action: 'create', id: 'writer-locked', name: 'Writer locked' });
  const lockedSession = ctx.sessions.prepare('writer-locked-session', { meta: { cwd: home, agentPreset: 'writer-locked' } });
  const lockedHandle = await ctx.sessionPersistence.create(lockedSession.header);
  await lockedHandle.flush();
  const lockedPreset = workshop.preset('writer-locked');
  await assert.rejects(workshop.action({ action: 'delete', id: lockedPreset.id, revision: lockedPreset.revision, confirm: true }));
  assert.equal(workshop.preset(lockedPreset.id).enabled, true);
  assert.ok((await ctx.agentPresets.list()).some(row => row.id === lockedPreset.id && !row.broken));
  await lockedHandle.close();
  await workshop.action({ action: 'delete', id: lockedPreset.id, revision: lockedPreset.revision, confirm: true });
  console.log('PASS: cold writer contention aborts deletion, preserving registration; retry succeeds');

  const revision = workshop.preset(p.id).revision;
  const concurrent = await Promise.allSettled(['A', 'B'].map(description => workshop.action({ action: 'save', id: p.id, revision, changes: { description } })));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'revision-conflict');
  const exported = await workshop.action({ action: 'export', id: p.id, format: 'yaml' });
  await workshop.action({ action: 'import', mode: 'new', format: 'yaml', text: exported.text, newId: 'yaml-copy', newName: 'YAML copy' });
  const copied = workshop.preset('yaml-copy');
  assert.equal(copied.builtin, false);
  const selectedExport = await workshop.action({ action: 'export', ids: [p.id, copied.id], format: 'json' });
  assert.deepEqual(JSON.parse(selectedExport.text).presets.map(preset => preset.id), [p.id, copied.id]);
  assert.equal(workshop.store.state.config.maxPresets, undefined);
  await workshop.action({ action: 'import', mode: 'new', format: 'yaml', text: exported.text, newId: 'without-limit', newName: 'Without limit' });
  assert.ok(workshop.preset('without-limit'));
  const beforeBroken = structuredClone(workshop.preset(p.id));
  await assert.rejects(workshop.action({ action: 'save', id: p.id, revision: beforeBroken.revision, changes: { tools: { ...beforeBroken.tools, packages: ['@deepseek-ai/dsh-tool-workflow'] } } }));
  assert.deepEqual(workshop.preset(p.id), beforeBroken);
  assert.ok(!(await ctx.agentPresets.resolve(p.id)).broken);
  console.log('PASS: concurrent revisions, YAML import without preset limits, and broken-composition rollback');
  const conflictText = (await workshop.action({ action: 'export', id: p.id, format: 'json' })).text;
  await assert.rejects(workshop.action({ action: 'import', mode: 'new', format: 'json', text: conflictText }), error => error.code === 'import-conflict' && error.details.conflicts[0].matches[0].id === p.id);
  await workshop.action({ action: 'import', mode: 'rename', format: 'json', text: conflictText, renames: [{ index: 0, id: 'conflict-copy', name: 'Conflict copy' }] });
  const copyText = (await workshop.action({ action: 'export', id: 'conflict-copy', format: 'json' })).text;
  const copyRevision = workshop.preset('conflict-copy').revision;
  await assert.rejects(workshop.action({ action: 'import', mode: 'overwrite', format: 'json', text: copyText, revisions: { 'conflict-copy': copyRevision - 1 } }), error => error.code === 'revision-conflict');
  await workshop.action({ action: 'import', mode: 'overwrite', format: 'json', text: copyText, revisions: { 'conflict-copy': copyRevision } });
  assert.equal(workshop.preset('conflict-copy').revision, copyRevision + 1);
  console.log('PASS: import conflicts preserve existing data until explicit revision-checked overwrite or rename');

  await assert.rejects(workshop.action({ action: 'save', id: p.id, revision: beforeBroken.revision, changes: { prompt: { persona: '{{missing_variable}}', sections: {} } } }), /unknown prompt variable/);
  assert.deepEqual(workshop.preset(p.id), beforeBroken);
  const publish = workshop.store.publish.bind(workshop.store);
  let failWrite = true;
  workshop.store.publish = async state => {
    if (failWrite) {
      failWrite = false;
      await atomicJSON(join(workshop.store.root, 'presets', p.id, 'prompt.json'), state.presets.find(preset => preset.id === p.id).prompt);
      throw new Error('Injected partial write failure');
    }
    return publish(state);
  };
  try { await assert.rejects(workshop.action({ action: 'save', id: p.id, revision: beforeBroken.revision, changes: { prompt: { persona: 'Uncommitted prompt', sections: {} } } }), /partial write failure/); }
  finally { workshop.store.publish = publish; }
  assert.deepEqual(workshop.preset(p.id), beforeBroken);
  const restored = new WorkshopStore(workshop.store.root); await restored.init();
  assert.deepEqual(restored.state.presets.find(preset => preset.id === p.id), beforeBroken);
  assert.equal((await workshop.preview({ id: p.id })).prompt, (await workshop.preview({ id: p.id, draft: beforeBroken })).prompt);
  console.log('PASS: unknown variables and partial file-write failures restore both usable registration and restart data');

  const retainedCopy = structuredClone(workshop.preset('yaml-copy'));
  let failDelete = true;
  workshop.store.publish = async state => {
    if (failDelete) { failDelete = false; await rm(join(workshop.store.root, 'presets', retainedCopy.id), { recursive: true }); throw new Error('Injected deletion write failure'); }
    return publish(state);
  };
  try { await assert.rejects(workshop.action({ action: 'delete', id: retainedCopy.id, revision: retainedCopy.revision }), /deletion write failure/); }
  finally { workshop.store.publish = publish; }
  const afterDeleteFailure = new WorkshopStore(workshop.store.root); await afterDeleteFailure.init();
  assert.deepEqual(workshop.preset(retainedCopy.id), retainedCopy);
  assert.deepEqual(afterDeleteFailure.state.presets.find(preset => preset.id === retainedCopy.id), retainedCopy);
  assert.ok((await ctx.agentPresets.list()).some(row => row.id === retainedCopy.id && !row.broken));

  const importedA = { ...structuredClone(beforeBroken), id: 'import-a', name: 'Import A', builtin: false };
  const importedB = { ...structuredClone(beforeBroken), id: 'import-b', name: 'Import B', builtin: false, tools: { ...beforeBroken.tools, packages: ['@deepseek-ai/dsh-tool-workflow'] } };
  await assert.rejects(workshop.action({ action: 'import', mode: 'new', format: 'json', text: JSON.stringify({ format: 'dsh-preset-workshop', version: 1, presets: [importedA, importedB] }) }));
  assert.ok(!workshop.store.state.presets.some(preset => ['import-a', 'import-b'].includes(preset.id)));
  assert.ok(!(await ctx.agentPresets.list()).some(row => ['import-a', 'import-b'].includes(row.id)));
  console.log('PASS: a failed bulk import leaves neither partial configuration nor partial roster entries');

  const removeSkill = ctx.skills.register({ name: 'cache-skill', description: 'Cache invalidation check', content: 'temporary', source: 'test' });
  await workshop.action({ action: 'save', id: p.id, revision: workshop.preset(p.id).revision, changes: { skills: ['cache-skill'] } });
  const cachedLease = await ctx.agentPresets.acquireScope(p.id);
  try {
    const registry = workshop.scopes.get(cachedLease.key).ctx.skills;
    assert.deepEqual((await registry.list({ scope: cachedLease.key, cwd: home })).map(skill => skill.name), ['cache-skill']);
    removeSkill();
    assert.deepEqual(await registry.list({ scope: cachedLease.key, cwd: home }), []);
  } finally { await cachedLease[Symbol.asyncDispose](); }
  const removeSource = await ctx.agentPresets.register({ id: 'external-skills', plugins: [{ id: 'realm', name: 'cordis:group', group: true, isolate: { skills: true }, config: [{ id: 'registry', name: '@deepseek-ai/dsh-skill', config: {} }] }] });
  try {
    const beforeExternal = await workshop.snapshot();
    await workshop.withSourceRegistry('external-skills', async registry => registry.register({ name: 'isolated-source-skill', description: 'Isolated source', content: 'body', source: 'test' }));
    const afterExternal = await workshop.snapshot();
    assert.notEqual(afterExternal.sourcesVersion, beforeExternal.sourcesVersion);
    await workshop.preview({ id: p.id, draft: { skills: ['isolated-source-skill'] } });
    assert.equal((await workshop.snapshot()).sourcesVersion, afterExternal.sourcesVersion);
    assert.ok((await workshop.sourceSkills(home)).skills.some(skill => skill.name === 'isolated-source-skill'));
    assert.equal((await workshop.getSourceSkill('isolated-source-skill', home)).content, 'body');
  } finally { await removeSource(); }
  console.log('PASS: borrowed skill caches invalidate on source changes and discover another preset\'s isolated registry');

  const heavy = await workshop.preview({ id: p.id, draft: { tools: { ...beforeBroken.tools, packages: ['@deepseek-ai/dsh-tool-str-replace-editor', '@deepseek-ai/dsh-tool-goal'] } } });
  assert.ok(heavy.tools.some(tool => tool.function.name === 'str_replace_editor'));
  const heavyTools = workshop.catalog.tools.filter(tool => !tool.light && heavy.tools.some(schema => schema.function.name === tool.name));
  assert.ok(heavyTools.some(tool => tool.package === '@deepseek-ai/dsh-tool-str-replace-editor'));
  assert.ok(heavyTools.some(tool => tool.package === '@deepseek-ai/dsh-tool-goal'));
  assert.ok(!(await workshop.preview({ id: p.id })).tools.some(tool => tool.function.name === 'str_replace_editor'));
  console.log('PASS: two selected official heavy packages are attributed independently and absent from saved preview');

  const subagentPackage = workshop.catalog.packages.find(pkg => pkg.name === '@deepseek-ai/dsh-tool-subagent');
  await ctx.loader.root.update([...ctx.loader.root.data, { id: 'light-variant-source', name: '@deepseek-ai/dsh-agent-preset', disabled: true, config: { id: 'unused-light-source', plugins: [{ id: 'variant-group', name: 'cordis:group', group: true, config: [{ ...structuredClone(subagentPackage.row), id: 'variant', config: { ...subagentPackage.row.config, toolName: 'discovered_subagent' } }] }] } }]);
  await workshop.action({ action: 'scan' });
  const variantLease = await ctx.agentPresets.acquireScope(p.id);
  try {
    assert.ok(ctx.tools.schemas(variantLease.key).some(tool => tool.name === 'subagent'));
    assert.ok(ctx.tools.schemas(variantLease.key).some(tool => tool.name === 'discovered_subagent'));
  } finally { await variantLease[Symbol.asyncDispose](); }
  assert.ok(!(await workshop.preview({ id: p.id })).tools.some(tool => tool.function.name === 'discovered_subagent'));
  const scopeBeforeMask = workshop.currentScopes.get(p.id);
  await workshop.action({ action: 'save', id: p.id, revision: workshop.preset(p.id).revision, changes: { tools: { ...workshop.preset(p.id).tools, enabled: [...workshop.preset(p.id).tools.enabled, 'discovered_subagent'] } } });
  assert.equal(workshop.currentScopes.get(p.id), scopeBeforeMask);
  assert.ok((await workshop.preview({ id: p.id })).tools.some(tool => tool.function.name === 'discovered_subagent'));
  console.log('PASS: rescan adds another light declaration variant to existing presets, keeps the original tool, and enables it without remounting');

  const sourceRows = [...ctx.loader.root.data];
  await ctx.loader.root.update([...sourceRows, { id: 'heavy-dependency-source', name: '@deepseek-ai/dsh-agent-preset', disabled: true, config: { id: 'unused-source', plugins: [{ id: 'workflow-realm', name: 'cordis:group', group: true, isolate: { workflowEngine: true }, config: [
    { id: 'engine', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
    { id: 'workflow', name: '@deepseek-ai/dsh-tool-workflow' },
    { id: 'ralph', name: '@deepseek-ai/dsh-tool-ralph' },
  ] }] } }]);
  const runtimeRow = [...ctx.loader.entries()].find(entry => entry.options.id === 'ptc-runtime');
  await runtimeRow.update({ disabled: false });
  await workshop.action({ action: 'scan' });
  const grouped = await workshop.preview({ id: p.id, draft: { tools: { ...workshop.preset(p.id).tools, packages: ['@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-tool-ralph'] } } });
  assert.ok(grouped.tools.some(tool => tool.function.name === 'workflow') && grouped.tools.some(tool => tool.function.name === 'ralph'));
  assert.equal(ctx.get('workflowEngine'), undefined);
  console.log('PASS: rescan preserves parent group service dependencies and isolation for two heavy packages');

  const originalBash = structuredClone(workshop.catalog.tools.find(tool => tool.name === 'bash').schema);
  await ctx.loader.root.update([...ctx.loader.root.data, { id: 'same-name-source', name: '@deepseek-ai/dsh-agent-preset', disabled: true, config: { id: 'unused-same-name', plugins: [{ id: 'replacement-realm', name: 'cordis:group', group: true, isolate: { workflowEngine: true }, config: [
    { id: 'engine', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
    { id: 'replacement', name: '@deepseek-ai/dsh-tool-workflow', config: { toolName: 'bash' } },
  ] }] } }]);
  await workshop.action({ action: 'scan' });
  const replacement = await workshop.preview({ id: p.id, draft: { tools: { ...workshop.preset(p.id).tools, packages: ['@deepseek-ai/dsh-tool-workflow'] } } });
  const replacementSchema = replacement.tools.find(tool => tool.function.name === 'bash');
  assert.ok(replacementSchema);
  assert.notDeepEqual(replacementSchema.function.parameters, originalBash.function.parameters);
  assert.deepEqual(workshop.catalog.tools.find(tool => tool.name === 'bash').schema, originalBash);
  await workshop.action({ action: 'create', id: 'collision-origin', name: 'Collision origin' });
  const collisionPreset = workshop.preset('collision-origin');
  const collisionLive = await createAgent('collision-live-session', collisionPreset.id);
  collisionLive.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Before source replacement' }], source: { kind: 'user' } }));
  await collisionLive.agent.whenIdle();
  assert.deepEqual(requests.at(-1).tools.find(tool => tool.name === 'bash').parameters, originalBash.function.parameters);
  replacementSchema.function.description = 'HEAVY ORIGIN DESCRIPTION';
  await workshop.action({ action: 'save', id: collisionPreset.id, revision: collisionPreset.revision, changes: { tools: { ...collisionPreset.tools, packages: ['@deepseek-ai/dsh-tool-workflow'], overrides: { bash: { schema: replacementSchema } } } } });
  assert.equal((await workshop.preview({ id: collisionPreset.id })).tools.find(tool => tool.function.name === 'bash').function.description, 'HEAVY ORIGIN DESCRIPTION');
  const collisionPreview = await workshop.preview({ id: collisionPreset.id, sessionId: collisionLive.agent.id });
  assert.ok(collisionPreview.runtime.pendingTools.includes('bash'));
  assert.ok(!collisionPreview.runtime.tools.some(tool => tool.function.name === 'bash'));
  assert.ok((await workshop.snapshot()).sessions.find(session => session.id === collisionLive.agent.id).pendingTools.includes('bash'));
  const beforeRequest = requests.length;
  collisionLive.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'After source replacement' }], source: { kind: 'user' } }));
  await collisionLive.agent.whenIdle();
  assert.equal(requests.length, beforeRequest + 1);
  assert.ok(!requests.at(-1).tools.some(tool => tool.name === 'bash'));
  await collisionLive.dispose();
  const ordinary = await workshop.preview({ id: p.id, draft: { tools: { ...workshop.preset(p.id).tools, enabled: ['bash'], packages: [], overrides: {} } } });
  assert.deepEqual(ordinary.tools[0].function.parameters, originalBash.function.parameters);
  await workshop.action({ action: 'delete', id: collisionPreset.id, revision: workshop.preset(collisionPreset.id).revision, confirm: true });
  console.log('PASS: selected heavy tools can replace a whole light row with the same name; schema validation follows the selected origin');

  const profileHost = await host({ profile: true });
  try {
    await profileHost.ctx.plugin(plugin, {}).await();
    const profileWorkshop = profileHost.ctx.presetWorkshop;
    await profileWorkshop.ready;
    await profileWorkshop.action({ action: 'create', id: 'new-default', name: 'New default' });
    await profileWorkshop.action({ action: 'default', id: 'new-default' });
    assert.equal(profileHost.ctx.agentPresets.defaultId, 'new-default');
    assert.ok((await readFile(profileHost.ctx.profileContext.patchPath, 'utf8')).includes('selectedDefault: new-default'));
    await profileWorkshop.action({ action: 'delete', id: 'new-default', revision: profileWorkshop.preset('new-default').revision });
    assert.equal(profileHost.ctx.agentPresets.defaultId, 'preset_workshop');
    assert.ok((await readFile(profileHost.ctx.profileContext.patchPath, 'utf8')).includes('selectedDefault: preset_workshop'));
    assert.ok(!(await profileHost.ctx.agentPresets.list()).some(row => row.id === 'new-default'));
  } finally { await profileHost.ctx.fiber.dispose(); await rm(profileHost.home, { recursive: true, force: true }); }
  console.log('PASS: official settings/configEditor persists selectedDefault and resets it before removal in a temporary profile');

  const permissionHost = await host();
  try {
    await permissionHost.ctx.plugin(plugin, {}).await();
    const permissionWorkshop = permissionHost.ctx.presetWorkshop;
    await permissionWorkshop.ready;
    const permissionRow = [...permissionHost.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-permission-presets');
    for (const defaultPreset of ['danger-full-access', 'read-only', 'workspace-write']) {
      const before = await permissionWorkshop.snapshot();
      await permissionRow.update({ config: { ...permissionRow.options.config, defaultPreset } });
      const after = await permissionWorkshop.snapshot();
      assert.notEqual(after.sourcesVersion, before.sourcesVersion);
      const detachedPreview = await permissionWorkshop.preview({ id: 'preset_workshop' });
      assert.ok(detachedPreview.runtimeContext.includes(defaultPreset));
      if (defaultPreset === 'danger-full-access') assert.ok(detachedPreview.runtimeContext.includes('Approval prompts are disabled'));
      assert.equal(permissionHost.ctx.sessions.list().length, 0);
    }
  } finally { await permissionHost.ctx.fiber.dispose(); await rm(permissionHost.home, { recursive: true, force: true }); }
  console.log('PASS: detached previews follow all three official permission defaults, update source versions and publish no sessions');

  const server = createServer((req, res) => workshop.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(endpoint);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).config.selectedPresetId, workshop.store.state.config.selectedPresetId);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{"action":"snapshot"}' })).status, 403);
    assert.equal((await fetch(endpoint, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const realGet = workshop.ctx.get.bind(workshop.ctx);
    workshop.ctx.get = (name, ...args) => name === 'connection' ? { requestRejection: req => req.headers['x-review-deny'] ? 401 : undefined } : realGet(name, ...args);
    try {
      const denied = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-review-deny': '1' }, body: '{"action":"open-skill","name":"invalid"}' });
      assert.equal(denied.status, 401); assert.equal(await denied.text(), '');
    } finally { workshop.ctx.get = realGet; }

    const oversized = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'snapshot', padding: 'a'.repeat(8 * 1024 * 1024 * 6 + 64 * 1024) }) });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, 'payload-too-large');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('PASS: HTTP snapshot and precise media-type, cross-site and oversized-payload errors');

  const immediate = await host();
  try {
    const quick = immediate.ctx.plugin(plugin, {});
    await quick.await();
    await quick.dispose();
  } finally { await immediate.ctx.fiber.dispose(); await rm(immediate.home, { recursive: true, force: true }); }
  console.log('PASS: immediate unload completes without leaving startup pending');
} finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true }); }
