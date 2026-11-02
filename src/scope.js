import { scopeOf } from '@deepseek-ai/dsh-scope';
import { transformPrompt, fail, AGENT_SECTION, USER_DIRECTORY, TIME_CONTEXT, USER_RUNTIME, boundSkill } from './core.js';

export const inject = ['presetWorkshop', 'skills', 'systemPrompt', 'sessionProjections'];
export const MCP_CONNECT_TIMEOUTS = { stdio: 120000, 'streamable-http': 30000 };
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
    const cwd = workshop.workingDirectory(agent.session);
    const global = await workshop.workspaceInstructions(cwd, agent.ctx, policy, false);
    const edit = policy.prompt.sections[AGENT_SECTION];
    const prior = visible.filter(message => message.source.kind === 'preset-workshop-global-instructions');
    const last = output.messages.findLast(message => message.source.kind === 'preset-workshop-global-instructions') ?? prior.at(-1);
    const enabled = global.enabled, text = global.text;
    let messages = [...output.messages];
    const unchanged = last && last.source.workshopEnabled === enabled && last.source.workshopText === text;
    if ((enabled || prior.length) && !unchanged) {
      const content = [{ type: 'text', text: prior.length
        ? enabled && text ? '# AGENT update\nThis replaces only the earlier user-global AGENTS.md instructions. Project and subdirectory instructions remain active.\n\n' + global.renderedText : '# AGENT update\nUser-global AGENT workspace instructions are now disabled for this preset. Disregard only earlier user-global AGENTS.md instructions; project and subdirectory instructions remain active.'
        : global.renderedText }];
      const source = { kind: 'preset-workshop-global-instructions', form: 'instructions', workshopOverride: Boolean(edit), workshopEnabled: enabled, workshopText: text };
      messages.push(workshop.createUserMessage({ content, source }));
    }
    const previousSkillSuppression = visible.findLast(message => message.source?.kind === 'preset-workshop-user-skill' || message.source?.kind === 'skill-catalog' && typeof message.source.workshopEnabled === 'boolean');
    if (previousSkillSuppression?.source.workshopEnabled === false && policy.skills.length && policy.tools.enabled.includes('skill')) {
      const catalog = await workshop.previewSkillCatalog(ctx.skills, agent, cwd, policy.skills.length > 0 && policy.tools.enabled.includes('skill'));
      if (catalog && !messages.some(message => message.source?.kind === 'skill-catalog')) messages.push({ ...catalog, source: { ...catalog.source, workshopEnabled: true } });
    }
    const directoryEnabled = policy.prompt.sections[USER_DIRECTORY]?.enabled !== false;
    const previousDirectoryToggle = visible.findLast(message => message.source?.kind === 'preset-workshop-directory-instructions');
    const directoryMessages = messages.filter(message => message.source?.kind === 'agent-instructions');
    if (!directoryEnabled) {
      messages = messages.filter(message => message.source?.kind !== 'agent-instructions');
      if ((directoryMessages.length || visible.some(message => message.source?.kind === 'agent-instructions')) && previousDirectoryToggle?.source.workshopEnabled !== false) {
        messages.push(workshop.createUserMessage({ content: [{ type: 'text', text: '# AGENTS update\nDirectory AGENTS instructions are disabled for this preset. Disregard earlier instructions from the current environment\'s AGENTS.md.' }], source: { kind: 'preset-workshop-directory-instructions', workshopEnabled: false } }));
      }
    } else if (previousDirectoryToggle?.source.workshopEnabled === false) {
      const directory = await workshop.workspaceInstructions(cwd, agent.ctx, policy, true);
      if (directory.directoryText) messages.push(workshop.createUserMessage({ content: [{ type: 'text', text: directory.directoryText }], source: { kind: 'preset-workshop-directory-instructions', workshopEnabled: true } }));
    }
    const custom = Object.entries(policy.prompt.sections).filter(([, section]) => section.custom && section.role === 'user' && section.enabled && section.text.trim());
    for (const [name, section] of custom) {
      const priorCustom = visible.findLast(message => message.source?.kind === 'preset-workshop-custom-user' && message.source.name === name);
      const currentText = priorCustom?.source?.text ?? priorCustom?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n\n');
      if (currentText !== section.text) messages.push(workshop.createUserMessage({ content: [{ type: 'text', text: priorCustom ? `# Preset Workshop update\nThis replaces the earlier custom User section “${name}”.\n\n${section.text}` : section.text }], source: { kind: 'preset-workshop-custom-user', name, form: 'user-message', text: section.text } }));
    }
    for (const priorCustom of visible.filter(message => message.source?.kind === 'preset-workshop-custom-user')) {
      const name = priorCustom.source.name, current = policy.prompt.sections[name];
      if (current?.custom && current.role === 'user' && current.enabled && current.text.trim()) continue;
      if (messages.some(message => message.source?.kind === 'preset-workshop-custom-user' && message.source.name === name && message.source.text === '')) continue;
      messages.push(workshop.createUserMessage({ content: [{ type: 'text', text: `# Preset Workshop update\nCustom User section “${name}” is now disabled. Disregard only its earlier content.` }], source: { kind: 'preset-workshop-custom-user', name, form: 'user-message', text: '' } }));
    }
    const order = new Map([[USER_RUNTIME, 0], ['workshop:user-skill', 100], [TIME_CONTEXT, 200], [AGENT_SECTION, 300], ...custom.map(([name], index) => [name, 400 + index]), [USER_DIRECTORY, 10000]]);
    const keyFor = message => message.source?.kind === 'runtime-context' ? USER_RUNTIME : message.source?.kind === 'skill-catalog' ? 'workshop:user-skill' : message.source?.kind === TIME_CONTEXT ? TIME_CONTEXT : message.source?.kind === 'preset-workshop-global-instructions' ? AGENT_SECTION : message.source?.kind === 'preset-workshop-directory-instructions' || message.source?.kind === 'agent-instructions' ? USER_DIRECTORY : message.source?.kind === 'preset-workshop-custom-user' ? message.source.name : undefined;
    const slots = [], movable = [];
    messages.forEach((message, index) => { const key = keyFor(message); if (key && order.has(key)) { slots.push(index); movable.push({ message, index, order: order.get(key) }); } });
    movable.sort((a, b) => a.order - b.order || a.index - b.index);
    slots.forEach((index, position) => { messages[index] = movable[position].message; });
    return { ...output, messages };
  }, { prepend: true });
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const output = await next();
    const policy = context.workshopPreview ?? workshop.effectivePolicy(workshop.policyFor(context.scope, preset), context.scope);
    const contexts = ctx.systemPrompt.layers.merge(context.scope, layer => layer.contexts);
    if (context.workshopPreview) context.workshopSourceAssembly = structuredClone(output);
    if (policy.prompt.sections[USER_RUNTIME]?.enabled === false) {
      output.contexts = output.contexts.filter(entry => contexts.get(entry.name)?.required === true);
      output.sections = output.sections.filter(section => !['harness:source', 'app:web-surface'].includes(section.name));
    }
    const definitions = ctx.systemPrompt.layers.merge(context.scope, layer => layer.sections);
    if ([...definitions.values()].some(section => section.complete)) fail('complete-prompt-conflict', 'An inherited complete prompt prevents persona and section editing');
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
      const entries = [...tree.entries()];
      // Cordis get() checks the outer registry, not a provider in an isolate realm.
      const pending = audit.pending.filter(message => {
        const id = message.slice(0, message.indexOf(' ('));
        const entry = entries.find(item => item.options.id === id);
        return !entry || Object.keys(entry.fiber.inject).some(name => {
          try { return entry.fiber.ctx[name] === undefined; } catch { return true; }
        });
      });
      if (audit.failed.length || pending.length || leaks.length) fail('composition-unavailable', [...audit.failed, ...pending, ...leaks.map(name => `Service ${name} requires an isolate realm`)].join('\n'), 503);
      return tree;
    })();
    return timeoutMs ? await Promise.race([startup, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error(`MCP connection timed out (${timeoutMs / 1000} seconds)`), { code: 'mcp-timeout' })), timeoutMs); })]) : await startup;
  } catch (error) { await tree.root.stop(); throw error; }
  finally { clearTimeout(timer); }
}
