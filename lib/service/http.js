import { fail } from '../domain/core.js';
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
// JSON may escape each text byte as six bytes (for example a YAML tab).
const MAX_REQUEST_BYTES = MAX_PAYLOAD_BYTES * 6 + 64 * 1024;
export async function handle(req, res) {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
        const rejection = this.ctx.get('connection')?.requestRejection(req);
        if (rejection !== undefined) {
            res.writeHead(rejection);
            res.end();
            return;
        }
        if (req.headers['sec-fetch-site'] === 'cross-site')
            fail('cross-site', 'Cross-site requests are not allowed', 403);
        await this.ready;
        if (req.method === 'GET') {
            send(200, await this.action({ action: 'snapshot' }));
            return;
        }
        if (req.method !== 'POST') {
            send(405, { error: 'method-not-allowed' });
            return;
        }
        if (!req.headers['content-type']?.startsWith('application/json'))
            fail('content-type', 'Expected application/json', 415);
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_REQUEST_BYTES)
                fail('payload-too-large', 'Encoded request exceeds 48 MiB plus envelope', 413);
            chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || typeof input.action !== 'string')
            fail('invalid-action', 'action is required');
        send(200, await this.action(input));
    }
    catch (error) {
        send(error.status ?? 400, { error: error.code ?? 'request-failed', detail: error.message, ...error.details, ...(error.recoveryError ? { recoveryError: error.recoveryError } : {}) });
    }
}
