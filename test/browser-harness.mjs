// Optional interactive check against a real isolated host; no profile installation.
import { createServer } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { host } from './host-harness.mjs';
import * as plugin from '../src/index.js';
import { defineTool } from '@deepseek-ai/dsh-tools';

const { ctx, home } = await host({ personaSuffix: 'Your working directory is {{cwd}}.' });
const routes = new Map();
ctx.provide('webServer', { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } });
await ctx.plugin(plugin, {}).await();
await ctx.presetWorkshop.ready;
const preset = ctx.presetWorkshop.preset('preset_workshop');
await ctx.presetWorkshop.action({ action: 'mcp-create', id: preset.id, revision: preset.revision, server: { serverName: 'ui_fixture', transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-probe-server.mjs', import.meta.url))], env: {}, cwd: home } });
const afterStdio = ctx.presetWorkshop.preset(preset.id);
await ctx.presetWorkshop.action({ action: 'mcp-create', id: preset.id, revision: afterStdio.revision, server: { serverName: 'ui_http_fixture', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'fixture-secret-value', 'X-Workshop-Check': 'fixture-header-visible' } } });
const skillPath = join(home, 'SKILL.md');
await writeFile(skillPath, '---\nname: check-skill\ndescription: Isolated UI test\n---\n' + '# Original isolated skill body\n\n'.repeat(70));
ctx.skills.register({ name: 'check-skill', description: 'A long skill description for bounded scrolling. '.repeat(70), content: '# Original isolated skill body\n\n'.repeat(70).trim() + '\n\nProvider-only addition', source: 'test', path: skillPath });
for (let index = 0; index < 25; index++) {
  ctx.skills.register({ name: 'list-skill-' + index, description: 'Isolated list scrolling fixture', content: 'Test only', source: 'test' });
  ctx.tools.register(defineTool({ name: 'list_tool_' + index, description: 'Isolated list scrolling fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => 'test only' }));
}
await ctx.presetWorkshop.action({ action: 'scan' });
const activeAgent = await ctx.agents.create({ sessionId: 'review-active-session', meta: { cwd: home, agentPreset: 'preset_workshop' }, agentOptions: { provider: 'test', model: 'test-model' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'preset_workshop'); } });
const sandbox = await ctx.loader.root.tree.import('@deepseek-ai/dsh-sandbox-policy');
sandbox.setSandboxMode(activeAgent.agent.session, 'danger-full-access');
await writeFile(join(home, 'AGENTS.md'), 'Instructions from an isolated workspace');
const themeSource = await readFile(join(process.env.DSH_TEST_RUNTIME, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8');
const themeCSS = JSON.parse(themeSource.match(/var design_platform_css_default = ("(?:\\.|[^"\\])*");/)[1]);
const page = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/host-theme.css"><style>body{margin:0;background:var(--dsw-alias-bg-base);font:14px sans-serif;color:var(--dsw-alias-label-primary)}#card{width:min(720px,calc(100% - 32px));margin:24px auto}button{font:inherit}</style></head><body><div id="harness-controls"><button id="language">English / 中文</button><button id="theme">Theme</button><button id="injections">Toggle plugin sections</button></div><div id="card"></div><script>
// React's slot boundary is mocked; the actual client DOM/controller is unchanged.
const effects=[],listeners=[];let active='zh';let contributions=[];
const ctx={get(name){if(name==='uiSession')return{current:{getSnapshot:()=>({key:'review-active-session'})}};},effect(fn){effects.push(fn());},locale:{getSnapshot:()=>({active}),subscribe(fn){listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},register(){return()=>{};},bind(){return()=>active==='zh'?'预设工坊':'Preset Workshop';}},slots:{inject(name,fn){fn();},register(options,component){contributions.push([options,component]);return()=>{};}}};
const react={useRef(){return{current:document.getElementById('card')};},useEffect(fn){effects.push(fn());},createElement(){}};
window.__ModuleLoader__={load(module){const plugin=module.factory(name=>{if(name!=='react')throw Error(name);return react;});plugin.apply(ctx);contributions.find(row=>row[0].name==='settings.section')[1]();}};
document.getElementById('language').onclick=()=>{active=active==='zh'?'en':'zh';listeners.forEach(fn=>fn());};
document.getElementById('theme').onclick=()=>document.body.toggleAttribute('data-ds-dark-theme');
document.getElementById('injections').onclick=async()=>{await fetch('/test-injections',{method:'POST'});};
</script><script src="/client.js"></script></body></html>`;
let injected = [];
let fullPermission = true;
const server = createServer(async (req, res) => {
  if (routes.has(req.url)) return routes.get(req.url)(req, res);
  if (req.url === '/test-policy' && req.method === 'POST') { fullPermission = !fullPermission; sandbox.setSandboxMode(activeAgent.agent.session, fullPermission ? 'danger-full-access' : 'read-only'); res.end('ok'); return; }
  if (req.url === '/test-injections' && req.method === 'POST') {
    if (injected.length) { injected.forEach(dispose => dispose()); injected = []; }
    else injected = ['one', 'two'].map((id, index) => ctx.systemPrompt.section({ name: 'test-plugin:' + id, order: 100 + index, text: id + ' plugin instructions' }));
    res.end('ok'); return;
  }
  if (req.url === '/reference.html' && process.env.STUDIO_REFERENCE_HTML) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(await readFile(process.env.STUDIO_REFERENCE_HTML, 'utf8')); return; }
  if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../src/client.js', import.meta.url))); return; }
  if (req.url === '/host-theme.css') { res.setHeader('content-type', 'text/css'); res.end(themeCSS); return; }
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log('Isolated UI: http://127.0.0.1:' + server.address().port);
console.log('Temporary DSH_HOME: ' + home);
let closing = false;
async function stop() { if (closing) return; closing = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); process.exit(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
