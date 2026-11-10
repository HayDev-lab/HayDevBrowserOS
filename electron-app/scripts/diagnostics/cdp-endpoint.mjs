import {chromium} from 'playwright-core';
export async function connectDiagnostic(){
  const endpoint=process.env.HAYDEV_CDP_ENDPOINT,session=process.env.HAYDEV_DEBUG_SESSION;
  if(!endpoint||!session)throw Error('DIAGNOSTIC_SESSION_REQUIRED: run this script through DebugBroker.run_node()');
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('LOOPBACK_DIAGNOSTIC_ENDPOINT_REQUIRED');
  const browser=await chromium.connectOverCDP(url.origin);
  const deadline=Date.now()+15000;
  while(!browser.contexts().flatMap(c=>c.pages()).some(p=>/tauri\.localhost|localhost:5180/.test(p.url()))){
    if(Date.now()>deadline){await browser.close();throw Error('DIAGNOSTIC_SHELL_NOT_READY');}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return browser;
}
