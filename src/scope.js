import { scopeOf } from '@deepseek-ai/dsh-scope';
import { transformPrompt, fail, AGENT_SECTION, boundSkill } from './core.js';

export const inject = ['presetWorkshop', 'skills', 'systemPrompt', 'sessionProjections'];
export function apply(ctx, config) {
  const workshop = ctx.presetWorkshop;
  const preset = structuredClone(config.preset);
  const key = scopeOf(ctx);
  workshop.scopes.set(key, { ctx, preset, catalog: structuredClone(workshop.catalog.forPreset(preset)) });
  ctx.effect(() => () => workshop.scopes.delete(key));
  if (workshop.instructions) workshop.instructions.apply(ctx.extend({
    get: (name, ...args) => name === 'fs' ? workshop.directoryFileSystem(ctx.get('fs')) : ctx.get(name, ...args),
  }), workshop.instructionConfig());
  ctx.skills.registerProvider(() => ({
    name: 'preset-workshop',
    async list(options) {
      const allowed = new Set(workshop.policyFor(options.scope ?? key, preset).skills);
      const source = await workshop.sourceSkills(options.cwd, options.signal);
      const selected = source.skills.filter(skill => allowed.has(skill.name));
      return { candidates: selected.map(skill => ({ ...boundSkill(skill), provider: 'preset-workshop', rank: 0, locator: skill.name })), complete: source.complete || [...allowed].every(name => selected.some(skill => skill.name === name)) };
    },
    async get(candidate, options) {
      if (!workshop.policyFor(options.scope ?? key, preset).skills.includes(candidate.name)) return undefined;
      const skill = await workshop.getSourceSkill(candidate.name, options.cwd, options.signal);
      return skill && boundSkill(skill);
    },
  }));
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const output = await next();
    if (output.kind === 'reject') return output;
    const policy = workshop.policyFor(agent, preset);
    const global = await workshop.workspaceInstructions(agent.session.header.cwd, agent.ctx, policy, false);
    const edit = policy.prompt.sections[AGENT_SECTION];
    const prior = agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'preset-workshop-global-instructions');
    const last = prior.at(-1)?.data;
    const enabled = global.enabled, text = global.text;
    if ((!enabled || !text) && !prior.length) return output;
    // Replace only user-global authority; native project/subdirectory messages
    // and their incremental reconciliation are never filtered or superseded.
    const content = [{ type: 'text', text: prior.length
      ? enabled && text ? '# AGENT update\nThis replaces only the earlier user-global AGENTS.md instructions. Project and subdirectory instructions remain active.\n\n' + global.renderedText : '# AGENT update\nUser-global AGENT workspace instructions are now disabled for this preset. Disregard only earlier user-global AGENTS.md instructions; project and subdirectory instructions remain active.'
      : global.renderedText }];
    const source = { kind: 'preset-workshop-global-instructions', form: 'instructions', workshopOverride: Boolean(edit), workshopEnabled: enabled, workshopText: text };
    const messages = [...output.messages];
    const unchanged = last && last.source.workshopEnabled === enabled && last.source.workshopText === text;
    if (!unchanged) messages.push(workshop.createUserMessage({ content, source }));
    return { ...output, messages };
  }, { prepend: true });
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const output = await next();
    const policy = context.workshopPreview ?? workshop.effectivePolicy(workshop.policyFor(context.scope, preset), context.scope);
    const definitions = ctx.systemPrompt.layers.merge(context.scope, layer => layer.sections);
    if ([...definitions.values()].some(section => section.complete)) fail('complete-prompt-conflict', 'An inherited complete prompt prevents persona and section editing');
    if (context.workshopPreview) context.workshopSourceAssembly = structuredClone(output);
    return transformPrompt(output, policy, workshop.catalogFor(context.scope, policy), definitions);
  });
}

// Use the same native Loader and audit as the registry, without publishing draft ids.
export async function mountRows(ctx, rows) {
  await ctx.fiber.await();
  const { EntryTree } = await ctx.loader.root.tree.import('@deepseek-ai/cordis-plugin-loader');
  const { prepareProfileEntries } = await ctx.loader.root.tree.import('@deepseek-ai/dsh-app-boot');
  const { auditRows, leakedServices } = await ctx.loader.root.tree.import('@deepseek-ai/dsh-agent-preset-registry');
  const owner = ctx.fiber.entry;
  // EntryTree assigns itself to the owner entry. A temporary probe/draft must
  // not replace the host Loader's persistent subtree bookkeeping.
  const subtree = owner?.subtree;
  const subgroup = owner?.subgroup;
  const tree = new EntryTree(ctx);
  if (owner) {
    if (subtree === undefined) delete owner.subtree; else owner.subtree = subtree;
    if (subgroup === undefined) delete owner.subgroup; else owner.subgroup = subgroup;
  }
  ctx.effect(() => () => tree.root.stop());
  await tree.root.update(prepareProfileEntries(ctx, rows, ctx.baseUrl));
  const audit = await auditRows(tree);
  const leaks = leakedServices(ctx, ctx.fiber);
  if (audit.failed.length || audit.pending.length || leaks.length) fail('composition-unavailable', [...audit.failed, ...audit.pending, ...leaks.map(name => `Service ${name} requires an isolate realm`)].join('\n'), 503);
  return tree;
}
