import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newPreset, validatePreset, validateToolJSON, transformPrompt, selectedBinding, TOOL_GUIDANCE } from '../src/core.js';
import { WorkshopStore, dataRoot, atomicJSON } from '../src/store.js';

const tool = { type: 'function', function: { name: 'read', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string', description: 'path' }, description: { type: 'string' } }, required: ['path'] } } };
test('preset ids, names and builtin identity stay safe across imports', () => {
  assert.throws(() => validatePreset(newPreset('../escape')));
  assert.throws(() => validatePreset(newPreset('standard'), undefined, [], [{ id: 'standard' }]));
  const p = newPreset('one', 'A', true);
  assert.throws(() => validatePreset({ ...p, id: 'two' }, p));
  assert.throws(() => validatePreset(newPreset('two', 'A'), undefined, [p]));
  assert.equal(validatePreset({ ...p, builtin: false, enabled: false }, p).enabled, true);
});
test('tool JSON only changes descriptions, including a parameter named description', () => {
  const copy = structuredClone(tool);
  copy.function.parameters.properties.path.description = 'new';
  assert.equal(validateToolJSON(copy, 'read', tool), copy);
  copy.function.parameters.required = [];
  assert.throws(() => validateToolJSON(copy, 'read', tool), /Only description/);
  assert.throws(() => validateToolJSON(tool, 'write', tool), /must remain/);
  const literal = structuredClone(tool);
  literal.function.parameters.properties.path = { type: 'object', const: { description: 'STRUCTURAL VALUE' }, description: 'Actual schema documentation' };
  const changedLiteral = structuredClone(literal);
  changedLiteral.function.parameters.properties.path.const.description = 'DIFFERENT REQUIRED VALUE';
  assert.throws(() => validateToolJSON(changedLiteral, 'read', literal), /Only description/, 'literal values inside const are schema constraints');
  const changedDocumentation = structuredClone(literal);
  changedDocumentation.function.parameters.properties.path.description = 'New schema documentation';
  assert.equal(validateToolJSON(changedDocumentation, 'read', literal), changedDocumentation);
});
test('tool masks remove schemas and corresponding prompt sections independently', () => {
  const p = newPreset('one'); p.tools.enabled = ['read'];
  p.tools.overrides.read = { schema: { ...tool, function: { ...tool.function, description: 'custom' } }, prompt: 'custom read instructions' };
  const assembly = { sections: [{ name: 'harness:identity', text: 'host' }, { name: 'tool:read', text: 'read' }, { name: 'tool:edit', text: 'edit' }, { name: 'policy', text: 'extra' }], contexts: [], variables: {}, tools: [tool.function, { ...tool.function, name: 'edit' }] };
  const transformed = transformPrompt(assembly, p, [{ name: 'read', sections: ['tool:read'] }, { name: 'edit', sections: ['tool:edit'] }]);
  assert.deepEqual(transformed.tools.map(t => t.name), ['read']);
  assert.equal(transformed.tools[0].description, 'custom');
  assert.equal(transformed.sections.find(s => s.name === 'tool:read').text, 'custom read instructions');
  assert.ok(!transformed.sections.some(s => ['harness:identity', 'tool:edit'].includes(s.name)));
  assert.ok(transformed.sections.some(s => s.name === 'policy'));
});
test('default is eight tools; host metadata and cwd suffix support edits, disabling and ordering', () => {
  const p = newPreset('one');
  assert.equal(p.tools.enabled.length, 8);
  assert.ok(!p.tools.enabled.includes('subagent'));
  const assembly = { sections: [{ name: 'deployment:persona-prefix', text: 'native persona' }, { name: 'deployment:persona-suffix', text: 'Your working directory is {{cwd}}.' }, { name: 'harness:source', text: 'host-owned' }, { name: 'app:web-surface', text: 'web surface' }], tools: [] };
  const output = transformPrompt(assembly, p, []);
  assert.ok(output.sections.some(section => section.name === 'deployment:persona-suffix'));
  assert.ok(!output.sections.some(section => section.name === 'deployment:persona-prefix'));
  p.prompt.sections = { 'harness:source': { text: 'hidden', order: 200, enabled: false }, 'app:web-surface': { text: 'edited web', order: 50, enabled: true }, 'deployment:persona-suffix': { text: 'edited cwd', order: 10, enabled: true } };
  const edited = transformPrompt(assembly, validatePreset(p, p), []);
  assert.deepEqual(edited.sections.map(section => section.text), ['You are a helpful assistant.', 'edited cwd', 'edited web']);
  p.prompt.sections['harness:identity'] = { text: 'invalid identity', order: 0, enabled: true };
  assert.throws(() => validatePreset(p, p), error => error.code === 'managed-section');
});
test('custom System sections validate trust boundaries and survive normal policy transforms', () => {
  const p = newPreset('custom');
  const section = { text: 'Custom content', order: 150, enabled: true, custom: true };
  for (const name of ['', ' leading', 'trailing ', 'x'.repeat(257), 'control\u0000', 'tool:read', 'preset-workshop:persona', TOOL_GUIDANCE, 'workshop:directory-instructions']) {
    assert.throws(() => validatePreset({ ...p, prompt: { persona: p.prompt.persona, sections: { [name]: section } } }, p));
  }
  assert.throws(() => validatePreset({ ...p, prompt: { persona: p.prompt.persona, sections: JSON.parse('{"__proto__":{"text":"bad","order":1,"enabled":true}}') } }, p), /plain record/);
  for (const invalid of [{ ...section, text: 'x'.repeat(200001) }, { ...section, order: Infinity }, { ...section, custom: 'true' }]) {
    assert.throws(() => validatePreset({ ...p, prompt: { persona: p.prompt.persona, sections: { custom: invalid } } }, p));
  }
  p.prompt.sections = { 'custom:text': section };
  const transformed = transformPrompt({ sections: [], tools: [] }, validatePreset(p, p), []);
  assert.equal(transformed.sections.at(-1).text, 'Custom content');
});
test('only the latest preset selection determines a session binding', () => {
  assert.equal(selectedBinding({ agentPreset: 'one' }, [{ type: 'agent-preset/selected', data: { agentPreset: 'two' } }]), 'two');
});
test('shared and absent tool sections support independent description and prompt overrides', () => {
  const p = newPreset('one');
  p.tools.enabled = ['job_list', 'job_output', 'todo_write'];
  const schema = name => ({ type: 'function', function: { ...structuredClone(tool.function), name } });
  const job = schema('job_list'); job.function.description = 'CUSTOM JOB LIST';
  const todo = schema('todo_write'); todo.function.description = 'CUSTOM TODO';
  todo.function.parameters.properties.path.anyOf = [{ type: 'string', description: 'CUSTOM UNION DESCRIPTION' }];
  p.tools.overrides = { job_list: { schema: job }, job_output: { prompt: 'CUSTOM JOB OUTPUT' }, todo_write: { schema: todo } };
  const catalog = p.tools.enabled.map(name => ({ name, sections: name === 'todo_write' ? [] : ['tool:jobs'] }));
  const assembly = { sections: [{ name: 'tool:jobs', text: 'Shared job instructions' }], tools: p.tools.enabled.map(name => schema(name).function) };
  assembly.tools.find(t => t.name === 'todo_write').parameters = structuredClone(todo.function.parameters);
  const output = transformPrompt(assembly, p, catalog);
  const text = output.sections.map(s => s.text).join('\n');
  assert.ok(text.includes('CUSTOM JOB OUTPUT') && text.includes('Shared job instructions'));
  for (const description of ['CUSTOM JOB LIST', 'CUSTOM TODO', 'CUSTOM UNION DESCRIPTION']) assert.ok(!text.includes(description), 'schema descriptions must not replace native instructions');
  assert.equal(output.tools.find(t => t.name === 'job_list').description, 'CUSTOM JOB LIST');
  assert.equal(output.tools.find(t => t.name === 'todo_write').parameters.properties.path.anyOf[0].description, 'CUSTOM UNION DESCRIPTION');
  p.tools.overrides.job_output.promptEnabled = false;
  const hidden = transformPrompt(assembly, p, catalog);
  assert.ok(hidden.sections.some(s => s.text.includes('Shared job instructions')));
  assert.ok(!hidden.sections.some(s => s.text.includes('CUSTOM JOB OUTPUT')));
});
test('editable tool guidance remains dynamic, moves as a group and can be disabled independently of schemas', () => {
  const p = newPreset('guidance');
  p.tools.enabled = ['read', 'write'];
  p.prompt.sections = {
    [TOOL_GUIDANCE]: { text: '', order: 300, enabled: true },
    'tool:read': { text: 'EDITED READ', order: 1000, enabled: true },
    after: { text: 'AFTER', order: 500, enabled: true, custom: true },
  };
  const definitions = new Map([['tool:read', { order: 1000 }], ['tool:write', { order: 1010 }]]);
  const catalog = ['read', 'write'].map(name => ({ name, sections: ['tool:' + name] }));
  const assembly = { sections: [{ name: 'tool:read', text: 'READ' }, { name: 'tool:write', text: 'WRITE' }], tools: ['read', 'write'].map(name => ({ ...tool.function, name })) };
  assert.deepEqual(transformPrompt(assembly, validatePreset(p, p), catalog, definitions).sections.map(section => section.text), ['You are a helpful assistant.', 'EDITED READ', 'WRITE', 'AFTER']);
  p.tools.enabled = ['write'];
  assert.deepEqual(transformPrompt(assembly, p, catalog, definitions).sections.map(section => section.text), ['You are a helpful assistant.', 'WRITE', 'AFTER']);
  p.prompt.sections[TOOL_GUIDANCE].enabled = false;
  const disabled = transformPrompt(assembly, p, catalog, definitions);
  assert.deepEqual(disabled.tools.map(schema => schema.name), ['write']);
  assert.ok(!disabled.sections.some(section => section.name.startsWith('tool:')));
  p.prompt.sections[TOOL_GUIDANCE] = { text: '', order: 800, enabled: true };
  assert.deepEqual(transformPrompt(assembly, p, catalog, definitions).sections.map(section => section.text), ['You are a helpful assistant.', 'AFTER', 'WRITE']);
});
test('configuration survives restart and serial updates; paths follow DSH_HOME', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workshop-store-'));
  try {
    const store = new WorkshopStore(root); await store.init();
    await Promise.all([1, 2, 3].map(n => store.run(async () => { const next = structuredClone(store.state); next.config.ui['step' + n] = n; await store.save(next); })));
    const reopened = new WorkshopStore(root); await reopened.init();
    assert.deepEqual(reopened.state.config.ui, { step1: 1, step2: 2, step3: 3 });
    assert.equal(JSON.parse(await readFile(join(root, 'presets/preset_workshop/prompt.json'))).persona, 'You are a helpful assistant.');
    assert.equal(dataRoot({ DSH_HOME: '/tmp/custom-home' }), '/tmp/custom-home/preset-workshop');
    await store.run(async () => { const next = structuredClone(store.state); next.config.ui.newer = true; await store.save(next); });
    await assert.rejects(reopened.run(() => reopened.save(reopened.state)), error => error.code === 'store-conflict');
    const interrupted = structuredClone(store.state);
    interrupted.config.generation++;
    interrupted.config.ui.recovered = true;
    await atomicJSON(join(root, '.pending.json'), interrupted);
    const recovered = new WorkshopStore(root); await recovered.init();
    assert.equal(recovered.state.config.ui.recovered, true);
    const original = await readFile(join(root, 'config.json'), 'utf8');
    interrupted.presets[0].id = '../escape';
    await atomicJSON(join(root, '.pending.json'), interrupted);
    await assert.rejects(new WorkshopStore(root).init());
    assert.equal(await readFile(join(root, 'config.json'), 'utf8'), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
