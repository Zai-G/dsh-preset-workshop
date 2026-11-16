import { AGENT_SECTION, USER_CWD, USER_RUNTIME, TIME_CONTEXT, fail, record } from '../domain/core.js';
export const snapshotSettings = (config) => config.snapshots ?? { enabled: false, limit: 3 };
export const historyFor = (state, id) => state.histories?.[id] ?? [];
export function validateSnapshotSummary(summary) {
    record(summary, 'snapshot summary');
    if (['tools', 'mcp', 'skills'].some(key => !Number.isSafeInteger(summary[key]) || summary[key] < 0) || !summary.tokens || !Number.isSafeInteger(summary.tokens.min) || !Number.isSafeInteger(summary.tokens.max) || summary.tokens.min < 0 || summary.tokens.max < summary.tokens.min)
        fail('invalid-snapshot', 'Invalid snapshot summary');
}
export function validateSnapshotView(view) {
    record(view, 'snapshot view');
    if (typeof view.system !== 'string')
        fail('invalid-snapshot', 'Invalid snapshot System text');
    for (const key of ['user', 'tools', 'mcp', 'skills']) {
        const rows = view[key];
        if (!Array.isArray(rows) || rows.some(row => !row || typeof row.name !== 'string' || !row.name) || new Set(rows.map(row => row.name)).size !== rows.length)
            fail('invalid-snapshot', 'Invalid snapshot ' + key);
    }
    if (view.user.some(row => typeof row.label !== 'string' || typeof row.text !== 'string'))
        fail('invalid-snapshot', 'Invalid snapshot User text');
    validateSnapshotSummary(viewSummary(view));
    if (view.toolCount !== view.tools.length)
        fail('invalid-snapshot', 'Inconsistent snapshot tool count');
}
export function validateGroups(groups) {
    if (!Array.isArray(groups))
        fail('invalid-groups', 'Expected a list of skill groups');
    const ids = new Set(), names = new Set();
    for (const group of groups) {
        record(group, 'skill group');
        if (typeof group.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(group.id) || ids.has(group.id))
            fail('invalid-group', 'Invalid or duplicate skill group id');
        if (typeof group.name !== 'string' || !group.name.trim() || group.name !== group.name.trim() || group.name.length > 80 || names.has(group.name))
            fail('invalid-group-name', 'Use a unique group name (1–80 characters)');
        if (!Array.isArray(group.skills) || new Set(group.skills).size !== group.skills.length || group.skills.some(name => typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 256))
            fail('invalid-group-skills', 'Expected unique skill names');
        ids.add(group.id);
        names.add(group.name);
    }
}
export function groupOrderWithUndo(groups, deletedGroups) {
    const order = groups.map(group => group.id);
    for (const deleted of deletedGroups.values()) {
        if (deleted.expiresAt <= Date.now())
            continue;
        const position = order.findIndex(id => deleted.following.includes(id));
        order.splice(position < 0 ? order.length : position, 0, deleted.group.id);
    }
    return order;
}
// Snapshots contain preset configuration, not conversation history or clock samples.
export function snapshotView(preset, preview) {
    const sections = preset.prompt.sections;
    const user = [];
    const block = (name, label, text) => { if (text)
        user.push({ name, label, text }); };
    block(AGENT_SECTION, 'AGENTS', preview.agentInstructions?.requestText);
    block(USER_RUNTIME, 'environment', sections[USER_CWD]?.enabled === false || sections[USER_RUNTIME]?.enabled === false ? '' : preview.runtimeContextEnvironment);
    block('workshop:user-skill', 'SKILL', preview.skillPrompt);
    if (sections[TIME_CONTEXT]?.enabled !== false)
        block(TIME_CONTEXT, '时间与时区', '由宿主在请求时提供时间与时区。');
    for (const [name, section] of Object.entries(sections))
        if (section.custom && section.role === 'user' && section.enabled)
            block(name, name, section.text);
    const tools = preset.tools.enabled.filter(name => !name.startsWith('mcp__')).map(name => ({ name, source: preset.tools.sources?.[name] ?? '', override: preset.tools.overrides[name] ?? {} }));
    const servers = (preview.mcp ?? []).filter(server => server.source !== 'unknown' && server.enabled !== false);
    const owners = [...servers].sort((a, b) => b.serverName.length - a.serverName.length);
    const owner = (name) => owners.find(server => name.startsWith(`mcp__${server.serverName}__`))?.serverName;
    const mcp = servers.map(server => ({
        name: server.serverName,
        config: preset.mcp?.find(item => item.serverName === server.serverName) ?? {},
        tools: preset.tools.enabled.filter(name => owner(name) === server.serverName).map(name => ({ name, override: preset.tools.overrides[name] ?? {} })).sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return { system: preview.prompt, user, tools, toolCount: tools.length, mcp, skills: preset.skills.map(name => ({ name })), tokens: preview.estimatedTokenRange ?? { min: preview.estimatedTokens ?? 0, max: preview.estimatedTokens ?? 0 } };
}
export const viewSummary = (view) => ({ tools: view.toolCount, mcp: view.mcp.length, skills: view.skills.length, tokens: view.tokens });
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function snapshotDiff(left, right) {
    const entries = (before, after) => {
        const changes = { added: [], removed: [], modified: [] };
        for (const item of before) {
            const current = after.find(row => row.name === item.name);
            if (!current)
                changes.added.push(item.name);
            else if (!same(item, current))
                changes.modified.push(item.name);
        }
        changes.removed = after.filter(item => !before.some(row => row.name === item.name)).map(item => item.name);
        return changes;
    };
    const system = left.system !== right.system, user = !same(left.user, right.user);
    const tools = entries(left.tools, right.tools), mcp = entries(left.mcp, right.mcp), skills = entries(left.skills, right.skills);
    const count = Number(system) + Number(user) + [tools, mcp, skills].reduce((sum, row) => sum + row.added.length + row.removed.length + row.modified.length, 0);
    return { system, user, tools, mcp, skills, count };
}
// Patience diff uses unique line anchors; an entirely rewritten block stays linear.
export function diffLines(left = '', right = '') {
    const a = left.split('\n'), b = right.split('\n'), output = [];
    const visit = (as, ae, bs, be) => {
        while (as < ae && bs < be && a[as] === b[bs])
            output.push({ kind: 'same', left: a[as++], right: b[bs++] });
        let suffix = 0;
        while (as < ae - suffix && bs < be - suffix && a[ae - suffix - 1] === b[be - suffix - 1])
            suffix++;
        const endA = ae - suffix, endB = be - suffix;
        const unique = (lines, start, end) => { const map = new Map(); for (let i = start; i < end; i++)
            map.set(lines[i], map.has(lines[i]) ? -1 : i); return map; };
        const ua = unique(a, as, endA), ub = unique(b, bs, endB);
        const candidates = [...ua].filter(([text, index]) => index >= 0 && (ub.get(text) ?? -1) >= 0).map(([text, index]) => [index, ub.get(text)]);
        const tails = [], previous = [];
        for (let i = 0; i < candidates.length; i++) {
            let low = 0, high = tails.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (candidates[tails[mid]][1] < candidates[i][1])
                    low = mid + 1;
                else
                    high = mid;
            }
            previous[i] = low ? tails[low - 1] : -1;
            tails[low] = i;
        }
        const anchors = [];
        for (let i = tails.at(-1); i !== undefined && i >= 0; i = previous[i])
            anchors.push(candidates[i]);
        anchors.reverse();
        if (!anchors.length) {
            const length = Math.max(endA - as, endB - bs);
            for (let i = 0; i < length; i++)
                output.push({ kind: 'change', ...(as + i < endA ? { left: a[as + i] } : {}), ...(bs + i < endB ? { right: b[bs + i] } : {}) });
        }
        else
            for (const [ai, bi] of anchors) {
                visit(as, ai, bs, bi);
                output.push({ kind: 'same', left: a[ai], right: b[bi] });
                as = ai + 1;
                bs = bi + 1;
            }
        if (anchors.length)
            visit(as, endA, bs, endB);
        for (let i = 0; i < suffix; i++)
            output.push({ kind: 'same', left: a[endA + i], right: b[endB + i] });
    };
    visit(0, a.length, 0, b.length);
    return output;
}
