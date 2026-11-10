"""Read-only installed UI acceptance; leave the restored normal app without CDP.

Does not invoke a model or modify credentials. Use only with a known profile
whose previous app instance has been closed by the owner.
"""
from pathlib import Path
import hashlib
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from webview2_debug import DebugBroker, listeners
from verify_debug_lifecycle import no_cdp


def main():
    executable = Path(sys.argv[1]).resolve(strict=True)
    profile = Path(sys.argv[2]).resolve(strict=True)
    output = Path(sys.argv[3]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    settings = profile / "ai-settings.json"
    # Hash encrypted bytes only; never decode, decrypt or print provider keys.
    before = hashlib.sha256(settings.read_bytes()).hexdigest()
    broker = DebugBroker(executable, profile, max_seconds=120,
                         extra_environment={"HAYDEV_QA_MODE": "1", "HAYDEV_NO_ENGINES": "1",
                                            "GEMINI_API_KEY": "", "OPENAI_API_KEY": "",
                                            "OPENROUTER_API_KEY": ""})
    try:
        broker.start_normal()
        normal_before = no_cdp(broker.normal)
        normal_after = no_cdp(broker.normal)
        after = hashlib.sha256(settings.read_bytes()).hexdigest()
        assert before == after, "Encrypted AI settings changed during read-only acceptance"
        rows = [json.loads(line) for line in broker.audit_path.read_text(encoding="utf-8").splitlines()]
        opened = [r for r in rows if r.get("event") == "debug_opened" and r.get("session") == broker.session]
        assert opened and all(not listeners(r["port"]) for r in opened)
        result = {"passed": True, "executable": str(executable),
                  "sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
                  "normalPid": broker.normal.pid, "cdpArgumentsPresent": False,
                  "ownedWebViewProcessesBefore": normal_before,
                  "ownedWebViewProcessesAfter": normal_after,
                  "temporaryPortsClosed": [r["port"] for r in opened],
                  "encryptedSettingsUnchanged": True, "settingsSha256": after,
                  "realApiCalled": False, "audit": str(broker.audit_path)}
        Path(str(output) + "-normal.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result, indent=2))
        # Normal job has no KILL_ON_JOB_CLOSE. Closing the controller handles
        # leaves the user's normal UI running; diagnostic job is already gone.
    except BaseException:
        broker.stop()
        raise


if __name__ == "__main__":
    main()
