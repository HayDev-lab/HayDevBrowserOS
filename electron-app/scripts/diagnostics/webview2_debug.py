"""Audited, demand-only CDP for HayDev/WebView2. Windows, Python 3.10+.

No debugger is needed for normal native agent operation. Agent code explicitly
enters debug_endpoint()/connect_playwright() for a short diagnostic session.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import socket
import subprocess
import threading
import time
from urllib.request import build_opener, ProxyHandler
from uuid import uuid4
try:
    from .windows_process import OwnedProcess
except ImportError:
    from windows_process import OwnedProcess

def clean_environment(environment):
    result = dict(environment)
    for name in ("HAYDEV_AUTOMATION_DEBUG", "HAYDEV_DEBUG_PORT", "HAYDEV_DEBUG_SESSION"):
        result.pop(name, None)
    # Do not inherit a developer's global CDP settings into a normal run.
    raw = result.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "")
    if "remote-debugging" in raw.lower() or "remote-allow-origins" in raw.lower():
        result.pop("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", None)
    return result

def listeners(port):
    # Fixed program + integer port. No shell interpolation of paths or secrets.
    script = ("@(Get-NetTCPConnection -State Listen -LocalPort " + str(int(port)) +
              " -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress")
    output = subprocess.check_output(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                                     text=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=8)
    rows = json.loads(output) if output.strip() else []
    return rows if isinstance(rows, list) else [rows]

class DebugBroker:
    def __init__(self, executable, data_directory, *, max_seconds=300, extra_environment=None):
        self.executable = Path(executable).resolve(strict=True)
        self.data = Path(data_directory).resolve(); self.data.mkdir(parents=True, exist_ok=True)
        self.audit_path = self.data / "logs" / "cdp-audit.jsonl"
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        self.environment = clean_environment({**os.environ, **(extra_environment or {})})
        self.environment["HAYDEV_DATA_DIR"] = str(self.data)
        self.max_seconds = max(1, min(int(max_seconds), 900))
        self.normal = None; self.debug = None; self.port = None
        self.session = None; self.timer = None; self.lock = threading.RLock()

    def audit(self, event, **fields):
        row = {"at": datetime.now(timezone.utc).isoformat(), "event": event,
               "session": self.session, **fields}
        with self.audit_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")
            file.flush(); os.fsync(file.fileno())

    def start_normal(self):
        with self.lock:
            if self.normal or self.debug:
                raise RuntimeError("An owned instance is already running")
            self.normal = OwnedProcess(self.executable, [], self.environment, self.executable.parent,
                                       kill_on_controller_exit=False)
            self.audit("normal_started", pid=self.normal.pid, cdp=False)

    def _end_debug(self, reason):
        with self.lock:
            if not self.debug:
                return
            process, port = self.debug, self.port
            self.debug = None
            try:
                process.stop()
                deadline = time.monotonic() + 5
                while listeners(port):
                    if time.monotonic() >= deadline:
                        raise RuntimeError("CDP listener remains after owned process shutdown")
                    time.sleep(0.1)
                self.audit("debug_closed", port=port, reason=reason)
            finally:
                self.port = None
                self.start_normal()

    @contextmanager
    def debug_endpoint(self):
        with self.lock:
            if self.debug:
                raise RuntimeError("Diagnostic session already active")
            if self.normal:
                self.normal.stop(); self.normal = None
            with socket.socket() as reserve:
                reserve.bind(("127.0.0.1", 0)); self.port = reserve.getsockname()[1]
            self.session = str(uuid4())
            environment = dict(self.environment, HAYDEV_AUTOMATION_DEBUG="1",
                               HAYDEV_DEBUG_PORT=str(self.port), HAYDEV_DEBUG_SESSION=self.session)
            # Set before creating CoreWebView2. HayDev also enforces its explicit
            # --debug gate natively; ordinary WebView2 hosts read this variable.
            environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=(self.environment.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','')+
                f' --remote-debugging-address=127.0.0.1 --remote-debugging-port={self.port}').strip()
            self.audit("debug_starting", address="127.0.0.1", port=self.port)
            try:
                self.debug = OwnedProcess(self.executable, ["--debug"], environment, self.executable.parent,
                                          kill_on_controller_exit=True)
            except BaseException:
                self.start_normal(); raise
        try:
            endpoint = f"http://127.0.0.1:{self.port}"
            http = build_opener(ProxyHandler({}))
            deadline = time.monotonic() + 25
            while True:
                try:
                    with http.open(endpoint + "/json/version", timeout=1) as response:
                        if not json.load(response).get("webSocketDebuggerUrl"):
                            raise RuntimeError("Invalid CDP response")
                    break
                except (OSError, ValueError):
                    if time.monotonic() >= deadline:
                        raise TimeoutError("CDP did not become ready")
                    time.sleep(0.1)
            rows = listeners(self.port)
            if not rows or any(r["LocalAddress"] not in {"127.0.0.1", "::1"} or
                               not self.debug.contains(r["OwningProcess"]) for r in rows):
                raise RuntimeError("Listener is not owned and loopback-only")
            self.audit("debug_opened", address="127.0.0.1", port=self.port, pid=self.debug.pid,
                       listeners=rows, maxSeconds=self.max_seconds)
            self.timer = threading.Timer(self.max_seconds, lambda: self._end_debug("timeout"))
            self.timer.daemon = True; self.timer.start()
            yield endpoint
        finally:
            if self.timer:
                self.timer.cancel(); self.timer = None
            self._end_debug("client-disconnected-or-scope-ended")

    @contextmanager
    def connect_playwright(self, playwright):
        with self.debug_endpoint() as endpoint:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            # Explicit disconnect closes the diagnostic process, not just the socket.
            browser.on("disconnected", lambda *_: self._end_debug("playwright-disconnected"))
            try:
                yield browser
            finally:
                if browser.is_connected():
                    browser.close()

    def stop(self):
        with self.lock:
            if self.timer:
                self.timer.cancel(); self.timer = None
            if self.debug:
                self.debug.stop(); self.debug = None
            if self.normal:
                self.normal.stop(); self.normal = None

    def run_node(self, script, *arguments):
        """Give a diagnostic script a short-lived endpoint; close it on exit."""
        script = Path(script).resolve(strict=True)
        with self.debug_endpoint() as endpoint:
            self.audit("diagnostic_script_started", script=script.name)
            environment = dict(self.environment, HAYDEV_CDP_ENDPOINT=endpoint,
                               HAYDEV_DEBUG_SESSION=self.session)
            return subprocess.run(["node", str(script), *map(str, arguments)],
                                  cwd=script.parent.parent.parent, env=environment,
                                  timeout=self.max_seconds + 25, check=True)

