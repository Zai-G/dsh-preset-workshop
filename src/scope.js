import { scopeOf } from '@deepseek-ai/dsh-scope';
import { transformPrompt, fail, AGENT_SECTION, TIME_CONTEXT, boundSkill } from './core.js';

export const inject = ['presetWorkshop', 'skills', 'systemPrompt', 'sessionProjections'];
export function apply(ctx, config) {
  const workshop = ctx.presetWorkshop;
  // Keep saved expressions literal; only the actual MCP connection evaluates them.
  const preset = JSON.parse(config.preset);
  const key = scopeOf(ctx);
  workshop.scopes.set(key, { ctx, preset, catalog: structuredClone(workshop.catalog.forPreset(preset)) });
  ctx.effect(() => () => workshop.scopes.delete(key));
  // Keep saved templates usable after the host moved cwd into User context.
  if (ctx.get('workingDirectory')) ctx.systemPrompt.variable('cwd', context => context.agent && workshop.workingDirectory(context.agent.session));
  const enabledBySession = new WeakMap(), immediateTimeBySession = new WeakSet();
  const projections = ctx.get('sessionProjections');
  workshop.timeModule.apply(ctx.extend({
    sessionProjections: new Proxy(projections, {
      get(target, property) {
        if (property === 'stateOf') return (session, name) => {
          const state = target.stateOf(session, name);
          return name === 'timeContext' && immediateTimeBySession.has(session) && state ? { ...state, lastInjectionTime: null } : state;
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    on: (event, hook, options) => ctx.on(event, event === 'agent/pre-step' ? async (context, next) => {
      const session = context.agent?.session;
      const enabled = workshop.policyFor(context.agent, preset).prompt.sections[TIME_CONTEXT]?.enabled !== false;
      if (!enabled) {
        if (session) { enabledBySession.set(session, false); immediateTimeBySession.delete(session); }
        return next();
      }
      if (session) {
        if (enabledBySession.get(session) === false) immediateTimeBySession.add(session);
        enabledBySession.set(session, true);
      }
      const output = await hook(context, next);
      if (session && immediateTimeBySession.has(session) && output?.messages?.some(message => message.source?.kind === 'time-context')) immediateTimeBySession.delete(session);
      return output;
    } : hook, options),
  }), {});
  if (workshop.instructions) workshop.instructions.apply(ctx.extend({
    workingDirectory: ctx.get('workingDirectory'),
    get: (name, ...args) => name === 'fs' ? workshop.directoryFileSystem(ctx.get('fs')) : ctx.get(name, ...args),
  }), workshop.instructionConfig());
  ctx.skills.registerProvider(() => ({
    name: 'preset-workshop',
    async list(options) {
      const allowed = new Set(workshop.policyFor(options.scope ?? key, preset).skills);
      const source = await workshop.sourceSkills(options.cwd, options.signal);
      const selected = source.skills.filter(skill => allowed.has(skill.name));
      return { candidates: selected.map(skill => ({ ...boundSkill(skill), provider: 'preset-workshop', rank: 0, locator: skill.name })), complete: [...allowed].every(name => selected.some(skill => skill.name === name)) };
    },
    async get(candidate, options) {
      if (!workshop.policyFor(options.scope ?? key, preset).skills.includes(candidate.name)) return undefined;
      const skill = await workshop.getSourceSkill(candidate.name, options.cwd, options.signal);
      return skill && boundSkill(skill);
    },
  }));
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const output = await next();
    if (output.kind === 'reject') return output;
    const policy = workshop.policyFor(agent, preset);
    const visible = agent.session.surface.nodes.map(seq => agent.session.eventAt(seq)).filter(event => event?.type === 'user/message').map(event => event.data);
    if (policy.skills.length && policy.tools.enabled.includes('skill')) {
      const snapshot = await ctx.skills.snapshot({ cwd: workshop.workingDirectory(agent.session), scope: agent, signal });
      const catalog = [...visible, ...output.messages].findLast(message => message.source.kind === 'skill-catalog');
      const missing = policy.skills.filter(name => !snapshot.skills.some(skill => skill.name === name) || !catalog?.source.entries?.some(entry => entry.name === name));
      if (missing.length) fail('skill-context-unavailable', `Selected skills could not enter the AI context: ${missing.join(', ')}. Check the skill sources and retry.`, 503);
    }
    const global = await workshop.workspaceInstructions(workshop.workingDirectory(agent.session), agent.ctx, policy, false);
    const edit = policy.prompt.sections[AGENT_SECTION];
    const prior = visible.filter(message => message.source.kind === 'preset-workshop-global-instructions');
    const last = output.messages.findLast(message => message.source.kind === 'preset-workshop-global-instructions') ?? prior.at(-1);
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
export async function mountRows(ctx, rows, timeoutMs = 0) {
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
  let timer;
  try {
    const startup = (async () => {
      await tree.root.update(prepareProfileEntries(ctx, rows, ctx.baseUrl));
      const audit = await auditRows(tree);
      const leaks = leakedServices(ctx, ctx.fiber);
      if (audit.failed.length || audit.pending.length || leaks.length) fail('composition-unavailable', [...audit.failed, ...audit.pending, ...leaks.map(name => `Service ${name} requires an isolate realm`)].join('\n'), 503);
      return tree;
    })();
    return timeoutMs ? await Promise.race([startup, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('MCP connection timed out (15 seconds)')), timeoutMs); })]) : await startup;
  } catch (error) { await tree.root.stop(); throw error; }
  finally { clearTimeout(timer); }
}
