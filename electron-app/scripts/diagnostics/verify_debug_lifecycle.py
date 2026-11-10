"""Real WebView2 + Python Playwright acceptance, isolated profile, no AI calls."""
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parent))
from webview2_debug import DebugBroker, listeners

def browser_commands(owner):
    script = "@(Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress"
    raw = subprocess.check_output(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], text=True, creationflags=subprocess.CREATE_NO_WINDOW,timeout=8)
    rows = json.loads(raw) if raw.strip() else []
    return [r["CommandLine"] for r in (rows if isinstance(rows,list) else [rows]) if owner.contains(r["ProcessId"])]

def no_cdp(owner):
    deadline=time.monotonic()+15
    while True:
        commands=browser_commands(owner)
        if commands:
            assert all("--remote-debugging" not in c for c in commands), commands
            return len(commands)
        if time.monotonic()>deadline:
            raise AssertionError("No owned WebView2 browser process started")
        time.sleep(.2)

def main():
    executable=Path(sys.argv[1]).resolve(strict=True)
    output=Path(sys.argv[2]).resolve();output.mkdir(parents=True,exist_ok=True)
    sdk=Path(sys.argv[3]).resolve(strict=True);sys.path.insert(0,str(sdk))
    from playwright.sync_api import sync_playwright
    broker=DebugBroker(executable,output/"profile",max_seconds=60,
        extra_environment={"HAYDEV_QA_MODE":"1","HAYDEV_NO_ENGINES":"1","MCP_SERVER_PORT":"27951","GEMINI_API_KEY":"","OPENAI_API_KEY":"","OPENROUTER_API_KEY":"","GEMINI_BASE_URL":"http://127.0.0.1:9/v1",
                           "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS":"--remote-debugging-port=9333"})
    results={"realApiCalled":False,"normal":{},"debug":{},"afterDisconnect":{},"exceptionCleanup":{},"timeout":{}}
    initial_audit=len(broker.audit_path.read_text(encoding='utf-8').splitlines()) if broker.audit_path.exists() else 0
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1',0));inherited_port=reserve.getsockname()[1]
    # Deliberately bypass the launcher sanitizer: native startup must also reject
    # inherited remote debugging flags in ordinary mode.
    broker.environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=f'--remote-debugging-port={inherited_port} --remote-debugging-address=0.0.0.0'
    try:
        broker.start_normal();results["normal"]={"ownedWebViewProcesses":no_cdp(broker.normal),"cdpArgumentsPresent":False,"inheritedPortIgnored":not listeners(inherited_port)}
        assert results['normal']['inheritedPortIgnored']
        with sync_playwright() as playwright:
            with broker.connect_playwright(playwright) as browser:
                debug_port=broker.port
                shell=next(p for c in browser.contexts for p in c.pages if p.url.startswith("http://tauri.localhost"))
                shell.wait_for_selector('.commandbar__input')
                # Native normal-agent APIs work inside WebView2; CDP is test-only.
                native_port=shell.evaluate("() => window.__TAURI_INTERNALS__.invoke('browser_debug_port')")
                persisted_tab=shell.evaluate("() => window.__TAURI_INTERNALS__.invoke('browser_tabs_open',{req:{url:'pab://newtab'}})")
                assert native_port==debug_port
                rows=listeners(debug_port)
                assert rows and all(r['LocalAddress'] in {'127.0.0.1','::1'} for r in rows)
                results["debug"]={"port":debug_port,"listeners":rows,"pythonConnectOverCDP":"PASS"}
                # Explicitly disconnect before the context exits: callback must close port.
                browser.close()
                assert broker.debug is None
                assert not listeners(debug_port)
            results["afterDisconnect"]={"oldPortListening":False,"ownedWebViewProcesses":no_cdp(broker.normal),"normalRestarted":True}
            try:
                with broker.connect_playwright(playwright) as browser:
                    exception_port=broker.port
                    page=next(p for c in browser.contexts for p in c.pages if p.url.startswith('http://tauri.localhost'))
                    page.wait_for_selector('.commandbar__input')
                    tabs=page.evaluate("() => window.__TAURI_INTERNALS__.invoke('browser_tabs_list')")
                    assert any(t['id']==persisted_tab for t in tabs),'Session tabs must survive graceful restart'
                    raise ValueError('synthetic diagnostic failure')
            except ValueError:
                pass
            assert not listeners(exception_port)
            results["exceptionCleanup"]={"oldPortListening":False,"normalRestarted":broker.normal is not None}
        broker.run_node(Path(__file__).with_name('probe.mjs'))
        results['nodeDiagnosticScript']='PASS'
        # Expiry also closes a diagnostic endpoint even with an uncooperative client.
        broker.max_seconds=1
        with broker.debug_endpoint():
            timeout_port=broker.port
            deadline=time.monotonic()+18
            while broker.debug is not None or broker.normal is None:
                if time.monotonic()>deadline:raise TimeoutError('Diagnostic expiry failed')
                time.sleep(.1)
            assert not listeners(timeout_port)
        results["timeout"]={"oldPortListening":False,"normalRestarted":True,"ownedWebViewProcesses":no_cdp(broker.normal)}
        rows=[json.loads(line) for line in broker.audit_path.read_text(encoding='utf-8').splitlines()[initial_audit:] if line]
        assert sum(r['event']=='debug_opened' for r in rows)==4
        assert sum(r['event']=='debug_closed' for r in rows)==4
        results.update(passed=True,audit=str(broker.audit_path),auditEvents=len(rows))
        (output/'lifecycle.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print(json.dumps(results,indent=2))
    finally:
        broker.stop()

if __name__=='__main__':
    main()
