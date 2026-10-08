import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

test('native module contributes only its reversible settings slot', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  let module;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value; } } }, structuredClone });
  assert.equal(module.id, 'dsh-preset-workshop');
  const plugin = module.factory(name => { assert.equal(name, 'react'); return {}; });
  const registrations = [], disposals = [];
  const ctx = {
    effect(factory) { disposals.push(factory()); },
    locale: { register(namespace, copy) { assert.equal(namespace, 'preset-workshop'); assert.ok(copy.zh.nav && copy.en.nav); return () => {}; }, bind() { return key => key; } },
    slots: { inject(name, factory) { disposals.push(factory()); }, register(options, component) { registrations.push({ options, component }); return () => registrations.pop(); } },
  };
  plugin.apply(ctx);
  assert.deepEqual(registrations.map(row => row.options.name), ['settings.section']);
  assert.equal(registrations[0].options.id, module.id);
  for (const dispose of disposals.reverse()) dispose();
  assert.equal(registrations.length, 0);
});

test('settings navigation compatibility icon is scoped, language aware and fully reversible', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const marker = 'data-preset-workshop-nav-icon', rows = ['通用设置', '预设工坊', '模型'].map(textContent => ({ textContent, attrs: new Map(), setAttribute(key, value) { this.attrs.set(key, value); }, removeAttribute(key) { this.attrs.delete(key); } }));
  let module, observer, stylesheet, label = '预设工坊', scheduled = [];
  const document = {
    body: {}, head: { append(value) { stylesheet = value; } },
    createElement() { return { textContent: '', remove() { this.removed = true; } }; },
    querySelectorAll(selector) { return selector === '[role="dialog"] nav button' ? rows : rows.filter(row => row.attrs.has(marker)); },
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(_target, options) { this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value; } } }, structuredClone, document, MutationObserver, queueMicrotask(callback) { scheduled.push(callback); } });
  const disposals = [];
  const ctx = { effect(factory) { disposals.push(factory()); }, locale: { register: () => () => {}, bind: () => () => label }, slots: { inject(_name, factory) { disposals.push(factory()); }, register: () => () => {} } };
  module.factory(() => ({})).apply(ctx);
  assert.deepEqual(rows.map(row => row.attrs.has(marker)), [false, true, false]);
  assert.ok(stylesheet.textContent.includes('background:currentColor') && stylesheet.textContent.includes('[data-preset-workshop-nav-icon]>svg'));
  assert.equal(observer.options.attributes, undefined);
  assert.equal(observer.options.characterData, true);
  label = 'Preset Workshop'; rows[1].textContent = label;
  observer.callback(); observer.callback(); assert.equal(scheduled.length, 1);
  scheduled.shift()(); assert.equal(rows[1].attrs.has(marker), true);
  rows[1].textContent = 'Another plugin'; observer.callback(); scheduled.shift()(); assert.ok(!rows[1].attrs.has(marker));
  rows[1].textContent = label; observer.callback();
  for (const dispose of disposals.reverse()) dispose();
  scheduled.shift()();
  assert.ok(observer.disconnected && stylesheet.removed);
  assert.ok(rows.every(row => !row.attrs.has(marker)));
});

