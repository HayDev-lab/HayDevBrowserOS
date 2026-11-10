// Read-only diagnostic entry point. Requires a temporary DebugBroker lease.
import {connectDiagnostic} from './cdp-endpoint.mjs';
const browser=await connectDiagnostic();
try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');
  await page.waitForSelector('.commandbar__input');
  const invoke=(name)=>page.evaluate(n=>window.__TAURI_INTERNALS__.invoke(n),name);
  console.log(JSON.stringify({version:await invoke('app_version'),debugPort:await invoke('browser_debug_port'),openTabs:(await invoke('browser_tabs_list')).length,modelCalled:false}));
}finally{await browser.close();}
