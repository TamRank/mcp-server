/** README contract checks only: no network, customer configuration or writes. */
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import test from 'node:test';
import { WorkflowClient } from '../src/workflow-rest.js';
import { workflowIdentity } from '../src/workflow-identity.js';
import { registerWorkflowTools, workflowDefinitions } from '../src/workflow-tools.js';
import { discoverWorkflows } from '../src/scan-maintenance.js';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const readme=await readFile(join(root,'README.md'),'utf8');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const examples=[...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match=>JSON.parse(match[1]));
const settings=examples[0]?.mcpServers?.['tamrank-test'];
const inlineNames=text=>[...text.matchAll(/`([a-z][a-z_]+)`/g)].map(match=>match[1]);
function registry(profile) {
  const tools=new Map(),calls=[];
  const client={get:async(path,query)=>{calls.push({method:'GET',path,query});return {contract_version:2,items:[],next_cursor:null};},
    post:async()=>assert.fail('Onboarding must not send a mutation')};
  registerWorkflowTools({registerTool:(name,config,handler)=>tools.set(name,{config,handler})},client,
    {profile,capabilities:{contract_version:2,full_v2_compatible:false,execution_enabled:false}});
  return {tools,calls};
}

test('configuration selects the explicit workflow entry with placeholders only',async()=>{
  assert.equal(examples.length,1);
  assert.equal(Object.keys(examples[0].mcpServers).length,1);
  assert.ok(isAbsolute(settings.command));
  assert.deepEqual(settings.args,['/absolute/path/to/mcp-server/index-workflow.js']);
  assert.deepEqual(settings.env,{TAMRANK_SITE_URL:'https://test.example.com',TAMRANK_PAT:'REPLACE_WITH_SITE_LOCAL_PAT',
    TAMRANK_TOOL_PROFILE:'core',TAMRANK_WORKFLOW_PREVIEW:'1'});
  const entry=await readFile(join(root,'index-workflow.js'),'utf8');
  for(const key of Object.keys(settings.env))assert.ok(entry.includes('process.env.'+key),'Known entry setting: '+key);
  assert.equal(readme.includes('NODE_TLS_REJECT_UNAUTHORIZED'),false);
  assert.equal(/tamrank_pat_[a-zA-Z0-9_-]{20,}/.test(readme),false,'No token-shaped credential in example');
});

test('package version and normal bin remain distinct from the preview identity',()=>{
  for(const value of [pkg.name,pkg.version,workflowIdentity.name,workflowIdentity.version])assert.ok(readme.includes('`'+value+'`'));
  assert.equal(pkg.main,'./index.js');
  assert.deepEqual(pkg.bin,{'tamrank-mcp':'./index.js'});
  assert.ok(readme.includes('not an npm release'));
  assert.ok(readme.includes('Do not activate these writers on customer'));
});

test('documented core and specialist names match the real registry',()=>{
  const documented=inlineNames(readme.split('The twelve core names are:')[1].split('A listed name')[0]);
  assert.deepEqual(documented,Object.keys(workflowDefinitions()));
  const specialist=inlineNames(readme.split('The specialist profile adds ')[1].split('Merely selecting it')[0]);
  for(const [profile,count]of [['core',12],['specialist',20],['legacy',42]])assert.equal(registry(profile).tools.size,count);
  assert.deepEqual([...registry('specialist').tools.keys()].filter(name=>!documented.includes(name)),specialist);
});

test('first connection walkthrough issues only its four documented reads',async()=>{
  const {tools,calls}=registry(settings.env.TAMRANK_TOOL_PROFILE);
  for(const name of ['get_site_context','get_capabilities','get_work_queue','get_signals']){
    assert.equal(tools.get(name).config.annotations.readOnlyHint,true);
    assert.notEqual((await tools.get(name).handler({})).isError,true);
  }
  assert.deepEqual(calls.map(({method,path})=>[method,path]),[
    ['GET','/site/context'],['GET','/capabilities'],['GET','/work-queue'],['GET','/signals']]);
});

test('legacy profile keeps only the five documented read aliases',async()=>{
  const {tools,calls}=registry('legacy');
  const aliases=['get_site_context','get_capabilities','get_signals','get_priority_actions','get_next_action'];
  const paragraph=readme.split("In the workflow entry's legacy profile, only ")[1].split('currently map')[0];
  assert.deepEqual(inlineNames(paragraph),aliases);
  for(const [name,{handler}]of tools){
    const result=await handler(aliases.includes(name)?{}:{post_id:123,meta_title:'Fictitious proposal',execute:true});
    if(aliases.includes(name))assert.notEqual(result.isError,true);
    else{assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'workflow_upgrade_required');}
  }
  assert.equal(calls.length,aliases.length);
  assert.ok(calls.every(call=>call.method==='GET'));
});

