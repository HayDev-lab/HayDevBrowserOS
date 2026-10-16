// Pinned Windows runtime bundle. Fail on missing inputs or checksum mismatches.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNNER, PWD_SHIM } from './runtime-runner-templates.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(readFileSync(path.join(root,'resources/runtime-lock.json')));
const cache=path.join(root,'.cache/runtime-archives'),out=path.join(root,'resources/packaged-runtimes');
mkdirSync(cache,{recursive:true});mkdirSync(out,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=s=>`'${s.replaceAll("'","''")}'`;
async function archive(key){
  const spec=lock.archives[key],file=path.join(cache,spec.filename);
  if(!existsSync(file)){const r=await fetch(spec.url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`${key}: HTTP ${r.status}`);writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
  if(sha(readFileSync(file))!==spec.sha256)throw Error(`${key}: checksum mismatch`);
  return file;
}
function unzip(file,dest){mkdirSync(dest,{recursive:true});execFileSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(dest)} -Force`],{stdio:'inherit'});}
function run(exe,args,options={}){execFileSync(exe,args,{stdio:'inherit',...options});}
const nodeArchive=await archive('node'),nodeUnpack=path.join(cache,'node-unpacked');
const nodeSource=path.join(nodeUnpack,`node-v${lock.archives.node.version}-win-x64`);
if(!existsSync(path.join(nodeSource,'node.exe')))unzip(nodeArchive,nodeUnpack);
mkdirSync(path.join(out,'node'),{recursive:true});
for(const file of ['node.exe','LICENSE'])cpSync(path.join(nodeSource,file),path.join(out,'node',file));
const node=path.join(out,'node/node.exe');
if(execFileSync(node,['--version'],{encoding:'utf8'}).trim()!==`v${lock.archives.node.version}`)throw Error('Bundled Node version mismatch');
const pyBase=path.join(out,'searxng/python'),python=path.join(pyBase,'python.exe');
if(!existsSync(python))unzip(await archive('python'),pyBase);else await archive('python');
const pth=readdirSync(pyBase).find(f=>/^python\d+\._pth$/.test(f));
writeFileSync(path.join(pyBase,pth),`${pth.replace('._pth','.zip')}\n.\nLib/site-packages\nimport site\n`);
const pip=await archive('pip');
if(!existsSync(path.join(pyBase,'Lib/site-packages/pip')))run(python,['-c','import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',pip,path.join(pyBase,'Lib/site-packages')]);
const searxArchive=await archive('searxng'),unpack=path.join(cache,'searxng-source');
mkdirSync(unpack,{recursive:true});
const extract=String.raw`import tarfile,sys
with tarfile.open(sys.argv[1]) as tf:
 members=[m for m in tf.getmembers() if not any(':' in p for p in m.name.split('/'))]
 tf.extractall(sys.argv[2],members=members,filter='data')
`;
run(python,['-c',extract,searxArchive,unpack]);
const searxSource=path.join(unpack,`searxng-${lock.archives.searxng.commit}`);
// Freeze the pinned source identity; never let setup.py discover this parent repository.
const sourceVersion='0.0.0+git.'+lock.archives.searxng.commit.slice(0,12);
writeFileSync(path.join(searxSource,'searx/version_frozen.py'), `VERSION_STRING = '${sourceVersion}'\nVERSION_TAG = '${sourceVersion}'\nDOCKER_TAG = '${sourceVersion}'\nGIT_URL = 'https://github.com/searxng/searxng'\nGIT_BRANCH = '${lock.archives.searxng.commit}'\n`);
function freshGenerated(relative) { const target=path.resolve(out,relative); if(!target.startsWith(path.resolve(out)+path.sep))throw Error('Invalid generated target'); rmSync(target,{recursive:true,force:true}); mkdirSync(target,{recursive:true}); return target; }
const requirements=path.join(root,'resources/python-requirements.lock');
if(process.argv.includes('--resolve-python')){
  const report=path.join(cache,'python-resolution.json');
  run(python,['-m','pip','install','--dry-run','--ignore-installed','--report',report,'-r',path.join(searxSource,'requirements.txt'),'waitress','setuptools','wheel']);
  const resolved=JSON.parse(readFileSync(report));
  writeFileSync(requirements,resolved.install.map(p=>`${p.metadata.name}==${p.metadata.version} --hash=sha256:${p.download_info.archive_info.hashes.sha256}`).sort().join('\n')+'\n');
  console.log('Python lock resolved; review before normal bundling.');process.exit(0);
}
if(!existsSync(requirements))throw Error('Missing reviewed Python dependency lock');
run(python,['-m','pip','install','--require-hashes','-r',requirements,'--no-warn-script-location']);
const searxApp=freshGenerated('searxng/app');
run(python,['-m','pip','install','--no-build-isolation','--no-deps','--target',searxApp,searxSource]);
writeFileSync(path.join(searxApp,'pwd.py'),PWD_SHIM);
writeFileSync(path.join(out,'searxng/searxng-runner.py'),RUNNER);
cpSync(path.join(searxSource,'LICENSE'),path.join(out,'searxng/LICENSE'));
cpSync(searxArchive,path.join(out,'searxng/source.tar.gz'));
const torUnpack=path.join(cache,'tor-unpacked');mkdirSync(torUnpack,{recursive:true});
run('tar',['-xzf',await archive('tor'),'-C',torUnpack]);
cpSync(path.join(torUnpack,'tor'),path.join(out,'tor'),{recursive:true});
if(existsSync(path.join(torUnpack,'docs')))cpSync(path.join(torUnpack,'docs'),path.join(out,'tor/notices'),{recursive:true});
const integration=path.join(root,'.cache/perplexica');
if(!existsSync(path.join(integration,'.haydev-source.json'))||!existsSync(path.join(integration,'node_modules/next')))throw Error('Run npm run integration:prepare first');
const sourceLock=readFileSync(path.join(root,'integrations/perplexica/source-lock.json'));
if(JSON.parse(readFileSync(path.join(integration,'.haydev-source.json'))).digest!==sha(sourceLock))throw Error('Perplexica input mismatch');
run(node,[path.join(integration,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:integration,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
freshGenerated('perplexica');
cpSync(path.join(integration,'.next/standalone'),path.join(out,'perplexica'),{recursive:true});
if(!existsSync(path.join(out,'perplexica/server.js')))throw Error('Unexpected Next standalone layout');
cpSync(path.join(integration,'.next/static'),path.join(out,'perplexica/.next/static'),{recursive:true});
for(const name of ['public','drizzle','LICENSE'])cpSync(path.join(integration,name),path.join(out,'perplexica',name),{recursive:true});
// Preserve dependency license texts even when Next's file tracer omits them.
const noticeRoot=path.join(out,'perplexica/notices');mkdirSync(noticeRoot,{recursive:true});
const inventory=[];
const dependencyLock=JSON.parse(readFileSync(path.join(integration,'package-lock.json')));
// Include notices for all production dependencies, including JavaScript
// compiled into webpack chunks and consequently absent from standalone/node_modules.
for(const [relative,locked] of Object.entries(dependencyLock.packages)){
  if(!relative||locked.dev)continue;
  const source=path.join(integration,relative),pkgFile=path.join(source,'package.json');
  if(!existsSync(pkgFile))continue; // optional package for another OS/architecture
  const pkg=JSON.parse(readFileSync(pkgFile));if(!pkg.name||!pkg.version)continue;
  const name=`${pkg.name.replaceAll('/','_')}@${pkg.version}`;
  const record={name:pkg.name,version:pkg.version,license:pkg.license||'SEE_PACKAGE',path:relative,notices:[]};
  for(const f of readdirSync(source,{withFileTypes:true})){
    if(f.isFile()&&/^(license|licence|notice|copying)([.-]|$)/i.test(f.name)){
      const target=path.join(noticeRoot,name);mkdirSync(target,{recursive:true});
      cpSync(path.join(source,f.name),path.join(target,f.name));record.notices.push(`notices/${name}/${f.name}`);
    }
  }
  inventory.push(record);
}
cpSync(path.join(integration,'src/app/fonts/OFL.txt'),path.join(noticeRoot,'Montserrat-OFL.txt'));
writeFileSync(path.join(out,'perplexica/dependency-inventory.json'),JSON.stringify(inventory,null,2));
const files={};
function walk(dir){for(const name of readdirSync(dir).sort()){const p=path.join(dir,name);if(statSync(p).isDirectory())walk(p);else if(name!=='runtime-manifest.json') files[path.relative(out,p).replaceAll('\\','/')]=sha(readFileSync(p));}}
writeFileSync(path.join(out,'THIRD_PARTY_NOTICES.txt'),'Node.js: MIT (node/LICENSE)\nPython: PSF-2.0 (searxng/python/LICENSE.txt)\nSearXNG: AGPL-3.0-or-later (searxng/LICENSE; exact source in source.tar.gz)\nTor: BSD and bundled dependencies (tor/notices)\nPerplexica/Vane: MIT (perplexica/LICENSE)\nPerplexica dependency inventory and notices: perplexica/dependency-inventory.json and perplexica/notices.\nMontserrat font: SIL OFL 1.1 (perplexica/notices/Montserrat-OFL.txt).\nDependency license texts are retained in the respective runtime packages.\n');
walk(out);
writeFileSync(path.join(out,'runtime-manifest.json'),JSON.stringify({schema:1,archives:lock.archives,perplexica:JSON.parse(sourceLock),files},null,2));
console.log(`Verified runtime bundle: ${Object.keys(files).length} files`);
