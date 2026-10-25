import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { host } from './host-harness.mjs';
import * as plugin from '../src/index.js';
import { AGENT_SECTION } from '../src/core.js';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const deadline = performance.now() + timeout;
  while (!await check()) { if (performance.now() > deadline) assert.fail('Condition timed out'); await pause(20); }
}
const { ctx, home } = await host({ personaSuffix: 'Your working directory is {{cwd}}.' });
try {
  const started = performance.now();
  await ctx.plugin(plugin, {}).await();
  const workshop = ctx.presetWorkshop;
  await workshop.ready;
  const startupMs = performance.now() - started;
  const scanStart = performance.now();
  await workshop.action({ action: 'scan' });
  const scanMs = performance.now() - scanStart;
  assert.ok(startupMs < 1000 && scanMs < 1000, `Isolated startup ${startupMs}ms / scan ${scanMs}ms`);
  console.log(`PASS: complete isolated startup ${Math.round(startupMs)}ms; rescan ${Math.round(scanMs)}ms (not a desktop cold-cache guarantee)`);

  // Ten independent slow source presets must still merge in roster order.
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: `source-${index}` }));
  const sample = {
    ctx: { skills: { layers: {}, snapshot: async () => ({ complete: true, skills: [] }) }, agentPresets: { list: async () => rows } },
    ownsPreset: () => false,
    withSourceRegistry: async (id, read) => read({ layers: {}, snapshot: async () => { await pause(110); return { complete: true, skills: [{ name: id }, { name: 'shared', description: id }] }; } }, {}),
  };
  const sourceStart = performance.now();
  const merged = await plugin.PresetWorkshop.prototype.sourceSkillCatalog.call(sample, home);
  assert.ok(performance.now() - sourceStart < 1000);
  assert.equal(merged.skills.length, 11);
  assert.equal(merged.skills.find(skill => skill.name === 'shared').description, 'source-0');
  assert.equal(merged.complete, true);
  let sourceWarnings = 0;
  sample.ctx.logger = { warn() { sourceWarnings++; } };
  const readSource = sample.withSourceRegistry;
  sample.withSourceRegistry = (id, read) => id === 'source-1' ? Promise.reject(Error('Fixture source unavailable')) : readSource(id, read);
  const partial = await plugin.PresetWorkshop.prototype.sourceSkillCatalog.call(sample, home);
  assert.equal(partial.complete, false); assert.equal(sourceWarnings, 1);
  assert.ok(partial.skills.some(skill => skill.name === 'source-0'));
  console.log('PASS: slow source catalogs run together and preserve completeness and deterministic winners');

  await workshop.action({ action: 'create', id: 'adaptation', name: 'Adaptation checks' });
  const update = changes => { const p = workshop.preset('adaptation'); return workshop.action({ action: 'save', id: p.id, revision: p.revision, changes }); };
  const sourcePath = join(home, 'AGENTS.md');
  await writeFile(sourcePath, 'GLOBAL BASELINE');
  const removeSkill = ctx.skills.register({ name: 'context-skill', description: 'Bound context skill', content: 'SKILL BODY', source: 'test' });
  const p = workshop.preset('adaptation');
  await update({ skills: ['context-skill'], tools: { ...p.tools, enabled: ['skill', 'read'] }, prompt: { persona: 'Legacy {{cwd}}', sections: { 'deployment:persona-suffix': { text: 'Your working directory is {{cwd}}.', order: 10200, enabled: true } } } });
  const create = id => ctx.agents.create({ sessionId: id, meta: { cwd: home, agentPreset: 'adaptation' }, agentOptions: { provider: 'test', model: 'test-model' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'adaptation'); } });
  const requests = [], errors = [];
  class LocalAdapter extends LlmAdapter {
    async *stream(request) {
      requests.push(request);
      yield { type: 'message-start', role: 'assistant' };
      yield { type: 'content-start', index: 0, block: { type: 'text', text: '' } };
      yield { type: 'text-delta', index: 0, text: 'test' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['test'], new LocalAdapter());
  ctx.on('agent/error', event => errors.push(event.error));
  const live = await create('adaptation-session');
  const ask = async text => { const count = requests.length; live.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await live.agent.whenIdle(); assert.equal(requests.length, count + 1, errors.map(error => error.stack).join('\n')); return JSON.stringify(requests.at(-1).messages); };
  try {
    const first = await ask('First request');
    assert.ok(first.includes('GLOBAL BASELINE') && first.includes('context-skill'));
    const prior = live.agent.session.surface.nodes.filter(seq => { const event = live.agent.session.eventAt(seq); return event.type === 'user/message' && ['preset-workshop-global-instructions', 'skill-catalog', 'agent-instructions'].includes(event.data.source.kind); });
    const [firstSeq, lastSeq] = [prior[0], prior.at(-1)];
    live.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Compacted context' }], source: { kind: 'user' } }), { surfaceOp: { op: 'replace', startSeq: firstSeq, endSeq: lastSeq }, sourceEventSeqs: live.agent.session.surface.nodes.filter(seq => seq >= firstSeq && seq <= lastSeq) });
    const restored = await ask('Request after compaction');
    assert.ok(restored.includes('GLOBAL BASELINE') && restored.includes('context-skill'));
    const globalCount = () => live.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'preset-workshop-global-instructions').length;
    const count = globalCount(); await ask('Unchanged request'); assert.equal(globalCount(), count);
    console.log('PASS: SKILL and AGENTS both re-enter actual AI requests after surface replacement without duplicate unchanged baselines');

    const timeText = 'Time sampled for test. Browser time zone for this request: Asia/Shanghai.';
    live.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: timeText }], source: { kind: 'time-context', form: 'snapshot', sections: [{ name: 'time-context', text: timeText }] } }), { surfaceOp: 'append' });
    const withTime = await workshop.preview({ id: 'adaptation', sessionId: live.agent.id });
    assert.equal(withTime.userSections.find(section => section.name === 'time-context').text, timeText);
    assert.ok(withTime.displayPrompt.includes(timeText));
    const displayOrder = ['## 环境\n\n', '## SKILL\n\n', '## 时间与时区\n\n', '## AGENTS（全局级）\n\n'].map(section => withTime.displayPrompt.indexOf(section));
    assert.ok(displayOrder.every(index => index >= 0) && displayOrder.every((index, position) => !position || displayOrder[position - 1] < index), 'time-context follows SKILL and precedes AGENTS');
    const detachedTime = (await workshop.preview({ id: 'adaptation' })).userSections.find(section => section.name === 'time-context');
    assert.ok(detachedTime.enabled && detachedTime.toggleable && detachedTime.text.includes('Time sampled while preparing'));
    assert.ok(!detachedTime.source);
    const eventsBeforePreview = live.agent.session.seq;
    await workshop.preview({ id: 'adaptation', sessionId: live.agent.id });
    assert.equal(live.agent.session.seq, eventsBeforePreview, 'clock previews must not append session events');
    const timeCount = () => live.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'time-context').length;
    assert.ok(timeCount() >= 2, 'the workshop preset must inject native time readings');
    let policy = workshop.preset('adaptation');
    await update({ prompt: { ...policy.prompt, sections: { ...policy.prompt.sections, 'time-context': { text: '', order: 0, enabled: false } } } });
    const clockOff = await workshop.preview({ id: 'adaptation', sessionId: live.agent.id });
    assert.equal(clockOff.userSections.find(section => section.name === 'time-context').enabled, false);
    assert.ok(!clockOff.displayPrompt.includes('## 时间与时区') && !clockOff.prompt.includes(timeText));
    const beforeDisabledRequest = timeCount();
    await ask('Clock disabled');
    assert.equal(timeCount(), beforeDisabledRequest, 'disabling the clock stops new time injections in an existing agent');
    policy = workshop.preset('adaptation');
    await update({ prompt: { ...policy.prompt, sections: { ...policy.prompt.sections, 'time-context': { text: '', order: 0, enabled: true } } } });
    const unknownClock = workshop.preset('adaptation');
    assert.ok(!(await workshop.preview({ id: 'adaptation', draft: unknownClock })).prompt.includes('time-context'));
    assert.ok((await workshop.preview({ id: 'adaptation' })).displayPrompt.includes('## 时间与时区'));
    const beforeReenabledRequest = timeCount();
    await ask('Clock re-enabled');
    assert.equal(timeCount(), beforeReenabledRequest + 1, 're-enabling the clock immediately injects a fresh reading');
    await ask('Clock still within native interval');
    assert.equal(timeCount(), beforeReenabledRequest + 1, 'the native refresh interval still suppresses an unchanged clock');
    console.log('PASS: native clock previews before the first message, refreshes after re-enable, keeps its interval, and never becomes a System section');
    const working = ctx.get('workingDirectory');
    if (working) {
      assert.ok(workshop.catalog.tools.some(tool => tool.name === 'working_directory' && tool.available));
      assert.ok(!withTime.prompt.includes('Your working directory is '));
      assert.ok(withTime.runtimeContext.includes(home));
      assert.ok(!withTime.editableSections.some(section => section.name === 'deployment:persona-suffix'));
      const changedDir = join(home, 'changed'); await mkdir(changedDir); await writeFile(join(changedDir, 'AGENTS.md'), 'CHANGED DIRECTORY BASELINE');
      const effectiveDir = await working.set(live.agent, changedDir);
      const preview = await workshop.preview({ id: 'adaptation', sessionId: live.agent.id });
      assert.equal(preview.cwd, effectiveDir);
      assert.ok(preview.prompt.includes(effectiveDir) && preview.runtimeContext.includes(effectiveDir));
      assert.ok((await workshop.snapshot()).sessions.find(session => session.id === live.agent.id).cwd === effectiveDir);
      assert.ok((await ask('Request after cd')).includes('CHANGED DIRECTORY BASELINE'));
      const agentsHome = join(home, 'agents'); await mkdir(agentsHome); await writeFile(join(agentsHome, 'AGENTS.md'), 'SHARED GLOBAL ROOT');
      const roots = await workshop.preview({ id: 'adaptation', cwd: agentsHome });
      assert.ok(roots.agentInstructions.text.includes('SHARED GLOBAL ROOT'));
      assert.ok(!roots.agentInstructions.directoryText.includes('SHARED GLOBAL ROOT'));
      await update({ prompt: { ...workshop.preset('adaptation').prompt, sections: { [AGENT_SECTION]: { text: 'OVERRIDE BOTH ROOTS', enabled: true, order: 0 } } } });
      const override = await ask('Override both global roots'); assert.ok(override.includes('OVERRIDE BOTH ROOTS'));
    }
    console.log('PASS: legacy templates render, current cwd follows host cd, shared global roots have one authority, and live time context is read without simulation');
    removeSkill();
    const missing = await workshop.preview({ id: 'adaptation', sessionId: live.agent.id });
    assert.deepEqual(missing.skillWarnings, ['context-skill']);
    const countBefore = requests.length;
    live.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Missing bound skill' }], source: { kind: 'user' } })); await live.agent.whenIdle();
    assert.equal(requests.length, countBefore, 'Missing bound skills must not silently reach the model with stale catalog data');
    assert.equal(errors.at(-1).code, 'skill-context-unavailable');
    console.log('PASS: a missing selected skill is visible in preview and stops an incomplete AI request with an actionable error');
  } finally { await live.dispose(); }

  const resources = await ctx.loader.root.tree.import('@deepseek-ai/dsh-mcp-resources');
  await ctx.plugin(resources.default, {}).await();
  const fixture = fileURLToPath(new URL('./fixtures/mcp-probe-server.mjs', import.meta.url));
  const resourceTools = ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'];
  const config = { serverName: 'slow', transport: 'stdio', command: process.execPath, args: [fixture], env: { MCP_PROBE_DELAY_MS: '1500', MCP_PROBE_VALUE: { __jsExpr: "'fixture-value'" } }, cwd: home };
  const current = workshop.preset('adaptation');
  const startSave = performance.now();
  await workshop.action({ action: 'mcp-create', id: current.id, revision: current.revision, server: config });
  assert.ok(performance.now() - startSave < 1000, 'Saving must not wait for initialize');
  const initialMcp = (await workshop.preview({ id: current.id })).mcp.find(server => server.serverName === 'slow');
  assert.equal(initialMcp.connection.state, 'connecting');
  assert.equal(initialMcp.tools.length, 0);
  await until(async () => (await workshop.preview({ id: current.id })).mcp.find(server => server.serverName === 'slow').connection.state === 'ready');
  const ready = await workshop.preview({ id: current.id, draft: structuredClone(workshop.preset(current.id)) });
  assert.equal(ready.mcp[0].connection.state, 'ready', 'An unchanged env expression must borrow the saved connection');
  assert.equal(ready.mcp.find(server => server.serverName === 'slow').tools[0].function.name, 'mcp__slow__ping');
  assert.ok(!ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__slow__')));
  await update({ skills: [], tools: { ...workshop.preset(current.id).tools, enabled: ['mcp__slow__ping', ...resourceTools] } });
  await until(async () => (await workshop.preview({ id: current.id })).mcp[0].connection.state === 'ready');
  const savedResources = await workshop.preview({ id: current.id });
  const draftResources = await workshop.preview({ id: current.id, draft: structuredClone(workshop.preset(current.id)) });
  assert.deepEqual(draftResources.tools.map(tool => tool.function.name).sort(), savedResources.tools.map(tool => tool.function.name).sort());
  assert.ok(resourceTools.every(name => draftResources.tools.some(tool => tool.function.name === name)));
  assert.equal(draftResources.sections.find(section => section.name === 'mcp-resource-servers').text, savedResources.sections.find(section => section.name === 'mcp-resource-servers').text);
  const mcpAgent = await create('mcp-edit-session');
  try {
    mcpAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Start MCP session' }], source: { kind: 'user' } })); await mcpAgent.agent.whenIdle();
    assert.ok(requests.at(-1).tools.some(tool => tool.name === 'mcp__slow__ping'));
    assert.ok(resourceTools.every(name => requests.at(-1).tools.some(tool => tool.name === name)));
    const beforeEdit = workshop.preset(current.id);
    await workshop.action({ action: 'mcp-update', id: current.id, revision: beforeEdit.revision, serverName: 'slow', server: { ...config, env: { MCP_PROBE_DELAY_MS: '10' } } });
    await until(async () => (await workshop.preview({ id: current.id })).mcp[0].connection.state === 'ready');
    await workshop.attachAgent(mcpAgent.agent);
    assert.ok(!mcpAgent.agent.ctx.tools.schemas(mcpAgent.agent).some(tool => tool.name === 'mcp__slow__ping'), 'An old agent must not call the previous server after a connection edit');
    assert.ok(workshop.pendingTools(mcpAgent.agent).includes('mcp__slow__ping'));
    mcpAgent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'After connection edit' }], source: { kind: 'user' } })); await mcpAgent.agent.whenIdle();
    assert.ok(resourceTools.every(name => !requests.at(-1).tools?.some(tool => tool.name === name)), 'Old resource providers must be hidden with stale server executors');
    assert.ok(resourceTools.every(name => workshop.pendingTools(mcpAgent.agent).includes(name)));
    assert.ok(!mcpAgent.agent.ctx.tools.get('list_mcp_resources', mcpAgent.agent));
    await update({ mcp: [] });
    await workshop.attachAgent(mcpAgent.agent);
    assert.ok(!mcpAgent.agent.ctx.tools.schemas(mcpAgent.agent).some(tool => tool.name === 'mcp__slow__ping'), 'Removing a server through save must not re-enable an old executor');
  } finally { await mcpAgent.dispose(); }
  console.log('PASS: slow MCP saves immediately, unchanged drafts reuse mounted tools, connections stay scoped, and edits hide stale executors until restore');

  await workshop.action({ action: 'mcp-create', id: current.id, revision: workshop.preset(current.id).revision, server: config });
  const beforeTimeout = workshop.preset(current.id);
  const timeoutStart = performance.now();
  await workshop.action({ action: 'mcp-update', id: current.id, revision: beforeTimeout.revision, serverName: 'slow', server: { ...config, env: { MCP_PROBE_DELAY_MS: '30000' } } });
  assert.ok(performance.now() - timeoutStart < 1000);
  await until(async () => (await workshop.preview({ id: current.id })).mcp[0].connection.state === 'error', 19000);
  const timeoutState = await workshop.preview({ id: current.id });
  assert.ok(timeoutState.mcp[0].connection.error.includes('15 seconds'));
  assert.ok(timeoutState.mcp[0].tools.every(tool => tool.unavailable));
  assert.ok(!timeoutState.tools.some(tool => tool.function.name === 'mcp__slow__ping'));
  const beforeDelete = workshop.preset(current.id);
  await workshop.action({ action: 'mcp-delete', id: current.id, revision: beforeDelete.revision, serverName: 'slow' });
  assert.equal(workshop.mcpStates.size, 0);
  const empty = workshop.preset(current.id);
  await workshop.action({ action: 'mcp-create', id: current.id, revision: empty.revision, server: { ...config, env: { MCP_PROBE_DELAY_MS: '30000' } } });
  await pause(100);
  const connecting = workshop.preset(current.id), cancelStart = performance.now();
  await workshop.action({ action: 'mcp-delete', id: current.id, revision: connecting.revision, serverName: 'slow' });
  assert.ok(performance.now() - cancelStart < 1000, 'Deleting a connecting server must cancel startup without blocking');
  assert.equal(workshop.mcpStates.size, 0);
  const remote = workshop.preset(current.id);
  await workshop.action({ action: 'mcp-create', id: current.id, revision: remote.revision, server: { serverName: 'remote', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: { __jsExpr: "'fixture-header'" } } } });
  await until(async () => (await workshop.preview({ id: current.id })).mcp[0].connection.state === 'error');
  const remoteDraft = await workshop.preview({ id: current.id, draft: structuredClone(workshop.preset(current.id)) });
  assert.equal(remoteDraft.mcp[0].connection.state, 'error', 'An unchanged HTTP header expression must preserve saved connection status');
  await workshop.action({ action: 'mcp-delete', id: current.id, revision: workshop.preset(current.id).revision, serverName: 'remote' });
  await workshop.action({ action: 'create', id: 'prefixes', name: 'Prefix checks' });
  for (const serverName of ['a', 'a__b']) await workshop.action({ action: 'mcp-create', id: 'prefixes', revision: workshop.preset('prefixes').revision, server: { ...config, serverName, env: {} } });
  await until(async () => (await workshop.preview({ id: 'prefixes' })).mcp.every(server => server.connection.state === 'ready'));
  const prefixPreset = workshop.preset('prefixes');
  await workshop.action({ action: 'save', id: prefixPreset.id, revision: prefixPreset.revision, changes: { tools: { ...prefixPreset.tools, enabled: ['mcp__a__b__ping'] } } });
  const prefixDraft = structuredClone(workshop.preset('prefixes'));
  assert.ok((await workshop.preview({ id: prefixDraft.id, draft: prefixDraft })).tools.some(tool => tool.function.name === 'mcp__a__b__ping'));
  prefixDraft.mcp[1].env = { MCP_PROBE_VALUE: 'changed' };
  const prefixPreview = await workshop.preview({ id: prefixDraft.id, draft: prefixDraft });
  assert.equal(prefixPreview.mcp.find(server => server.serverName === 'a__b').connection.state, 'unsaved');
  assert.ok(!prefixPreview.tools.some(tool => tool.function.name === 'mcp__a__b__ping'), 'An unchanged prefix server must not borrow tools from another changed server');
  await workshop.action({ action: 'delete', id: prefixDraft.id, revision: prefixDraft.revision });
  assert.equal(await readFile(sourcePath, 'utf8'), 'GLOBAL BASELINE');
  console.log('PASS: stalled MCP times out, removes registrations, preserves saved selections, and deletion clears connection state');
} finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); }
