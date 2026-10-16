import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const invoke=(p,c,a={})=>p.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
function sample(pid){
  const code=`$all=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid}); do { $added=$false; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$added=$true}} } while($added); $items=@(foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p){@{id=$id;cpu=$p.TotalProcessorTime.TotalSeconds;ram=$p.WorkingSet64}}}); ConvertTo-Json -Compress -InputObject $items`;
  return {at:Date.now(),items:JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true}))};
}
const ram=s=>s.items.reduce((n,p)=>n+p.ram,0);
function cpu(a,b){let seconds=0;for(const p of b.items){const old=a.items.find(v=>v.id===p.id);seconds+=Math.max(0,p.cpu-(old?.cpu||0));}return seconds/((b.at-a.at)/1000)/availableParallelism()*100;}
const median=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];

test('P13: fixed startup, navigation, idle, tabs and Shield performance thresholds',{timeout:480000},async t=>{
  const dataRoot=mkdtempSync(path.join(tmpdir(),'haydev-e2e-perf-'));let app=new AppHandle();
  t.after(async()=>{await app.stop();rmSync(dataRoot,{recursive:true,force:true});});
  const metrics={mode:process.env.HAYDEV_E2E_MODE||'debug',cpuLogicalProcessors:availableParallelism(),thresholds:{coldMs:10000,warmMs:5000,idleCpuPercent:3,idleRamBytes:600*1024*1024,tabs20RamBytes:2.5*1024**3,tabs20CpuPercent:15,navigateAckMs:1500,shieldOverhead:0.15,cyclesRamRatio:1.2}};
  await app.launch({dataRoot});let chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');metrics.coldMs=Date.now()-app.spawnedAt;
  await app.stop({graceful:true});app=new AppHandle();await app.launch({dataRoot});chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');metrics.warmMs=Date.now()-app.spawnedAt;
  const id=await app.activeTabId(chrome);let start=performance.now();await invoke(chrome,'browser_navigate',{req:{tabId:id,url:fixtureServer.url('/static')}});metrics.navigateAckMs=performance.now()-start;
  const page=await app.waitTabPage(/\/static/);await page.waitForSelector('#fixture-marker');
  // Sequential loopback requests with unique URLs: compare native interceptor
  // overhead, not ad-network/DNS latency. Alternate ON/OFF to limit drift.
  const on=[],off=[];
  for(let round=0;round<8;round++)for(const enabled of (round%2?[true,false]:[false,true])){
    await invoke(chrome,'shield_set_enabled',{enabled});
    const elapsed=await page.evaluate(async round=>{const start=performance.now();for(let i=0;i<30;i++){const r=await fetch(`/health?perf=${round}-${i}-${Math.random()}`,{cache:'no-store'});if(!r.ok)throw Error('Fixture request failed');await r.text();}return performance.now()-start;},round);
    (enabled?on:off).push(elapsed);
  }
  metrics.shield={on,off,medianOnMs:median(on),medianOffMs:median(off),overhead:median(on)/median(off)-1};
  await invoke(chrome,'shield_set_enabled',{enabled:true});
  // The acceptance interval is five full minutes; snapshots include the app
  // and its actual WebView2 descendants, with CPU normalized to logical CPUs.
  await pause(2000);const idleStart=sample(app.proc.pid);
  for(let i=0;i<30;i++)await pause(10000);
  const idleEnd=sample(app.proc.pid);metrics.idleCpuPercent=cpu(idleStart,idleEnd);metrics.idleRamBytes=ram(idleEnd);
  const tabs=[];
  for(let i=0;i<19;i++){const tabId=randomUUID();await invoke(chrome,'browser_tabs_open',{req:{id:tabId,url:fixtureServer.url('/static'),activate:false}});tabs.push(tabId);}
  await pause(3000);const manyStart=sample(app.proc.pid);await pause(10000);const manyEnd=sample(app.proc.pid);metrics.tabs20CpuPercent=cpu(manyStart,manyEnd);metrics.tabs20RamBytes=ram(manyEnd);
  for(const tabId of tabs)await invoke(chrome,'browser_tabs_close',{req:{tabId}});
  await pause(3000);metrics.ramAfter20CloseBytes=ram(sample(app.proc.pid));
  for(let i=0;i<10;i++){const tabId=randomUUID();await invoke(chrome,'browser_tabs_open',{req:{id:tabId,url:fixtureServer.url('/static'),activate:false}});await invoke(chrome,'browser_tabs_close',{req:{tabId}});}
  await pause(3000);metrics.cyclesRamRatio=ram(sample(app.proc.pid))/metrics.idleRamBytes;
  writeFileSync(path.join(app.evidenceDir,'performance.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify({gate:'performance',...metrics}));
  for(const key of ['coldMs','warmMs','navigateAckMs','idleCpuPercent','idleRamBytes','tabs20CpuPercent','tabs20RamBytes','cyclesRamRatio'])assert.ok(metrics[key]<=metrics.thresholds[key],`${key}: ${metrics[key]} > ${metrics.thresholds[key]}`);
  assert.ok(metrics.shield.overhead<=metrics.thresholds.shieldOverhead,`Shield overhead ${(metrics.shield.overhead*100).toFixed(1)}% >15%`);
});
