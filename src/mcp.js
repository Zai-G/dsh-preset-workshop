import { createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { isDeepStrictEqual } from 'node:util';
import { validateMcp, MCP_CLIENT_MODULE } from './core.js';
import { mountRows, MCP_CONNECT_TIMEOUTS } from './scope.js';

export const inject = ['presetWorkshop', 'loader', 'tools', 'systemPrompt'];
export function apply(ctx, config) {
  const workshop = ctx.presetWorkshop, key = scopeOf(ctx);
  if (!workshop.mcpStates.has(key)) workshop.mcpStates.set(key, new Map());
  const states = workshop.mcpStates.get(key);
  const status = { state: 'connecting' };
  states.set(config.serverName, status);
  ctx.effect(() => () => { states.delete(config.serverName); if (!states.size) workshop.mcpStates.delete(key); });
  if (workshop.previewPolicies.has(key)) {
    // Drafts borrow only an unchanged, genuinely mounted connection.
    const draft = workshop.previewPolicies.get(key);
    const savedKey = workshop.currentScopes.get(draft.id);
    const saved = workshop.scopeRecord(savedKey);
    const server = saved?.preset.mcp.find(server => server.serverName === config.serverName);
    if (server && server.enabled !== false && isDeepStrictEqual(server, draft.mcp.find(server => server.serverName === config.serverName))) {
      Object.assign(status, workshop.mcpStates.get(savedKey)?.get(config.serverName));
      for (const schema of ctx.tools.schemas(savedKey).filter(tool => workshop.mcpServerForTool(tool.name, saved.preset)?.serverName === config.serverName)) ctx.tools.register(ctx.tools.get(schema.name, savedKey));
      const section = ctx.systemPrompt.layers.merge(savedKey, layer => layer.sections).get(`mcp:${config.serverName}`);
      if (section) ctx.systemPrompt.section(section);
      ctx.inject(['mcpResources'], inner => {
        const resources = inner.mcpResources;
        const provider = resources.layers.merge(savedKey, layer => layer.servers).get(config.serverName);
        if (provider) resources.register(config.serverName, provider);
      });
    } else status.state = 'unsaved';
    return;
  }
  let stopped = false, scope;
  const timer = setTimeout(async () => {
    // The owner joins transport teardown on unload; preset edits need not wait for stdio close.
    scope = createScope(workshop.ownerCtx, key);
    try {
      await mountRows(scope.ctx, [{ id: 'connection', name: MCP_CLIENT_MODULE, config: { ...config, failOnStartupError: true } }], MCP_CONNECT_TIMEOUTS[config.transport] ?? 30000);
      status.state = 'ready';
    } catch (error) { status.state = error.code === 'mcp-timeout' ? 'timeout' : 'error'; status.error = error.message; }
    if (!stopped) {
      workshop.catalogRevision = (workshop.catalogRevision ?? 0) + 1;
      workshop.scheduleRestrictions();
    }
  }, 0);
  ctx.effect(() => () => {
    stopped = true; clearTimeout(timer);
    void scope?.dispose().catch(error => ctx.logger.error(error));
  });
}

export async function probeMcp(ctx, input) {
  const server = validateMcp(input.server);
  const t = (zh, en) => input.language === 'en' ? en : zh;
  const key = {}, scope = createScope(ctx, key);
  let timer;
  try {
    const timeoutMs = MCP_CONNECT_TIMEOUTS[server.transport] ?? 30000;
    await mountRows(scope.ctx, [{ id: 'workshop-mcp-probe', name: MCP_CLIENT_MODULE, config: { ...server, failOnStartupError: true, reconnect: { ...server.reconnect, enabled: false } } }], timeoutMs);
    const tools = ctx.tools.schemas(key).filter(tool => tool.name.startsWith(`mcp__${server.serverName}__`) && ctx.tools.get(tool.name, key) !== ctx.tools.get(tool.name));
    return { ok: true, count: tools.length, message: t(`连接成功 · 发现 ${tools.length} 个工具。未调用工具，也未保存配置。`, `Connected · ${tools.length} tools found. No tools were called and no configuration was saved.`) };
  } catch (error) { return { ok: false, state: error.code === 'mcp-timeout' ? 'timeout' : 'error', message: error.code === 'mcp-timeout' ? t('检测超时：', 'Check timed out: ') + error.message : t('检测失败：', 'Check failed: ') + error.message }; }
  finally { clearTimeout(timer); await scope.dispose(); }
}
