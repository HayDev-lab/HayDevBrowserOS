import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root=path.resolve('resources/packaged-runtimes'),out=process.env.HAYDEV_EVIDENCE_DIR||path.resolve('../artifacts/runtime-check');mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(path.join(root,'runtime-manifest.json')));
for(const [file,sha] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex'),sha,file);
const data=mkdtempSync(path.join(tmpdir(),'haydev-runtime-offline-'));const children=[],logs=[];
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:data,TMP:data,PATH:path.join(process.env.SystemRoot,'System32'),NEXT_TELEMETRY_DISABLED:'1'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const p=server.address().port;await new Promise(r=>server.close(r));return p;}
function launch(label,exe,args,extra,cwd){const child=spawn(exe,args,{env:{...env,...extra},cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});const log=[];child.stdout.on('data',b=>log.push(String(b)));child.stderr.on('data',b=>log.push(String(b)));children.push(child);logs.push({label,log});return child;}
async function ready(child,url){const end=Date.now()+30000;while(Date.now()<end){if(child.exitCode!==null)throw Error(`Runtime exited ${child.exitCode}`);try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return r;}catch{}await pause(200);}throw Error('Runtime readiness deadline');}
try {
  const node=path.join(root,'node/node.exe'),python=path.join(root,'searxng/python/python.exe');
  const nodeVersion=execFileSync(node,['--version'],{encoding:'utf8',env}).trim();
  const pythonVersion=execFileSync(python,['--version'],{encoding:'utf8',env}).trim();
  const torVersion=execFileSync(path.join(root,'tor/tor.exe'),['--version'],{encoding:'utf8',env}).split('\n')[0];
  const sqlite=execFileSync(node,['-e',"const D=require('better-sqlite3');const d=new D(':memory:');console.log(d.prepare('SELECT 42 AS answer').get().answer);d.close();"],{cwd:path.join(root,'perplexica'),encoding:'utf8',env}).trim();assert.equal(sqlite,'42');
  mkdirSync(path.join(data,'data'));cpSync(path.join(root,'perplexica/drizzle'),path.join(data,'drizzle'),{recursive:true});
  writeFileSync(path.join(data,'data/config.json'),JSON.stringify({version:1,setupComplete:false,preferences:{},personalization:{},modelProviders:[],search:{searxngURL:''}}));
  const np=await port();const next=launch('perplexica',node,[path.join(root,'perplexica/server.js')],{PORT:String(np),HOSTNAME:'127.0.0.1',DATA_DIR:data},path.join(root,'perplexica'));
  await ready(next,`http://127.0.0.1:${np}/api/providers`);
  const denied=await fetch(`http://127.0.0.1:${np}/api/providers`,{headers:{Origin:'https://attacker.example'}});assert.equal(denied.status,403);
  const allowed=await fetch(`http://127.0.0.1:${np}/api/providers`,{headers:{Origin:'http://pab.search'}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'http://pab.search');
  const html=await (await fetch(`http://127.0.0.1:${np}/`)).text();assert.ok(html.includes('<html'));
  const sp=await port(),settings=path.join(data,'searxng.yml');
  writeFileSync(settings,`use_default_settings:\n  engines:\n    keep_only: []\nengines: []\nserver:\n  secret_key: synthetic-offline-runtime-test\n  limiter: false\n  bind_address: 127.0.0.1\n  port: ${sp}\nsearch:\n  formats: [html, json]\n`);
  const searx=launch('searxng',python,[path.join(root,'searxng/searxng-runner.py')],{SEARXNG_SETTINGS_PATH:settings,SEARXNG_PORT:String(sp)},path.join(root,'searxng/app'));
  const health=await ready(searx,`http://127.0.0.1:${sp}/healthz`);assert.equal(health.status,200);
  writeFileSync(path.join(out,'bundled-runtime-check.json'),JSON.stringify({status:'PASS',nodeVersion,pythonVersion,torVersion,sqlite:'42',perplexica:{health:200,untrustedOrigin:403,trustedOrigin:200},searxng:{health:200,configuredExternalEngines:0},torNetwork:'NOT_RUN',liveSearch:'NOT_RUN',filesVerified:Object.keys(manifest.files).length,manifestSha256:createHash('sha256').update(readFileSync(path.join(root,'runtime-manifest.json'))).digest('hex')},null,2));
  console.log('Bundled Node + SQLite + Next API/CORS + SearXNG health passed with system Node absent from PATH. Tor only --version; no external search.');
} finally {
  for(const child of children)if(child.exitCode===null){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}
  await pause(500);for(const {label,log}of logs)writeFileSync(path.join(out,`runtime-offline-${label}.log`),log.join(''));
  rmSync(data,{recursive:true,force:true});
}
