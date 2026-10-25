import { Context } from '@deepseek-ai/cordis';
import { Loader, Group } from '@deepseek-ai/cordis-plugin-loader';
import yaml from 'js-yaml';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export async function host({ profile = false, personaSuffix = '' } = {}) {
  const runtime = process.env.DSH_TEST_RUNTIME;
  const home = await mkdtemp(join(tmpdir(), 'preset-workshop-host-test-'));
  process.env.DSH_HOME = home;
  process.env.DSH_AGENTS_HOME = join(home, 'agents');
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ __jsExpr: value }) }));
  const load = async file => yaml.load(await readFile(join(runtime, 'node_modules/@deepseek-ai', file), 'utf8'), { schema });
  const patches = await load('dsh-base/cordis.patch.yml');
  const rows = patches.flatMap(patch => patch.insert ?? []);
  const skip = /^(plugin-manager|hmr|config-editor|settings|deepseek-account|credentials|authorization|llm-deepseek|llm-pi-ai|otel|session-telemetry|session-title-llm|goal-round-driver|compaction|image-offload|token-meter|spill|workflow-ptc|ptc-runtime|session-projection-cache|storage|attachment-local|deepseek-llm-api-extensions|mcp-resources)/;
  for (const row of rows) {
    if (skip.test(row.id) || row.id.startsWith('tool-') || ['session-log-deepseek', 'plugin-package-inventory-deepseek', 'plan-mode', 'agent-instructions', 'skill-filesystem', 'command-goal', 'command-compact', 'session-checkpoint-policy'].includes(row.id)) row.disabled = true;
    if (row.id === 'system-prompt') row.config = { ...row.config, personaSuffix };
    if (row.id === 'agent-default-model') row.config = { provider: 'test', model: 'test-model' };
    if (profile && ['config-editor', 'settings'].includes(row.id)) row.disabled = false;
  }
  rows.push({ id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'preset_workshop' } });
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(join(runtime, 'package.json')).href;
  ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(runtime, 'package.json')).href }).await();
  ctx.loader.builtins.group = Group;
  if (profile) {
    const dir = join(home, 'profiles', 'test');
    await mkdir(dir, { recursive: true });
    const patchPath = join(dir, 'cordis.patch.yml');
    const installAnchor = join(runtime, 'package.json');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'workshop-test-profile', private: true, dsh: { profile: { bundles: [] } } }));
    await writeFile(patchPath, yaml.dump([{ insert: rows }]));
    const configPath = join(home, 'empty.yml');
    await writeFile(configPath, '[]\n');
    ctx.provide('profileContext', { name: 'test', home, dir, patchPath, installAnchor, overlays: [] });
    const { mountRootInclude } = await ctx.loader.root.tree.import('@deepseek-ai/dsh-app-boot');
    await mountRootInclude(ctx, configPath, [{ insert: rows }], pathToFileURL(installAnchor).href);
  } else await ctx.loader.root.update(rows);
  await ctx.loader.await();
  const diagnostics = [...ctx.loader.entries()].filter(entry => !entry.disabled && entry.fiber?.state !== 2).map(entry => `${entry.id}: ${entry.fiber?.state}`);
  if (diagnostics.length) throw new Error('Host did not activate: ' + diagnostics.join(', '));
  return { ctx, home };
}