test('served client assets contain their controls, isolate styles and omit offline state', async () => {
  const [html, css, js, pkg] = await Promise.all(['client.html', 'client.css', 'client.js', 'package.json'].map(file => readFile(new URL('../' + (file === 'package.json' ? file : 'src/' + file), import.meta.url), 'utf8')));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.includes(match[1]) || js.includes(`id="${match[1]}"`), `missing control: ${match[1]}`);
  }
  assert.ok(css.includes('@container workshop'));
  assert.ok(!/:[^;{}]*#[0-9a-f]{3,8}\b|(?:color|background):(?:white|black)\b/i.test(css));
  assert.ok(!html.includes('catalog-data') && !html.includes('id="navigation"'));
  assert.ok(js.includes('dsh-preset-workshop:collapse:v1') && !html.includes('skill-ponytail'));
  for (const key of ['persona','variables','sections','builtin-tools','official-tools','thirdparty-tools']) assert.ok(html.includes(`data-ui-collapse="${key}"`));
  assert.ok(!js.includes('state.catalog.tools = result.catalog'));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({ selectors: selector.trim().split(/\s*,\s*/), properties: Object.fromEntries(declarations.split(';').filter(value => value.includes(':')).map(value => { const index = value.indexOf(':'); return [value.slice(0, index).trim(), value.slice(index + 1).trim()]; })) }));
  const styles = selector => Object.assign({}, ...rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.properties));
  assert.equal(styles('#preview-prompt')['white-space'], 'pre-wrap');
  assert.ok(!html.includes('保存后对新会话生效'));
  const metadata = JSON.parse(pkg);
  assert.equal(metadata.exports['./client'], './src/client.js');
  assert.equal(metadata.exports['.'], './src/index.js');
  assert.ok(metadata.files.includes('src'));
  assert.equal(metadata.icon, 'assets/color.png');
  assert.equal(metadata.version, '0.1.0');
  assert.equal(metadata.exports['./package.json'], './package.json');
  assert.ok((await stat(new URL('../assets/color.png', import.meta.url))).size <= 256 * 1024);
  assert.ok(html.includes('draggable="false"'));
  assert.equal(styles('.skill-copy .skill-description')['white-space'], 'nowrap');
  assert.equal(styles('#skill-list').overflow, 'auto');
  assert.equal(styles('#skill-list')['overscroll-behavior'], 'auto');
  for (const selector of ['.bounded-list', '#skill-list', '.skill-body', '.skill-description-card p']) assert.ok(styles(selector)['max-height'] && styles(selector).overflow === 'auto');
  assert.ok(js.includes('width:18px;height:18px'));
  assert.ok(!js.includes('<code class=\"skill-path\">'));
  assert.ok(html.indexOf('class=\"id-field\"') < html.indexOf('class=\"preset-create-row actions\"'));
  assert.ok(html.includes('id=\"add-section\"'));
  assert.ok(css.includes('rgb(from var(--dsw-alias-bg-layer-1) r g b / 1)'));
  assert.ok(!js.includes('!state.config.polling || signal.aborted'));
  assert.ok(!js.includes("request('open-skill'"));
  for (const key of ['persona', 'builtin-tools', 'preview']) assert.match(html, new RegExp(`data-ui-collapse="${key}"[^>]* open`));
  for (const key of ['variables', 'sections', 'official-tools', 'thirdparty-tools', 'skills']) assert.doesNotMatch(html, new RegExp(`data-ui-collapse="${key}"[^>]* open`));
  assert.ok(css.includes('overscroll-behavior:auto'));
});

test('reordering a custom section preserves native order slots around readonly tool guidance', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const start = source.indexOf('      function move(source, target, before) {');
  const end = source.indexOf("      $('section-list').addEventListener('dragstart'", start);
  assert.ok(start > 0 && end > start);
  const items = [
    { name: 'context:file-reference', text: 'A', order: 900, enabled: true },
    { name: 'workshop:tool-guidance', text: 'B', order: 1000, enabled: true, managedBy: 'host', reorderable: false },
    { name: 'harness:source', text: 'Host', order: 10000, enabled: true },
    { name: 'deployment:persona-suffix', text: 'Cwd', order: 10200, enabled: true },
    { name: 'custom:row', text: 'Custom', order: 10300, enabled: true, custom: true },
  ];
  const draft = { prompt: { sections: {} } };
  vm.runInNewContext(source.slice(start, end) + "move('custom:row', 'deployment:persona-suffix', true);", { supplemental: () => items, draft, sections() {}, changed() {} });
  assert.equal(draft.prompt.sections['custom:row'].custom, true);
  assert.equal(draft.prompt.sections['context:file-reference'].order, 900);
  assert.equal(draft.prompt.sections['harness:source'].order, 10000);
  assert.ok(draft.prompt.sections['custom:row'].order < draft.prompt.sections['deployment:persona-suffix'].order);
  assert.ok(draft.prompt.sections['deployment:persona-suffix'].order > 1000);
  const ties = [{ name: 'custom:a', text: 'A', order: 100, enabled: true, custom: true }, { name: 'custom:b', text: 'B', order: 100, enabled: true, custom: true }, { name: 'workshop:tool-guidance', text: 'B host', order: 150, enabled: true, reorderable: false, managedBy: 'host' }, { name: 'custom:c', text: 'C', order: 300, enabled: true, custom: true }];
  const tiedDraft = { prompt: { sections: {} } };
  vm.runInNewContext(source.slice(start, end) + "move('custom:b', 'custom:a', true);", { supplemental: () => ties, draft: tiedDraft, sections() {}, changed() {} });
  assert.ok(tiedDraft.prompt.sections['custom:b'].order < tiedDraft.prompt.sections['custom:a'].order, 'same-order sections must really change native assembly order');
  assert.equal(tiedDraft.prompt.sections['custom:c'].order, 300);
  assert.ok(tiedDraft.prompt.sections['custom:a'].order < 150 && tiedDraft.prompt.sections['custom:b'].order < 150);
});
