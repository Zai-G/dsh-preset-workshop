import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir(new URL('../lib/client/', import.meta.url), { recursive: true });
const read = file => readFile(new URL('../src/client/' + file, import.meta.url), 'utf8');
// The host loads one factory; these ordered files share its lexical scope.
const parts = ['shell.js', 'tools.js', 'mcp-skills.js', 'history.js', 'preview.js', 'dialogs.js', 'actions.js', 'entry.js'];
const [fragments, html, css] = await Promise.all([Promise.all(parts.map(read)), read('client.html'), read('client.css')]);
const client = fragments.join('\n');
await writeFile(new URL('../lib/client/client.js', import.meta.url), client.replace('__WORKSHOP_HTML__', () => JSON.stringify(html)).replace('__WORKSHOP_CSS__', () => JSON.stringify(css)));
for (const file of ['client.css', 'client.html']) {
  await cp(new URL('../src/client/' + file, import.meta.url), new URL('../lib/client/' + file, import.meta.url));
}
