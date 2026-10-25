import { writeFileSync } from 'node:fs';

let pending = '';
process.stdin.setEncoding('utf8');

function respond(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

process.stdin.on('data', chunk => {
  pending += chunk;
  while (true) {
    const end = pending.indexOf('\n');
    if (end < 0) break;
    const line = pending.slice(0, end).replace(/\r$/, '');
    pending = pending.slice(end + 1);
    if (!line) continue;
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    if (request.method === 'server/discover') {
      respond({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    } else if (request.method === 'initialize') {
      setTimeout(() => respond({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'probe-fixture', version: '1' } } }), Number(process.env.MCP_PROBE_DELAY_MS ?? 0));
    } else if (request.method === 'tools/list') {
      respond({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'ping', description: 'Probe fixture', inputSchema: { type: 'object', properties: {} } }] } });
    } else if (request.method === 'tools/call' && process.env.MCP_PROBE_CALL_MARKER) {
      writeFileSync(process.env.MCP_PROBE_CALL_MARKER, request.params.name);
    }
  }
});
