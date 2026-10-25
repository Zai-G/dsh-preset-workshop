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
  assert.doesNotMatch(js, /来源插件未公开|Plugin source not exposed/);
  assert.doesNotMatch(js, /tool-source|tool-origin|工具来源：|Source: /);
  const userStart = js.indexOf('const user = [];', js.indexOf('function sections()'));
  const userEnd = js.indexOf("$('section-list').innerHTML", userStart);
  const userAssembly = js.slice(userStart, userEnd);
  const userOrder = ['if (preview?.runtimeContext)', 'if (preview?.skillPrompt)', "section.name === 'time-context'", 'if (agent)'].map(part => userAssembly.indexOf(part));
  assert.ok(userOrder.every(index => index >= 0) && userOrder.every((index, position) => !position || userOrder[position - 1] < index), '拼接 User rows order environment, SKILL, time-context, AGENTS');
  assert.match(js, /icon\(visible \? 'eye-off' : 'eye'\)/);
  assert.match(js, /mcp-preview-entry/);
  assert.match(js, /const revealedHeaders = new Set\(\)/);
  assert.match(js, /data-mcp-preview-secret="\$\{index\}"/);
  assert.match(js, /data-mcp-preview-reveal="\$\{index\}"/);
  assert.match(js, /revealedHeaders\.has\(index\) \? esc\(valueText\(value\)\) : '••••••'/);
  assert.match(js, /reveal\.innerHTML = icon\(visible \? 'eye-off' : 'eye'\)/);
  assert.match(js, /resizeMcpJson/);
  assert.ok(js.includes('class="json-editor mcp-json-editor"'));
  assert.ok(html.includes('id="i-eye-off"'));
  assert.match(js, /'ui:deliverable-file-references': t\('交付文件引用', 'Deliverable file references'\)/);
  for (const key of ['persona','sections','builtin-tools','official-tools','thirdparty-tools']) assert.ok(html.includes(`data-ui-collapse="${key}"`));
  assert.ok(html.includes('class="variable-badge tooltip-wrap"') && !html.includes('data-ui-collapse="variables"'));
  assert.doesNotMatch(html, /data-ui-collapse="mcp"[^>]* open/);
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
  assert.equal(metadata.version, '0.2.0');
  assert.equal(metadata.exports['./package.json'], './package.json');
  assert.ok((await stat(new URL('../assets/color.png', import.meta.url))).size <= 256 * 1024);
  assert.ok(html.includes('draggable="false"'));
  assert.equal(styles('.skill-copy .skill-description')['white-space'], 'nowrap');
  assert.equal(styles('#skill-list').overflow, 'auto');
  assert.equal(styles('#skill-list')['overscroll-behavior'], 'auto');
  assert.equal(styles('.mcp-tools')['grid-template-columns'], 'repeat(2,minmax(0,1fr))');
  assert.equal(styles('.mcp-tools')['max-height'], 'min(360px,48dvh)');
  assert.equal(styles('.mcp-tools').overflow, 'auto');
  assert.equal(styles('.mcp-preview-entry.has-reveal')['grid-template-columns'], 'minmax(90px, .42fr) minmax(0, 1fr) 30px');
  assert.equal(styles('.mcp-preview-entry.has-reveal .icon-button').width, '30px');
  for (const selector of ['.bounded-list', '#skill-list', '.skill-body', '.skill-description-card p']) assert.ok(styles(selector)['max-height'] && styles(selector).overflow === 'auto');
  assert.ok(js.includes('width:18px;height:18px'));
  assert.ok(!js.includes('<code class=\"skill-path\">'));
  assert.ok(html.indexOf('class=\"id-field\"') < html.indexOf('class=\"preset-create-row actions\"'));
  assert.ok(html.includes('id=\"add-section\"'));
  assert.ok(css.includes('rgb(from var(--dsw-alias-bg-layer-1) r g b / 1)'));
  assert.ok(!js.includes('!state.config.polling || signal.aborted'));
  assert.ok(!js.includes("request('open-skill'"));
  for (const key of ['persona', 'builtin-tools', 'preview']) assert.match(html, new RegExp(`data-ui-collapse="${key}"[^>]* open`));
  for (const key of ['sections', 'official-tools', 'thirdparty-tools', 'skills']) assert.doesNotMatch(html, new RegExp(`data-ui-collapse="${key}"[^>]* open`));
  assert.ok(css.includes('overscroll-behavior:auto'));
  assert.doesNotMatch(css, /dialog\[open\]:has\([^{}]*\)\s*\{[^}]*height\s*:/s);
  assert.match(css, /\.dialog-body\s*\{[^}]*max-height:calc\(100dvh - 190px\)/s);
  assert.match(css, /\.json-editor\s*\{[^}]*height:min\(370px,45vh\)/s);
  assert.match(css, /\.mcp-json-editor\s*\{[^}]*max-height:min\(370px,45dvh\)/s);
});

