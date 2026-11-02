import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
// The standalone reference page is a local artifact that git does not track, so default to the
// repo copy and skip instead of failing when neither the env var nor the file exists.
const referencePath=process.env.STUDIO_REFERENCE_HTML??new URL('../预设工坊交互预览.html',import.meta.url);
const html=await readFile(referencePath,'utf8').catch(()=>undefined);
if(!html){console.log('SKIP: set STUDIO_REFERENCE_HTML to the standalone reference');process.exit(0);}
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const data=new Map(scripts.flatMap(([all,attrs,code])=>{const id=attrs.match(/id="([^"]+)"/);return id?[[id[1],{textContent:code}]]:[];}));
const context=vm.createContext({structuredClone,Response,localStorage:{getItem:()=>null,setItem(){}},document:{getElementById:id=>data.get(id)||{},documentElement:{}},window:{},setInterval:()=>{},console});
const executable=scripts.filter(([all,attrs])=>!attrs.includes('type='));
for(const [all,attrs,code]of executable)new vm.Script(code);
vm.runInContext(executable[0][2],context);vm.runInContext(executable[1][2],context);
vm.runInContext(`
let snap=api({action:'snapshot'}); if(snap.presets.length!==1)throw Error('initial presets');
let first=api({action:'preview',id:BUILTIN_ID}); if(first.tools.filter(t=>!t.function.name.startsWith('mcp__')).length!==9||first.tools.some(t=>t.function.name==='subagent')||!first.displayPrompt.includes('\\n\\nwrite：'))throw Error('preview tool format');
api({action:'create',id:'example',name:'Example'});
const fresh=preset('example');api({action:'save',id:fresh.id,revision:fresh.revision,changes:{prompt:{persona:'Demo {{cwd}}',sections:{}}}});
if(!preview({id:fresh.id}).displayPrompt.startsWith('# System\\n\\nDemo /workspace/example'))throw Error('variable');
const beforeInjection=preview({id:BUILTIN_ID}).editableSections.length;
injected=true;const injectedPreview=preview({id:BUILTIN_ID});if(injectedPreview.editableSections.length!==beforeInjection+2)throw Error('dynamic plugin sections');
const beforeSkill=preview({id:BUILTIN_ID,draft:{skills:[]}});
const toolDraft=enabled=>({tools:{...preset(BUILTIN_ID).tools,enabled}});
const membersFor=enabled=>preview({id:BUILTIN_ID,draft:toolDraft(enabled)}).editableSections.find(s=>s.name===TOOL_GUIDANCE)?.members||[];
if(membersFor(['write']).some(s=>s.name==='tool:read')||membersFor(['read']).some(s=>s.name==='tool:write'))throw Error('disabled tool guidance leaked');
const sharedJobs=catalog.filter(t=>(t.sections||[]).includes('tool:jobs')).slice(0,2);
if(sharedJobs.length!==2)throw Error('missing shared jobs fixture');
if(membersFor(sharedJobs.map(t=>t.name)).filter(s=>s.name==='tool:jobs').length!==1)throw Error('shared guidance duplicated');
if(!membersFor([sharedJobs[0].name]).some(s=>s.name==='tool:jobs')||membersFor([]).some(s=>s.name==='tool:jobs'))throw Error('shared guidance visibility');
const skillPreview=preview({id:BUILTIN_ID,draft:{skills:['example-skill'],tools:{...preset(BUILTIN_ID).tools,enabled:[...new Set([...preset(BUILTIN_ID).tools.enabled,'skill'])]}}});
if(!skillPreview.displayPrompt.includes('# SKILL')||!skillPreview.displayPrompt.includes('<available_skills>')||skillPreview.estimatedTokens<=beforeSkill.estimatedTokens)throw Error('skill catalog preview');
const exported=api({action:'export',id:'example'}).text;
try{api({action:'import',format:'json',mode:'new',text:exported});throw Error('missing conflict');}catch(e){if(e.code!=='import-conflict')throw e;}
api({action:'import',format:'json',mode:'rename',text:exported,renames:[{index:0,id:'copy',name:'Copy'}]});
const yamlExport=api({action:'export',all:true,format:'yaml'}).text;if(!yamlExport.includes('dsh-preset-workshop'))throw Error('yaml export');
`,context);
assert.ok(!/\/Users\/[^/]+\//.test(html)&&!html.includes('http://127.0.0.1:'));
console.log('PASS: standalone scripts parse; offline preview, variables, injected sections, save, JSON conflicts/rename and YAML export work without DSH');
