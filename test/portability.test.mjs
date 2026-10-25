// Real rc.2 Host on this OS; Windows paths are simulated, not Windows execution.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, rm } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createScope } from '@deepseek-ai/dsh-scope';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { dataRoot, WorkshopStore } from '../src/store.js';
import { ToolCatalog } from '../src/catalog.js';
import { PresetWorkshop } from '../src/index.js';
import { host } from './host-harness.mjs';

for (const value of [undefined, '', '   ', '~', '~/workshop-home', '~\\workshop-home', './relative-home']) {
  const env = value === undefined ? {} : { DSH_HOME: value };
  assert.equal(dataRoot(env), join(resolveDshHome(undefined, env), 'preset-workshop'), `DSH_HOME=${JSON.stringify(value)}`);
}
console.log('PASS: plugin data root follows official DSH_HOME rules, including tilde and blank overrides');
const windowsPath = 'C:\\Users\\Test User\\插件 # %\\src\\scope.js';
assert.equal(pathToFileURL(windowsPath, { windows: true }).pathname, '/C:/Users/Test%20User/%E6%8F%92%E4%BB%B6%20%23%20%25/src/scope.js');
assert.equal(win32.join(win32.resolve('C:\\Users\\Test User\\.dsh'), 'preset-workshop'), 'C:\\Users\\Test User\\.dsh\\preset-workshop');
console.log('PASS: simulated Windows drive paths and file URLs preserve spaces, Unicode, # and %');

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
for (const platform of ['darwin', 'win32', 'linux']) {
  const root = await mkdtemp(join(tmpdir(), 'workshop-shell-simulation-'));
  try {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
    const imports = [], rows = ['bash', 'pwsh', 'bash-persistent', 'pwsh-persistent'].map(name => ({ options: { name: '@deepseek-ai/dsh-tool-' + name, disabled: true, config: {} }, parent: { tree: { ctx: {} } } }));
    const catalog = new ToolCatalog({ loader: { entries: () => rows, root: { tree: { async import(name) { imports.push(name); } } } }, tools: { schemas: () => [] }, logger: { warn() {} } }, root);
    catalog.discover = async pkg => [{ name: pkg.name.slice('@deepseek-ai/dsh-tool-'.length), package: pkg.name, available: true }];
    await catalog.scan();
    const shell = platform === 'win32' ? 'pwsh' : 'bash', opposite = shell === 'pwsh' ? 'bash' : 'pwsh';
    assert.ok(imports.includes('@deepseek-ai/dsh-tool-' + shell));
    assert.ok(!imports.includes('@deepseek-ai/dsh-tool-' + opposite));
    assert.ok(!imports.includes('@deepseek-ai/dsh-tool-' + opposite + '-persistent'));
    const store = new WorkshopStore(root);
    await store.init();
    assert.equal(store.state.presets[0].tools.enabled.length, 8);
    assert.ok(store.state.presets[0].tools.enabled.includes(shell));
    assert.ok(!store.state.presets[0].tools.enabled.includes(opposite));
    const fresh = PresetWorkshop.prototype.freshPreset.call({ catalog }, 'fresh');
    assert.ok(fresh.tools.enabled.includes(shell));
    const intentional = { ...store.state.presets[0], tools: { enabled: ['read'], packages: [], overrides: {} } };
    await store.save({ config: store.state.config, presets: [intentional] });
    const restart = new WorkshopStore(root);
    await restart.init();
    assert.deepEqual(restart.state.presets[0].tools.enabled, ['read']);
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    await rm(root, { recursive: true, force: true });
  }
}
console.log('PASS: simulated macOS/Windows/Linux catalog excludes mismatched shell consumers; eight default tools select the native shell without rewriting saved choices');

const install = await mkdtemp(join(tmpdir(), 'workshop-package-portability-'));
const packageRoot = join(install, '插件 # %');
const { ctx, home } = await host();
try {
  await mkdir(packageRoot);
  for (const path of ['src', 'assets', 'package.json', 'cordis.patch.yml']) await cp(new URL('../' + path, import.meta.url), join(packageRoot, path), { recursive: true });
  for (const name of ['js-yaml', 'argparse']) await cp(new URL('../node_modules/' + name, import.meta.url), join(packageRoot, 'node_modules', name), { recursive: true, dereference: true });
  const plugin = await import(pathToFileURL(join(packageRoot, 'src', 'index.js')).href);
  await ctx.plugin(plugin, {}).await();
  await ctx.presetWorkshop.ready;
  assert.equal(ctx.get('webServer'), undefined);
  assert.ok((await ctx.agentPresets.list()).some(p => p.id === 'preset_workshop' && !p.broken));
  const initialSessions = ctx.sessions.list().length;
  const initialEntries = [...ctx.loader.entries()].length;
  for (let i = 0; i < 6; i++) {
    const preview = await ctx.presetWorkshop.preview({ id: 'preset_workshop', draft: { prompt: { persona: `Round ${i} {{cwd}}`, sections: {} } } });
    assert.ok(preview.prompt.includes(`Round ${i}`));
    assert.equal(preview.tools.length, 8);
  }
  assert.equal(ctx.sessions.list().length, initialSessions);
  assert.equal([...ctx.loader.entries()].length, initialEntries);
  console.log('PASS: Unicode installation starts without webServer; detached previews do not publish sessions or retain loader rows');

  const parent = createScope(ctx, {});
  const child = createScope(parent.ctx, {});
  let cleaned = false;
  child.ctx.effect(() => () => { cleaned = true; });
  await parent.dispose();
  assert.equal(cleaned, true);
  console.log('PASS: disposing a native parent scope awaits descendant effects');

  const failure = new Error('portability-listener-failure');
  const stop = ctx.on('agent/created', async () => { await Promise.resolve(); throw failure; });
  try {
    await assert.rejects(ctx.agents.create({ sessionId: 'listener-failure', meta: { cwd: home, agentPreset: 'preset_workshop' }, agentOptions: { provider: 'test', model: 'test-model' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'preset_workshop'); } }), error => error === failure);
    assert.equal(ctx.agents.get('listener-failure'), undefined);
    assert.equal(ctx.sessions.list().length, initialSessions);
  } finally { stop(); }
  console.log('PASS: native async agent/created failures are awaited and roll back agent/session publication');

  const routes = new Map();
  ctx.provide('webServer', { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } });
  await ctx.fiber.await();
  const source = await readFile(join(packageRoot, 'src', 'client.html'));
  const chunks = [];
  await routes.get('/preset-workshop/client.html')({ method: 'GET' }, { writeHead(status) { assert.equal(status, 200); }, end(body) { chunks.push(body); } });
  assert.deepEqual(Buffer.concat(chunks), source);
  assert.ok(routes.has('/preset-workshop/icon.png'));
  console.log('PASS: late optional Web service serves package-relative assets from encoded install paths');
} finally {
  await ctx.fiber.dispose();
  await rm(home, { recursive: true, force: true });
  await rm(install, { recursive: true, force: true });
}