test('MCP editor uses explicit argument and key-value rows with both transport modes and probes', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.match(source, /data-mcp-arg-value/);
  assert.match(source, /data-mcp-key/);
  assert.match(source, /data-mcp-expression/);
  assert.match(source, /transportDrafts\[current\.transport\] = clone\(current\)/);
  assert.match(source, /request\('mcp-probe'/);
  assert.match(source, /aria-label="\$\{t\(visible \? '隐藏值' : '显示值'/);
  assert.match(source, /button\.title = t\(visible \? '隐藏值' : '显示值'/);
  assert.match(source, /const config = server\.config \|\| server/);
  assert.match(source, /config\.transport === 'stdio'/);
  assert.match(source, /config\.env/);
  assert.match(source, /config\.headers/);
  assert.ok(source.indexOf('if (jsonMode) resizeMcpJson();') > source.indexOf("$('mcp-json-view').hidden = !jsonMode"), 'JSON textarea sizing must run after the view is unhidden');
  assert.doesNotMatch(source, /quickProbe|fullProbe|快速检查|完整检查/);
  assert.match(source, /不会调用工具或保存配置/);
  assert.match(source, /const expanded = new Set\(\[\.\.\.\$\('mcp-list'\)\.querySelectorAll\('\.mcp-server\[open\]'\)\]/);
  assert.match(source, /server\.open = expanded\.has\(server\.dataset\.serverName\)/);
  assert.match(source, /server\.source === 'preset' \? t\('当前工具'/);
  assert.match(source, /request\(editing \? 'mcp-update' : 'mcp-create'/);
  assert.match(source, /request\('mcp-delete'/);
  assert.match(source, /const pendingNames = \[\.\.\.new Set\(\[\.\.\.pending\.flatMap\(session => session\.pendingTools\), \.\.\.selectedPending\]\)\]\.filter\(Boolean\)/);
  assert.match(source, /关闭并恢复相关会话后才能使用新增或替换的工具/);
  assert.doesNotMatch(source, /function parseMcpArgs\(/);
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

test('System drag starts only from its handle and keeps the row visible', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const start = source.indexOf("      $('section-list').addEventListener('dragstart'");
  const end = source.indexOf("      $('section-list').addEventListener('dragover'", start);
  let onDragStart, dragged, marked = false, prevented = false, payload;
  const row = { dataset: { dragSection: 'custom:one' }, classList: { add() { marked = true; } } };
  const handle = { closest: () => row };
  const sandbox = { $: () => ({ addEventListener(_type, fn) { onDragStart = fn; } }), dragged };
  vm.runInNewContext(source.slice(start, end), sandbox);
  const event = { target: { closest: () => null }, preventDefault() { prevented = true; } };
  onDragStart(event);
  assert.ok(prevented);
  assert.equal(sandbox.dragged, undefined);
  event.target.closest = () => handle;
  event.dataTransfer = { setData(type, value) { payload = [type, value]; } };
  onDragStart(event);
  assert.equal(sandbox.dragged, 'custom:one');
  assert.deepEqual(payload, ['text/plain', 'custom:one']);
  assert.ok(marked);
});