test('documented URL, routing and timeout boundaries match the constructor',()=>{
  const options={siteUrl:settings.env.TAMRANK_SITE_URL,pat:'not-a-real-token'};
  const base=new WorkflowClient(options);
  assert.equal(base.base,'https://test.example.com');assert.equal(base.routeStyle,'pretty');assert.equal(base.timeoutMs,30000);
  for(const siteUrl of ['https://test.example.com/client/','http://localhost','http://127.0.0.1','http://[::1]'])
    assert.doesNotThrow(()=>new WorkflowClient({...options,siteUrl}));
  for(const siteUrl of ['http://test.example.com','http://tammarketing-test.local','https://a:b@test.example.com',
    'https://test.example.com/?rest_route=/tamrank/v2','https://test.example.com/#task'])
    assert.throws(()=>new WorkflowClient({...options,siteUrl}));
  for(const timeoutMs of [1,30000,120000])assert.doesNotThrow(()=>new WorkflowClient({...options,timeoutMs}));
  for(const timeoutMs of [0,120001,1.5,NaN])assert.throws(()=>new WorkflowClient({...options,timeoutMs}));
  for(const routeStyle of ['pretty','query'])assert.doesNotThrow(()=>new WorkflowClient({...options,routeStyle}));
  assert.throws(()=>new WorkflowClient({...options,routeStyle:'v1'}));
});

test('preview is an explicit compatibility opt-in, never an authentication bypass',async()=>{
  const client={get:async()=>({contract_version:2,full_v2_compatible:false})};
  assert.equal((await discoverWorkflows(client,{profile:'core'})).preflight.code,'workflow_upgrade_required');
  assert.equal((await discoverWorkflows(client,{profile:'core',preview:settings.env.TAMRANK_WORKFLOW_PREVIEW==='1'})).preflight.ok,true);
  const refusal={get:async()=>{throw Object.assign(new Error('Fixture refusal'),{status:401,code:'fixture_auth_denied'});}};
  assert.equal((await discoverWorkflows(refusal,{profile:'core',preview:true})).preflight.ok,false);
});

test('README references bundled documents rather than temporary worktree paths',async()=>{
  assert.equal(readme.includes('/private/tmp'),false);
  const links=[...readme.matchAll(/\]\(([^)]+)\)/g)].map(match=>match[1]);
  assert.ok(links.length>0);
  for(const link of links){assert.ok(pkg.files.includes(link),'Document is shipped: '+link);await access(join(root,link));}
});

const locales=[
  {file:'QUICKSTART-NL.md',reads:'Eerste aanroepen:',warning:'Activeer deze schrijffuncties nog niet op klantwebsites.',
    boundaries:['Een opgeslagen voorstel is nog geen toestemming.','niet het chatgesprek.',
      'niet automatisch opnieuw schrijven','nieuw akkoord','schakel TLS-controle niet uit',
      'Toestemming voor klant A geldt niet voor klant B.']},
  {file:'QUICKSTART-DE.md',reads:'Erste Aufrufe:',warning:'Aktiviere diese Schreibfunktionen noch nicht auf Kundenwebsites.',
    boundaries:['Ein gespeicherter Vorschlag ist noch keine Freigabe.','nicht den Chatverlauf.',
      'nicht automatisch erneut schreiben','erneuter Zustimmung','deaktiviere die TLS-Prüfung nicht',
      'Zustimmung für Kunde A gilt nicht für Kunde B.']},
  {file:'QUICKSTART-FR.md',reads:'Premiers appels :',warning:"N'activez pas encore ces fonctions d'écriture sur les sites de clients.",
    boundaries:["Une proposition enregistrée n'est pas une autorisation.",'pas la conversation elle-même.',
      "ne relancez pas automatiquement l'écriture",'nouvel accord','ne désactivez pas la vérification TLS',
      "L'accord pour le client A ne vaut pas pour le client B."]}
];
for(const {file,reads,warning,boundaries} of locales)test('localized first connection preserves the reviewed contract: '+file,async()=>{
  const guide=await readFile(join(root,file),'utf8'),plain=guide.replace(/\*\*/g,'').replace(/\s+/g,' ');
  const configs=[...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match=>JSON.parse(match[1]));
  assert.deepEqual(configs,examples,'Translations use the exact same placeholder configuration, not another entry or wider permissions');
  for(const value of [pkg.name,pkg.version,workflowIdentity.name,workflowIdentity.version])assert.ok(guide.includes('`'+value+'`'));
  for(const sentence of [warning,...boundaries])assert.ok(plain.includes(sentence),'Preserve reviewed localized safety statement: '+sentence);
  assert.equal(guide.includes('NODE_TLS_REJECT_UNAUTHORIZED'),false);
  assert.equal(/tamrank_pat_[a-zA-Z0-9_-]{20,}/.test(guide),false);
  assert.equal(guide.includes('/private/tmp'),false);
  const first=guide.split('\n').find(line=>line.startsWith(reads));
  assert.deepEqual(inlineNames(first),['get_site_context','get_capabilities','get_work_queue','get_signals']);
  const {tools,calls}=registry(configs[0].mcpServers['tamrank-test'].env.TAMRANK_TOOL_PROFILE);
  for(const name of inlineNames(first)){
    assert.equal(tools.get(name).config.annotations.readOnlyHint,true);
    assert.notEqual((await tools.get(name).handler({})).isError,true);
  }
  assert.deepEqual(calls.map(({method,path})=>[method,path]),[
    ['GET','/site/context'],['GET','/capabilities'],['GET','/work-queue'],['GET','/signals']]);
  for(const name of ['plan_changes','execute_change_set','get_changes','rollback_change_set','get_scan_status'])assert.ok(guide.includes('`'+name+'`'));
  assert.ok(pkg.files.includes(file));assert.ok(readme.includes(']('+file+')'));
  for(const match of guide.matchAll(/\]\(([^)]+)\)/g)){
    assert.ok(pkg.files.includes(match[1]),'Linked guide is packaged');await access(join(root,match[1]));
  }
});
