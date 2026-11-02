import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

// Guards the failure mode that shipped in 0.3.0: a stray `}` closing a rule
// instead of its `@container` block swallowed the whole base layer, so every
// rule for the new UI only applied below 440px and the plugin rendered unstyled.

function parse(source) {
  let depth = 0, negative = 0, line = 1, inComment = false, quote = null, buffer = '';
  const stack = [], rules = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (char === '\n') line++;
    if (inComment) { if (char === '*' && next === '/') { inComment = false; i++; } continue; }
    if (quote) { if (char === '\\') { i++; continue; } if (char === quote) quote = null; continue; }
    if (char === '/' && next === '*') { inComment = true; i++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') {
      const selector = buffer.trim(); buffer = '';
      const isAt = selector.startsWith('@');
      stack.push({ isAt, selector, start: i, line, chain: stack.filter(entry => entry.isAt).map(entry => entry.selector) });
      depth++;
      continue;
    }
    if (char === '}') {
      depth--;
      if (depth < 0) negative++;
      const closed = stack.pop();
      if (closed && !closed.isAt) rules.push({ selector: closed.selector.replace(/\s+/g, ' '), line: closed.line, chain: closed.chain, body: source.slice(closed.start + 1, i) });
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return { depth, negative, rules };
}

const source = await readFile(new URL('../src/client.css', import.meta.url), 'utf8');
const parsed = parse(source);
const atTop = parsed.rules.filter(rule => rule.chain.length === 0);
const topSelectors = new Set(atTop.map(rule => rule.selector));

const CRITICAL = ['.config-tabs', '.config-tab', '.preview-launch', '.preview-launch-action', '.tool-counts-line', '.config-surface', '.preview-dialog', '.tools-grid', '.tool-card'];

test('client.css braces balance and no block is left dangling', () => {
  assert.equal(parsed.depth, 0, 'unbalanced braces');
  assert.equal(parsed.negative, 0, 'stray closing brace');
  assert.ok(parsed.rules.length > 500, 'stylesheet looks truncated');
});

test('base layer is top level, not trapped inside a container query', () => {
  const missing = CRITICAL.filter(name => ![...topSelectors].some(selector => selector.split(',').some(part => part.trim().startsWith(name))));
  assert.deepEqual(missing, [], `these selectors have no unconditional rule: ${missing.join(', ')}`);
  // A whole layer slipping into an @container block drops this ratio sharply.
  assert.ok(atTop.length / parsed.rules.length >= 0.75, `only ${atTop.length}/${parsed.rules.length} rules are unconditional`);
});

test('theme variables used by the level cells are defined unconditionally', () => {
  const declares = name => atTop.some(rule => rule.selector.includes(':host') && rule.body.includes(name));
  for (const name of ['--surface-sunken', '--cell-active-bg', '--cell-shadow']) assert.ok(declares(name), `${name} is only defined inside a media or container query`);
});

test('container queries stay shallow and reference the host container', () => {
  for (const rule of parsed.rules) {
    assert.ok(rule.chain.length <= 2, `line ${rule.line} nests ${rule.chain.length} at-rules deep`);
    for (const chain of rule.chain) if (chain.startsWith('@container')) assert.match(chain, /^@container workshop /, `line ${rule.line} queries an unknown container`);
  }
  assert.ok(source.includes('container:workshop / inline-size'), 'host no longer defines the workshop container');
});

test('every class in the markup still has a rule', async () => {
  // Modifiers that intentionally ride on a base class and carry no style of their own.
  const hooks = new Set(['compat-surface']);
  const markup = await readFile(new URL('../src/client.html', import.meta.url), 'utf8');
  const classes = new Set([...markup.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/)).filter(Boolean));
  const unstyled = [...classes].filter(name => !hooks.has(name) && !new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(source));
  assert.deepEqual(unstyled, [], `markup uses classes with no stylesheet rule: ${unstyled.join(', ')}`);
});

