import { useEffect, useState } from 'react';
import { platformApi } from '../../platform';
import { useI18n } from '../../i18n';
import type { AiSettings, AiProviderId, AiModel, GeminiReasoning } from '@shared/ai-settings';

export const AI_SETTINGS_TITLE = { ru: 'Настройки AI', en: 'AI settings', hy: 'AI կարգավորումներ' };
const copy = {
  ru: { close:'Закрыть', active:'Провайдер агента', environment:'Автоматически / из окружения', key:'API-ключ', model:'Модель агента (выбор или ID)', live:'Модель Gemini Live (выбор или ID)', refresh:'Загрузить модели', save:'Сохранить настройки', saved:'Настройки сохранены. Применятся к следующему запуску агента.', pending:'Подождите…', remove:'Удалить сохранённый ключ', savedKey:'Ключ сохранён', envKey:'Ключ из окружения', noKey:'Ключ не задан', placeholder:'Вставьте новый ключ; пустое поле сохраняет прежний', note:'Ключи хранятся локально в зашифрованном виде. Сначала сохраните ключ, затем загрузите модели. Gemini Live использует отдельную модель и ключ Gemini.', compatibility:'Для агента нужна модель с поддержкой инструментов. Каталог не гарантирует доступ к каждому режиму.', running:'Для изменения настроек остановите агента.', error:'Не удалось выполнить операцию', unavailable:'Настройки AI доступны в desktop-приложении.', removed:'Ключ будет удалён при сохранении; ключ из окружения, если есть, останется доступен.' },
  en: { close:'Close', active:'Agent provider', environment:'Automatic / environment', key:'API key', model:'Agent model (select or enter ID)', live:'Gemini Live model (select or enter ID)', refresh:'Load models', save:'Save settings', saved:'Settings saved. They apply to the next agent run.', pending:'Please wait…', remove:'Remove saved key', savedKey:'Key saved', envKey:'Key from environment', noKey:'No key configured', placeholder:'Paste a new key; leave blank to keep the existing key', note:'Keys are encrypted locally. Save the key before loading models. Gemini Live uses a separate model and the Gemini key.', compatibility:'The agent requires tool support. Catalog presence does not guarantee every mode is supported.', running:'Stop the agent before changing settings.', error:'Operation failed', unavailable:'AI settings require the desktop app.', removed:'The saved key will be removed on save; an environment key, if present, remains available.' },
  hy: { close:'Փակել', active:'Գործակալի մատակարար', environment:'Ավտոմատ / միջավայրից', key:'API բանալի', model:'Գործակալի մոդել (ընտրեք կամ գրեք ID)', live:'Gemini Live մոդել (ընտրեք կամ գրեք ID)', refresh:'Բեռնել մոդելները', save:'Պահպանել կարգավորումները', saved:'Պահպանվեց։ Կկիրառվի գործակալի հաջորդ գործարկման ժամանակ։', pending:'Սպասեք…', remove:'Հեռացնել պահպանված բանալին', savedKey:'Բանալին պահպանված է', envKey:'Բանալին միջավայրից է', noKey:'Բանալին նշված չէ', placeholder:'Տեղադրեք նոր բանալի կամ թողեք դատարկ՝ հինը պահելու համար', note:'Բանալիները պահվում են տեղային՝ գաղտնագրված։ Նախ պահպանեք բանալին, ապա բեռնեք մոդելները։ Gemini Live-ն օգտագործում է առանձին մոդել և Gemini բանալի։', compatibility:'Գործակալին անհրաժեշտ է գործիքների աջակցություն։ Ցանկում լինելը չի երաշխավորում բոլոր ռեժիմների աջակցությունը։', running:'Կարգավորումները փոխելուց առաջ կանգնեցրեք գործակալին։', error:'Գործողությունը չհաջողվեց', unavailable:'AI կարգավորումները հասանելի են desktop հավելվածում։', removed:'Բանալին կհեռացվի պահպանելիս։ Միջավայրի բանալին, եթե կա, կմնա հասանելի։' },
};
const names = { gemini:'Gemini', openrouter:'OpenRouter', openai:'OpenAI' };
const reasoningCopy = {
  ru: { label:'Размышление Gemini для агента', options:['Авто — быстрые действия, углублённый разбор исследований','По умолчанию у модели','Быстрое','Сбалансированное','Глубокое'], note:'Авто: low для обычных действий; medium для глубокого исследования. Gemini Live настраивается отдельно.' },
  en: { label:'Gemini agent reasoning', options:['Automatic — fast actions, deeper research review','Model default','Fast','Balanced','Deep'], note:'Automatic uses low for ordinary actions and medium for deep research. Gemini Live is configured separately.' },
  hy: { label:'Gemini գործակալի մտածողություն', options:['Ավտոմատ — արագ գործողություններ, խորքային հետազոտության վերլուծություն','Մոդելի լռելյայն','Արագ','Հավասարակշռված','Խորքային'], note:'Ավտոմատ՝ low սովորական քայլերի, medium խորը հետազոտության համար։ Live-ը կարգավորվում է առանձին։' },
};
export function AiSettingsPanel({ onClose, agentRunning }: { onClose: () => void; agentRunning: boolean }) {
  const { lang } = useI18n(); const w = copy[lang];
  const api = platformApi.aiSettings;
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [keys, setKeys] = useState<Partial<Record<AiProviderId, string>>>({});
  const [remove, setRemove] = useState<Partial<Record<AiProviderId, boolean>>>({});
  const [models, setModels] = useState<Partial<Record<AiProviderId, AiModel[]>>>({});
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const fail = (e: unknown) => {
    const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : 'AI_SETTINGS_FAILED';
    setError(`${w.error}: ${code}`);
  };
  useEffect(() => {
    let current = true;
    api?.get().then(s => { if (current) setSettings(s); }).catch(() => { if (current) setError(copy[lang].error); });
    return () => { current = false; };
  }, [api, lang]);
  async function save() {
    if (!api || !settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.save({ ...settings, providers: settings.providers.map(p => ({ id:p.id, model:p.model, apiKey:keys[p.id] || undefined, removeKey:!!remove[p.id] })) });
      setSettings(result); setRemove({}); setMessage(w.saved);
      window.dispatchEvent(new Event('haydev:ai-settings-changed'));
    } catch (e) { fail(e); } finally { setKeys({}); setBusy(false); }
  }
  async function refresh(id: AiProviderId) {
    if (!api) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await api.models(id); setModels(old => ({ ...old, [id]:result.models })); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  return <section className="panel panel--settings ai-settings" aria-label={AI_SETTINGS_TITLE[lang]}>
    <header className="panel__header"><h2>{AI_SETTINGS_TITLE[lang]}</h2><button type="button" className="panel__close" aria-label={w.close} onClick={onClose} disabled={busy}>×</button></header>
    <div className="panel__body ai-settings__body">
      {!api && <p>{w.unavailable}</p>}
      <p>{w.note}</p>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {agentRunning && <p role="status">{w.running}</p>}
      {settings && <>
        <label>{w.active}<select aria-label={w.active} disabled={busy || agentRunning} value={settings.activeProvider} onChange={e => setSettings({ ...settings, activeProvider:e.target.value as AiSettings['activeProvider'] })}>
          <option value="environment">{w.environment}</option>{settings.providers.map(p => <option key={p.id} value={p.id}>{names[p.id]}</option>)}
        </select></label>
        <label>{reasoningCopy[lang].label}<select aria-label={reasoningCopy[lang].label} disabled={busy || agentRunning} value={settings.geminiReasoning || 'adaptive'} onChange={e => setSettings({ ...settings, geminiReasoning:e.target.value as GeminiReasoning })}>
          {(['adaptive','default','low','medium','high'] as const).map((value,i) => <option key={value} value={value}>{reasoningCopy[lang].options[i]}</option>)}
        </select></label>
        <small>{reasoningCopy[lang].note}</small>
        {settings.providers.map(p => <fieldset key={p.id} disabled={busy || agentRunning}>
          <legend>{names[p.id]}</legend>
          <small>{p.keySource === 'saved' ? w.savedKey : p.keySource === 'environment' ? w.envKey : w.noKey}</small>
          <label>{names[p.id]} · {w.key}<input type="password" autoComplete="off" spellCheck={false} maxLength={4096} placeholder={w.placeholder} value={keys[p.id] || ''} disabled={!!remove[p.id]} onChange={e => setKeys({ ...keys, [p.id]:e.target.value })}/></label>
          {p.keySource === 'saved' && <label className="ai-settings__check"><input type="checkbox" checked={!!remove[p.id]} onChange={e => { setRemove({ ...remove, [p.id]:e.target.checked }); setKeys({ ...keys, [p.id]:'' }); }}/>{w.remove}</label>}
          {remove[p.id] && <small>{w.removed}</small>}
          <label>{names[p.id]} · {w.model}<input list={`ai-models-${p.id}`} value={p.model} maxLength={200} onChange={e => setSettings({ ...settings, providers:settings.providers.map(item => item.id === p.id ? { ...item, model:e.target.value } : item) })}/></label>
          <datalist id={`ai-models-${p.id}`}>{models[p.id]?.filter(m => !m.live).map(m => <option key={m.id} value={m.id}/>)}</datalist>
          <button type="button" onClick={() => void refresh(p.id)} disabled={!p.configured || !!keys[p.id] || !!remove[p.id]}>{w.refresh} · {names[p.id]}</button>
        </fieldset>)}
        <label>{w.live}<input disabled={busy || agentRunning} list="ai-live-models" value={settings.geminiLiveModel} maxLength={100} onChange={e => setSettings({ ...settings, geminiLiveModel:e.target.value })}/></label>
        <datalist id="ai-live-models">{models.gemini?.filter(m => m.live).map(m => <option key={m.id} value={m.id}/>)}</datalist>
        <small>{w.compatibility}</small>
        <button type="button" disabled={busy || agentRunning} onClick={() => void save()}>{busy ? w.pending : w.save}</button>
      </>}
    </div>
  </section>;
}
