// Real React/browser smoke test with a mocked native boundary, no model calls.
// Usage: CHROMIUM_PATH=/path/to/chrome node scripts/verify-poker-ui.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const result=await build({stdin:{contents:`
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {PokerPanel} from './src/renderer/src/components/PokerPanel';
import {I18nProvider} from './src/renderer/src/i18n';
function App(){const [status,setStatus]=useState(null);useEffect(()=>{window.qaSetStatus=setStatus;},[]);return <I18nProvider><PokerPanel agentRunning={status?.state==='RUNNING'} status={status}/></I18nProvider>}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@shared':resolve(root,'src/shared')},define:{'process.env.NODE_ENV':'"production"'}});
const js=result.outputFiles[0].text;
const server=createServer(async(req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  if(req.url==='/styles.css'||req.url==='/design-tokens.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(resolve(root,'src/renderer/src',req.url.slice(1))));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/styles.css"></head><body style="width:410px;margin:0;background:var(--nc-bg);color:var(--nc-text-primary)"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:430,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.qaCalls=[];window.qaListeners={};
    window.api={
      getLocale:async()=> 'ru',setLocale:()=>{},
      on:(channel,fn)=>{window.qaListeners[channel]=fn;return()=>delete window.qaListeners[channel];},
      browser:{listTabs:async()=>[{id:'table-a',title:'Local test table',url:'http://127.0.0.1/table',isActive:true}]},
      control:{setMode:async()=>({accepted:true}),takeControl:async()=>{window.qaComplete?.();window.qaSetStatus(null);return {accepted:true};}},
      agent:{run:req=>{window.qaCalls.push(['run',req]);window.qaSetStatus({state:'RUNNING',poker:{...req.poker,mode:req.profile==='POKER_AUTO'?'auto':'human'}});return new Promise(r=>{window.qaComplete=()=>r({state:'STOPPED',answer:null});});}},
      poker:{message:async(s,t)=>{window.qaCalls.push(['message',s,t]);return{eventId:1};},memory:async()=>({events:[],lessons:[],learning:'candidate memory'}),importKnowledge:async kind=>{window.qaCalls.push(['import',kind]);return{title:'Own notes',status:'ready'};}}
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Начать',exact:true}).click();
  let calls=await page.evaluate(()=>window.qaCalls);
  assert.equal(calls[0][1].profile,'POKER_HUMAN');assert.equal(calls[0][1].poker.tabId,'table-a');
  assert.equal(await page.getByLabel('Вкладка со столом').isDisabled(),true);
  await page.getByPlaceholder('Вопрос агенту…').fill('Объясни шансы банка');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await page.evaluate(()=>window.qaListeners['poker:advice']({sessionId:window.qaCalls[0][1].poker.sessionId,text:'Тестовый ответ: цена колла — 25% банка.'}));
  await page.getByText('Тестовый ответ: цена колла — 25% банка.').waitFor();
  await page.getByRole('button',{name:'Импорт Book-to-Skill',exact:true}).click();
  await page.getByText('Добавлено: Own notes (ready)').waitFor();
  const artifact=resolve(root,'../artifacts/poker-panel.png');await mkdir(resolve(root,'../artifacts'),{recursive:true});
  await page.screenshot({path:artifact});
  await page.getByRole('button',{name:'Остановить',exact:true}).click();
  await page.getByRole('button',{name:'Начать',exact:true}).waitFor({state:'visible'});
  await page.getByLabel('Режим').selectOption('auto');
  await page.getByRole('button',{name:'Начать',exact:true}).click();
  calls=await page.evaluate(()=>window.qaCalls);
  assert.equal(calls.filter(c=>c[0]==='run').at(-1)[1].profile,'POKER_AUTO');
  assert.ok(calls.some(c=>c[0]==='message'&&c[2]==='Объясни шансы банка'));
  assert.ok(calls.some(c=>c[0]==='import'&&c[1]==='skill'));
  await page.getByRole('button',{name:'Остановить',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['Human profile binding','active table lock','text question','live advice','skill import','Stop','Auto profile'],screenshot:artifact}));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
