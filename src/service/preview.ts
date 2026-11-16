import { createScope, scopeParentOf } from "@deepseek-ai/dsh-scope";
import { mountRows } from "../runtime/scope.js";
import { PERSONA_SECTIONS, AGENT_SECTION, TOOL_GUIDANCE, TIME_CONTEXT, USER_RUNTIME, USER_CWD, MCP_CLIENT_MODULE, fail, record, validateToolJSON, functionSchema, filterMcpSections, isLegacyCwdSection, splitRuntimeContext, renderRuntimeContextMessage } from "../domain/core.js";
import type { PromptSection, ToolOverride } from "../domain/types.js";
import type { PresetWorkshop } from "./index.js";
import type { HostContext } from '../runtime/host.js';

export async function preview(this: PresetWorkshop, input, value?) {
    let preset = value ?? this.preset(input.id);
    let toolSet;
    if (input.draft) { record(input.draft, 'draft'); preset = await this.validatedPreset({ ...preset, ...input.draft }, preset); }
    await this.catalog.prepare(preset);
    const configuredToolNames = [...preset.tools.enabled];
    const useDraft = Boolean(input.draft) || !preset.enabled;
    const lease = useDraft ? undefined : await this.ctx.agentPresets.acquireScope(preset.id);
    const key = {};
    const scope = createScope(this.ownerCtx, key, { parent: lease?.key });
    this.previewPolicies.set(key, preset);
    try {
      if (useDraft) await mountRows(scope.ctx, this.definition(preset).plugins);
      preset = this.effectivePolicy(preset, key);
      this.previewPolicies.set(key, preset);
      const allowed = new Set(preset.tools.enabled);
      const live = input.sessionId && this.ctx.agents.get(input.sessionId);
      if (input.sessionId && !live) fail('session-not-found', 'Preview session is not open', 404);
      const defaults = [...this.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-default-model')?.options.config ?? {};
      const cwd = live ? this.workingDirectory(live.session) : input.cwd || this.ctx.get('workingDirectory')?.defaultDirectory || process.cwd();
      const session = live?.session ?? this.previewSession(cwd, preset.id);
      const currentSelection = live?.model.current();
      const modelSelection = {
        provider: input.provider || currentSelection?.provider || live?.options.provider || defaults.provider,
        model: input.model || currentSelection?.model || live?.options.model || defaults.model,
        ...!input.provider && !input.model && currentSelection?.reasoningEffort !== undefined ? { reasoningEffort: currentSelection.reasoningEffort } : {},
      };
      // A child boundary filters the tools registered on the draft's own scope too.
      const viewKey = {};
      const view = createScope(scope.ctx, viewKey, { parent: key });
      const viewCtx = view.ctx as HostContext;
      const model = { current: () => ({ ...modelSelection }) };
      Object.assign(viewKey, { id: session.id, ctx: view.ctx, options: { provider: modelSelection.provider, model: modelSelection.model }, session, model });
      this.previewPolicies.set(viewKey, preset);
      const mcpToolNames = tool => tool.name.startsWith('mcp__');
      const availableMcpTools = this.ctx.tools.schemas(key).filter(tool => {
        if (!mcpToolNames(tool)) return false;
        const server = this.mcpServerForTool(tool.name, preset);
        return !server || this.mcpServerEnabled(preset, server.serverName);
      }).map(functionSchema);
      viewCtx.tools.restrict({ allow: this.ctx.tools.schemas(key).map(t => t.name).filter(name => name !== 'run_code' && allowed.has(name)) });
      for (const [name, configured] of Object.entries((preset.tools.overrides ?? {}) as Record<string, ToolOverride>)) {
        const override = configured?.schema;
        const source = override && this.ctx.tools.get(name, key);
        if (!allowed.has(name) || !source || !override) continue;
        validateToolJSON(override, name, functionSchema(source));
        const when = this.toolActivation(name, key, source);
        viewCtx.tools.register({ ...source, description: override.function.description, parameters: structuredClone(override.function.parameters) }, {
          when: ({ agent, modelSelection, signal }) => this.toolSourceAdmitted(name, when, live ?? agent, modelSelection, signal),
        });
      }
      let toolManagementPrompt = '', timePrompt = '';
      if (live && Array.isArray(session.surface?.nodes) && typeof session.eventAt === 'function') {
        const seen = new Set();
        for (const seq of session.surface.nodes.map(Number).filter(Number.isFinite).sort((a, b) => b - a)) {
          let event;
          try { event = session.eventAt(seq); } catch { continue; }
          const kind = event?.data?.source?.kind;
          if (event?.type !== 'user/message' || !['prompt-manager-catalog', 'time-context'].includes(kind) || seen.has(kind)) continue;
          seen.add(kind);
          if (event.data.source.form === 'notice') continue;
          const text = (event.data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n\n');
          if (kind === 'time-context') timePrompt = text; else toolManagementPrompt = text;
        }
      }
      // Use an unregistered Session so the official defaults can seed it safely.
      if (!live) this.ctx.get('permissionPresets')?.pinInitialPermission(session);
      const signal = new AbortController().signal;
      const agent = viewKey as { options: { provider: string; model: string } };
      toolSet = await this.ctx.tools.resolve({ agent, modelSelection, signal });
      const context: { scope: object; agent: typeof agent; modelSelection: typeof modelSelection; signal: AbortSignal; toolSet: any; workshopPreview: any; workshopSourceAssembly?: any } = { scope: viewKey, agent, modelSelection, signal, toolSet, workshopPreview: preset };
      // The official file-reference service registers this on agent/created.
      // A detached preview never fires that lifecycle; use its exported text
      // at its native placement without publishing a fake Agent or Session.
      if (this.ctx.get('fileReferences') && !this.ctx.systemPrompt.layers.merge(viewKey, layer => layer.sections).has('context:file-reference')) viewCtx.systemPrompt.section({ name: 'context:file-reference', order: this.ctx.systemPrompt.getSectionOrder('FILE_REFERENCE'), text: allowed.has('read') ? this.fileReferencePrompt : '' });
      const assembly = await this.ctx.systemPrompt.assemble(context);
      const sourceSections = this.ctx.systemPrompt.layers.merge(viewKey, layer => layer.sections);
      const sections = assembly.sections.map((section, index) => ({ ...section, order: section.name === 'preset-workshop:persona' ? -1000 : preset.prompt.sections[section.name]?.order ?? sourceSections.get(section.name)?.order ?? index * 100 }));
      const editableSections = new Map<string, any>((context.workshopSourceAssembly?.sections ?? []).filter(section => !PERSONA_SECTIONS.has(section.name)).map((section, index) => [section.name, { ...section, order: sourceSections.get(section.name)?.order ?? index * 100, enabled: true, ...(section.name.startsWith('tool:') ? { managedBy: 'tools', enabled: sections.some(active => active.name === section.name) } : {}) }]));
      for (const [name, section] of Object.entries(preset.prompt.sections as Record<string, PromptSection>)) if (section.custom || name === 'deployment:persona-suffix' || editableSections.get(name)?.text?.trim()) editableSections.set(name, { name, ...section, ...(section.inherit ? { text: editableSections.get(name)?.text ?? '' } : {}) });
      for (const section of sections) if (section.name.startsWith('tool:') && !editableSections.has(section.name)) editableSections.set(section.name, { ...section, managedBy: 'tools', enabled: true });
      const registry = this.scopes.get(useDraft ? key : lease.key)?.ctx.skills;
      const skillSnapshot = registry ? await registry.snapshot({ cwd, scope: viewKey }) : { skills: [], complete: true };
      const skills = skillSnapshot.skills;
      const prompt = this.renderPrompt(assembly);
      const contexts = this.renderContextSections(assembly);
      const runtimeContext = this.renderContextSnapshot(assembly);
      const runtimeContextSource = this.renderContextSnapshot(context.workshopSourceAssembly ?? assembly);
      const sourceContext = splitRuntimeContext(runtimeContextSource);
      const currentContext = splitRuntimeContext(runtimeContext);
      let runtimeContextWorkingDirectory = sourceContext.workingDirectory || currentContext.workingDirectory;
      const runtimeContextHeader = /^Current runtime context\. This snapshot supersedes earlier runtime-context snapshots\./i.exec(runtimeContext)?.[0];
      if (runtimeContextHeader && runtimeContextWorkingDirectory && !runtimeContextWorkingDirectory.startsWith(runtimeContextHeader)) {
        runtimeContextWorkingDirectory = `${runtimeContextHeader} ${runtimeContextWorkingDirectory}`;
      }
      const runtimeEnabled = preset.prompt.sections[USER_CWD]?.enabled !== false && preset.prompt.sections[USER_RUNTIME]?.enabled !== false;
      const runtimeContextEnvironmentSource = runtimeEnabled ? renderRuntimeContextMessage(runtimeContextSource) : '';
      const runtimeContextEnvironment = runtimeEnabled ? renderRuntimeContextMessage(runtimeContext) : '';
      const agentInstructions = await this.workspaceInstructions(cwd, view.ctx, preset);
      const tools = assembly.tools.map(functionSchema);
      const skillMessage = registry ? await this.previewSkillCatalog(registry, viewKey, cwd, tools.some(tool => tool.function.name === 'skill')) : undefined;
      const skillCatalog = skillMessage?.source.entries ?? [];
      const skillWarnings = tools.some(tool => tool.function.name === 'skill') ? preset.skills.filter(name => !skillCatalog.some(entry => entry.name === name)) : [];
      const skillPrompt = skillMessage?.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n') ?? '';
      const catalog = this.catalog.forPreset(preset);
      const mcpTools = tools.filter(tool => mcpToolNames(tool.function));
      const mcpServers = [...new Map<string, any>([
        ...((this.catalog.mcpServers ?? []).map(server => [server.serverName, { ...server, config: this.catalog.mcpConfigs?.get(server.serverName), source: 'global', enabled: this.mcpServerEnabled(preset, server.serverName) }])),
        ...((preset.mcp ?? []).map(server => [server.serverName, { ...server, source: 'preset', enabled: server.enabled !== false, connection: this.mcpStates.get(useDraft ? key : lease.key)?.get(server.serverName) ?? { state: server.enabled === false ? 'disabled' : 'connecting' } }])),
      ]).values()];
      const mcpServerForTool = name => mcpServers.filter(server => server.source !== 'unknown' && name.startsWith(`mcp__${server.serverName}__`)).sort((a, b) => b.serverName.length - a.serverName.length)[0];
      const unidentifiedMcpTools = availableMcpTools.filter(tool => !mcpServerForTool(tool.function.name));
      if (unidentifiedMcpTools.length) mcpServers.push({ serverName: '', source: 'unknown', tools: unidentifiedMcpTools });
      for (const tool of availableMcpTools) {
        const server = mcpServerForTool(tool.function.name);
        catalog.push({ name: tool.function.name, kind: 'mcp', mcpServer: server?.serverName, ...(server ? { package: MCP_CLIENT_MODULE } : {}), light: true, available: true, schema: tool, sections: [`tool:${tool.function.name}`], prompt: '' });
      }
      const toolSections = new Set(catalog.flatMap(tool => tool.sections ?? []));
      const supplemental = filterMcpSections([...editableSections.values()], preset).filter(section => section.role !== 'user' && section.text?.trim() && ![AGENT_SECTION, TOOL_GUIDANCE, TIME_CONTEXT].includes(section.name) && !(assembly.contexts.some(context => context.name === 'working-directory:current') && isLegacyCwdSection(section))).map(section => ({ ...section, ...(toolSections.has(section.name) || section.name.startsWith('tool:') ? { managedBy: 'tools' } : {}), renderedText: section.enabled ? this.renderPrompt({ ...assembly, sections: [section] }) : section.text, editable: section.editable !== false, reorderable: section.reorderable !== false }));
      const guidanceSections = sections.filter(section => section.name.startsWith('tool:') || toolSections.has(section.name));
      const selectedToolSections = new Set(catalog.filter(tool => allowed.has(tool.name)).flatMap(tool => tool.sections ?? []));
      const guidanceMembers = supplemental.filter(section => section.managedBy === 'tools' && (selectedToolSections.has(section.name) || allowed.has(section.name.slice(5))));
      if (guidanceMembers.length) supplemental.push({ name: TOOL_GUIDANCE, text: this.renderPrompt({ ...assembly, sections: guidanceSections }), order: preset.prompt.sections[TOOL_GUIDANCE]?.order ?? Math.min(...guidanceMembers.map(section => section.order)), enabled: preset.prompt.sections[TOOL_GUIDANCE]?.enabled ?? true, members: guidanceMembers, managedBy: 'tool-guidance', editable: true, reorderable: true });
      const personaSections = assembly.sections.filter(section => PERSONA_SECTIONS.has(section.name)).map(section => ({ name: section.name, text: section.text, renderedText: this.renderPrompt({ ...assembly, sections: [section] }), editable: false }));
      const agentText = agentInstructions.requestText;
      const regularTools = tools.filter(tool => !mcpTools.includes(tool));
      const timeEnabled = preset.prompt.sections[TIME_CONTEXT]?.enabled !== false;
      timePrompt = timeEnabled ? (timePrompt || await this.previewTimeContext(cwd)) : '';
      const userBlocks = [
        { name: 'AGENTS', text: agentText, order: -2 },
        { name: '环境', text: runtimeContextEnvironment, order: 0 },
        { name: 'SKILL', text: skillPrompt, order: 100 },
        { name: '时间与时区', text: timePrompt, order: 200 },
        { name: '提示词管理（会话实况）', text: toolManagementPrompt, order: 250 },
        ...Object.entries(preset.prompt.sections as Record<string, PromptSection>).filter(([, section]) => section.custom && section.role === 'user' && section.enabled).map(([name, section], index) => ({ name, text: section.text, order: 400 + index })),
      ].filter(block => block.text?.trim()).sort((a, b) => a.order - b.order);
      const displayPrompt = ['# System\n\n' + prompt,
        '# User\n\n' + (input.language === 'en' ? '[First user message · placeholder only; Preset Workshop does not edit conversation messages.]' : '［用户第一句话 · 仅作占位，预设工坊不修改会话消息。］'),
        ...userBlocks.map(block => `## ${block.name}\n\n${block.text}`),
        regularTools.length ? '# 工具\n\n## TOOL\n\n' + regularTools.map(tool => tool.function.name + '：' + tool.function.description).join('\n\n') : '',
        mcpTools.length ? '## MCP\n\n' + mcpTools.map(tool => tool.function.name + '：' + tool.function.description).join('\n\n') : ''].filter(Boolean).join('\n\n');
      const liveMatches = live && this.ctx.agentPresets.composedPreset(live.ctx) === preset.id;
      let liveAssembly, runtimeError;
      if (liveMatches) {
        try { liveAssembly = await this.ctx.systemPrompt.assemble({ scope: live, agent: live }); }
        catch (error) { runtimeError = error.message; }
      }
      let runtime;
      if (liveMatches) {
        let livePrompt = '';
        if (liveAssembly) {
          try { livePrompt = this.renderPrompt(liveAssembly); }
          catch (error) { runtimeError = error.message; }
        }
        const available = new Set(catalog.map(tool => tool.name));
        const candidates = new Set([...tools.map(tool => tool.function.name), ...configuredToolNames.filter(name => available.has(name))]);
        runtime = { sessionId: live.id, tools: liveAssembly?.tools.map(functionSchema) ?? [], prompt: livePrompt, ...(runtimeError ? { error: runtimeError } : {}), pendingTools: liveAssembly ? [...candidates].filter(name => !liveAssembly.tools.some(actual => actual.name === name) || !this.toolSourceMatches(name, scopeParentOf(live), preset)) : [] };
      }
      const mcp = mcpServers.map(server => {
        const toolsForServer = server.source === 'unknown'
          ? server.tools
          : availableMcpTools.filter(tool => mcpServerForTool(tool.function.name)?.serverName === server.serverName);
        const cached = server.enabled !== false && server.source !== 'preset' && server.source !== 'unknown'
          ? catalog.filter(tool => tool.kind === 'mcp' && tool.mcpServer === server.serverName && !tool.available && tool.schema).map(tool => ({ ...tool.schema, function: { ...tool.schema.function, unavailable: true } }))
          : [];
        const known = new Set([...toolsForServer, ...cached].map(tool => tool.function.name));
        const saved = configuredToolNames.filter(name => !known.has(name) && mcpServerForTool(name)?.serverName === server.serverName).map(name => ({ name, description: '', unavailable: true }));
        return { ...server, tools: [...toolsForServer, ...cached, ...saved] };
      });
      const userSections = [
        { name: TIME_CONTEXT, text: timePrompt, enabled: timeEnabled, toggleable: true, reorderable: true, order: preset.prompt.sections[TIME_CONTEXT]?.order ?? 200 },
        ...(toolManagementPrompt ? [{ name: 'prompt-manager-catalog', text: toolManagementPrompt, source: 'dsh-plugin-tool-management' }] : []),
      ].map(section => ({ ...section, managedBy: 'host', editable: false, reorderable: false, delivery: 'user-message' }));
      const tokenSource = [prompt, displayPrompt, agentText, JSON.stringify(assembly.tools)].join('\n');
      const cjkCount = [...tokenSource.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)].length;
      const otherCount = [...tokenSource].length - cjkCount;
      const estimatedTokenRange = { min: Math.ceil(cjkCount + otherCount / 4), max: Math.ceil(cjkCount * 2 + otherCount / 4), method: 'CJK characters × 1–2; other characters ÷ 4' };
      return { prompt, displayPrompt, runtime, sections, editableSections: supplemental, personaSections, agentInstructions, userSections, skillCatalog, skillPrompt, skillWarnings, runtimeContext, runtimeContextSource, runtimeContextWorkingDirectory, runtimeContextEnvironment, runtimeContextEnvironmentSource, hasWorkingDirectory: Boolean(this.ctx.get('workingDirectory')), contexts, variables: assembly.variables, tools, skills, catalog, mcp, estimatedTokens: Math.ceil((prompt.length + agentText.length + JSON.stringify(assembly.tools).length + runtimeContextEnvironment.length + skillPrompt.length + toolManagementPrompt.length + timePrompt.length) / 4), estimatedTokenRange, cwd, model: agent.options.model, provider: agent.options.provider };
    } finally { toolSet?.dispose(); this.previewPolicies.delete(key); await scope.dispose(); await lease?.[Symbol.asyncDispose](); }
  }
