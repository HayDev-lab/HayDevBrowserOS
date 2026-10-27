import { useEffect, useRef, useState } from "react";
import type { TabState } from "@shared/browser-types";
import type { PokerMemory } from "@shared/poker-types";
import type { AgentStatusSnapshot } from "@shared/agent-types";
import { platformApi } from "../platform";
import { useI18n } from "../i18n";
import { PokerGeminiLive } from "../poker-gemini-live";

// Speech recognition is optional in WebView2; no silent claim of a live provider connection.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
const words = {
  ru: {
    tab: "Вкладка со столом",
    refresh: "Обновить",
    format: "Формат",
    mode: "Режим",
    human: "Live Human — советы",
    auto: "Auto — действия",
    cash: "Кэш",
    mtt: "Турнир",
    start: "Начать",
    stop: "Остановить",
    newSession: "Новая сессия",
    voice: "Озвучивать ответы",
    mic: "Голосовой ввод",
    send: "Отправить",
    placeholder: "Вопрос агенту…",
    import: "Добавить книгу / знания",
    importSkill: "Импорт Book-to-Skill",
    memory: "Память сессии",
    empty: "Ответы агента появятся здесь.",
    noSpeech: "Голосовой ввод недоступен в этом WebView. Используй текст.",
    unsupported: "Покерный модуль доступен в Tauri.",
    note: "Экран выбранной вкладки передаётся настроенной модели. Рекомендации пока эвристические: GTO-солвер не подключён.",
    listening: "Слушаю…",
    active: "Сессия идёт",
    idle: "Остановлено",
    imported: "Добавлено",
    candidates: "Гипотезы для проверки",
  },
  en: {
    tab: "Poker tab",
    refresh: "Refresh",
    format: "Format",
    mode: "Mode",
    human: "Live Human — advice",
    auto: "Auto — actions",
    cash: "Cash",
    mtt: "Tournament",
    start: "Start",
    stop: "Stop",
    newSession: "New session",
    voice: "Speak replies",
    mic: "Voice input",
    send: "Send",
    placeholder: "Ask the agent…",
    import: "Import book / knowledge",
    importSkill: "Import Book-to-Skill",
    memory: "Session memory",
    empty: "Agent replies will appear here.",
    noSpeech: "Voice input is unavailable in this WebView. Use text.",
    unsupported: "Poker requires the Tauri runtime.",
    note: "The selected tab is shared with your configured model. Advice is heuristic: no GTO solver is connected yet.",
    listening: "Listening…",
    active: "Session active",
    idle: "Stopped",
    imported: "Imported",
    candidates: "Candidate lessons",
  },
};
const LAST_SESSION = "haydev-poker-session-v1";
export function PokerPanel({
  agentRunning,
  status,
}: {
  agentRunning: boolean;
  status: AgentStatusSnapshot | null;
}) {
  const { lang } = useI18n();
  const w = words[lang === "ru" ? "ru" : "en"];
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [tabId, setTabId] = useState("");
  const [format, setFormat] = useState<"cash" | "mtt">("cash");
  const [mode, setMode] = useState<"human" | "auto">("human");
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem(LAST_SESSION) || crypto.randomUUID(),
  );
  const [running, setRunning] = useState(false);
  const [useGemini, setUseGemini] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState("");
  const [useMicrophone, setUseMicrophone] = useState(true);
  const gemini = useRef<PokerGeminiLive | null>(null);
  const [voice, setVoice] = useState(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice && !useGemini;
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const [question, setQuestion] = useState("");
  const [replies, setReplies] = useState<string[]>([]);
  const [memory, setMemory] = useState<PokerMemory | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const active = running || Boolean(agentRunning && status?.poker);
  const liveSession = useRef({ active, sessionId });
  liveSession.current = { active, sessionId };
  const mounted = useRef(true);
  function fail(e: unknown) {
    setError(
      typeof e === "object" && e && "message" in e
        ? String(e.message)
        : String(e),
    );
  }
  async function refreshTabs() {
    try {
      const list = await platformApi.browser.listTabs();
      setTabs(list);
      setTabId((old) =>
        list.some((t) => t.id === old)
          ? old
          : list.find((t) => t.isActive)?.id || list[0]?.id || "",
      );
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    void refreshTabs();
  }, []);
  useEffect(() => {
    let alive = true;
    void platformApi.poker?.live
      ?.status()
      .then((s) => {
        if (alive) {
          setUseGemini(s.configured);
          setGeminiStatus(
            s.configured ? `${s.model}: ready` : "GEMINI_KEY_NOT_CONFIGURED",
          );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      void gemini.current?.close();
    };
  }, []);
  useEffect(() => {
    if (agentRunning && status?.poker) {
      setSessionId(status.poker.sessionId);
      setTabId(status.poker.tabId);
      setFormat(status.poker.format);
      setMode(status.poker.mode);
    }
  }, [agentRunning, status?.poker?.sessionId]);
  useEffect(() => {
    mounted.current = true;
    const off = platformApi.on("poker:advice", (data) => {
      const advice = data as { sessionId: string; text: string };
      if (advice.sessionId !== sessionId || typeof advice.text !== "string")
        return;
      setReplies((prev) => [...prev.slice(-49), advice.text]);
      if (voiceRef.current && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(advice.text);
        utterance.lang =
          lang === "ru" ? "ru-RU" : lang === "hy" ? "hy-AM" : "en-US";
        window.speechSynthesis.speak(utterance);
      }
    });
    return () => {
      mounted.current = false;
      off();
      recognition.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [sessionId, lang]);
  async function start() {
    if (running || agentRunning || !tabId || !platformApi.poker) return;
    setError("");
    setRunning(true);
    localStorage.setItem(LAST_SESSION, sessionId);
    try {
      const control = await platformApi.control.setMode("AGENT");
      if (!control.accepted)
        throw new Error(control.reason || "CONTROL_DENIED");
      if (useGemini) {
        const api = platformApi.poker.live;
        if (!api) throw new Error("GEMINI_LIVE_UNAVAILABLE");
        const client = new PokerGeminiLive(
          api,
          { sessionId, tabId, format },
          mode,
          lang,
          {
            text: (role, text) => {
              if (mounted.current)
                setReplies((prev) => [
                  ...prev.slice(-49),
                  role === "user" ? `› ${text}` : text,
                ]);
            },
            status: (text) => {
              if (mounted.current) setGeminiStatus(text);
            },
            error: (text) => {
              if (mounted.current) setError(text);
            },
            ended: () => {
              gemini.current = null;
              if (mounted.current) {
                setRunning(false);
                setListening(false);
              }
            },
          },
        );
        gemini.current = client;
        await client.start(useMicrophone);
        setListening(useMicrophone);
        return;
      }
      const result = await platformApi.agent.run({
        command:
          "Start the poker session. Observe the selected table, read the relevant poker skill and respond in the user interface language. Wait between observations. Continue until stopped.",
        profile: mode === "human" ? "POKER_HUMAN" : "POKER_AUTO",
        poker: { sessionId, tabId, format },
      });
      if (result.error || result.state === "FAILED")
        throw new Error(result.error || result.reason || "POKER_RUN_FAILED");
      if (result.answer && mounted.current)
        setReplies((prev) => [...prev.slice(-49), result.answer!]);
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current && !gemini.current) setRunning(false);
    }
  }
  async function stop() {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
    await gemini.current?.close();
    try {
      await platformApi.control.takeControl("poker_stop");
    } catch (e) {
      fail(e);
    }
  }
  async function send() {
    if (!question.trim() || !active || !platformApi.poker) return;
    try {
      if (gemini.current) {
        gemini.current.sendText(question.trim());
      } else {
        await platformApi.poker.message(sessionId, question.trim());
      }
      setReplies((prev) => [...prev.slice(-49), `› ${question.trim()}`]);
      setQuestion("");
    } catch (e) {
      fail(e);
    }
  }
  function microphone() {
    if (gemini.current) {
      gemini.current.mute(listening);
      setListening(!listening);
      return;
    }
    if (listening) {
      recognition.current?.abort();
      return;
    }
    const Constructor =
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!Constructor) {
      setError(w.noSpeech);
      return;
    }
    const rec = new Constructor();
    recognition.current = rec;
    rec.lang = lang === "ru" ? "ru-RU" : lang === "hy" ? "hy-AM" : "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const text = event.results[i][0]?.transcript.trim();
        if (!text) continue;
        window.speechSynthesis?.cancel();
        if (/^(стоп|stop|կանգ)[.!]?$/iu.test(text)) {
          void stop();
          continue;
        }
        if (liveSession.current.active && platformApi.poker) {
          void platformApi.poker
            .message(liveSession.current.sessionId, text)
            .then(() => setReplies((prev) => [...prev.slice(-49), `› ${text}`]))
            .catch(fail);
        } else {
          setQuestion((prev) => `${prev} ${text}`.trim());
        }
      }
    };
    rec.onerror = (event) => {
      setError(`${w.noSpeech} (${event.error})`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      fail(e);
    }
  }
  if (!platformApi.poker) return <p role="status">{w.unsupported}</p>;
  return (
    <section className="poker-panel" aria-label="Poker">
      <p className="poker-panel__note">{w.note}</p>
      {platformApi.poker.live && (
        <>
          <label className="poker-panel__voice">
            <input
              type="checkbox"
              checked={useGemini}
              disabled={active}
              onChange={(e) => setUseGemini(e.target.checked)}
            />
            Gemini Live
          </label>
          {useGemini && (
            <label className="poker-panel__voice">
              <input
                type="checkbox"
                checked={useMicrophone}
                disabled={active}
                onChange={(e) => setUseMicrophone(e.target.checked)}
              />
              {lang === "ru" ? "Передавать микрофон" : "Share microphone"}
            </label>
          )}
          <button
            type="button"
            disabled={active}
            onClick={() =>
              void platformApi
                .poker!.live!.importToken()
                .then((r) => {
                  if (r.configured) {
                    setUseGemini(true);
                    setGeminiStatus(
                      lang === "ru"
                        ? "Ключ подключён до закрытия браузера"
                        : "Key connected until browser closes",
                    );
                  }
                })
                .catch(fail)
            }
          >
            {lang === "ru"
              ? "Подключить .token (Gemini)"
              : "Connect .token (Gemini)"}
          </button>
          <small role="status">{geminiStatus}</small>
        </>
      )}
      <label>
        {w.tab}
        <select
          value={tabId}
          onChange={(e) => {
            setTabId(e.target.value);
            setSessionId(crypto.randomUUID());
          }}
          disabled={active}
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title || t.url || t.id}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void refreshTabs()}
        disabled={active}
      >
        {w.refresh}
      </button>
      <div className="poker-panel__row">
        <label>
          {w.format}
          <select
            value={format}
            disabled={active}
            onChange={(e) => {
              setFormat(e.target.value as "cash" | "mtt");
              setSessionId(crypto.randomUUID());
            }}
          >
            <option value="cash">{w.cash}</option>
            <option value="mtt">{w.mtt}</option>
          </select>
        </label>
        <label>
          {w.mode}
          <select
            value={mode}
            disabled={active}
            onChange={(e) => {
              setMode(e.target.value as "human" | "auto");
              setSessionId(crypto.randomUUID());
            }}
          >
            <option value="human">{w.human}</option>
            <option value="auto">{w.auto}</option>
          </select>
        </label>
      </div>
      <div className="poker-panel__row">
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || agentRunning || !tabId}
        >
          {w.start}
        </button>
        <button type="button" onClick={() => void stop()} disabled={!active}>
          {w.stop}
        </button>
        <button
          type="button"
          disabled={active}
          onClick={() => {
            const id = crypto.randomUUID();
            setSessionId(id);
            localStorage.setItem(LAST_SESSION, id);
            setMemory(null);
            setReplies([]);
          }}
        >
          {w.newSession}
        </button>
      </div>
      <p role="status">
        {active ? w.active : w.idle} · {sessionId.slice(0, 8)}
      </p>
      {!useGemini && (
        <label className="poker-panel__voice">
          <input
            type="checkbox"
            checked={voice}
            onChange={(e) => {
              setVoice(e.target.checked);
              if (!e.target.checked) window.speechSynthesis?.cancel();
            }}
          />
          {w.voice}
        </label>
      )}
      <div className="poker-panel__replies" role="log" aria-live="polite">
        {replies.length ? (
          replies.map((text, i) => <p key={i}>{text}</p>)
        ) : (
          <p>{w.empty}</p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          aria-label={w.placeholder}
          placeholder={w.placeholder}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={4000}
        />
        <div className="poker-panel__row">
          <button type="button" onClick={microphone} aria-pressed={listening}>
            {listening ? w.listening : w.mic}
          </button>
          <button type="submit" disabled={!active || !question.trim()}>
            {w.send}
          </button>
        </div>
      </form>
      <div className="poker-panel__row">
        <button
          type="button"
          disabled={importing}
          onClick={() => {
            setImporting(true);
            setError("");
            void platformApi
              .poker!.importKnowledge()
              .then((r) => {
                if (!r.cancelled)
                  setReplies((prev) => [
                    ...prev,
                    `${w.imported}: ${r.title} (${r.status})`,
                  ]);
              })
              .catch(fail)
              .finally(() => setImporting(false));
          }}
        >
          {w.import}
        </button>
        <button
          type="button"
          disabled={importing}
          onClick={() => {
            setImporting(true);
            setError("");
            void platformApi
              .poker!.importKnowledge("skill")
              .then((r) => {
                if (!r.cancelled)
                  setReplies((prev) => [
                    ...prev,
                    `${w.imported}: ${r.title} (${r.status})`,
                  ]);
              })
              .catch(fail)
              .finally(() => setImporting(false));
          }}
        >
          {w.importSkill}
        </button>
        <button
          type="button"
          onClick={() =>
            void platformApi
              .poker!.memory(sessionId)
              .then(setMemory)
              .catch(fail)
          }
        >
          {w.memory}
        </button>
      </div>
      {memory && (
        <details>
          <summary>
            {w.memory}: {memory.events.length} · {w.candidates}:{" "}
            {memory.lessons.length}
          </summary>
          <pre>{JSON.stringify(memory, null, 2)}</pre>
        </details>
      )}
      {error && (
        <p className="poker-panel__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
