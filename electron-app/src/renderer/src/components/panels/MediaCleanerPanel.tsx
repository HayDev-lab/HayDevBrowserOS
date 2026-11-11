import { useEffect, useState } from 'react';
import type { MediaCleanerKind } from '@shared/ipc-types';
import { nativeErrorCode } from '@shared/native-errors';
import { useI18n } from '../../i18n';
import { platformApi } from '../../platform';

export const MEDIA_CLEANER_TITLE = {
  en: 'Clean media metadata',
  ru: 'Очистка метаданных',
  hy: 'Մետատվյալների մաքրում',
} as const;

const copy = {
  en: {
    close: 'Close',
    purpose: 'Remove embedded AI provenance (C2PA), location and other descriptive tags. Save a separate copy on this device.',
    image: 'Choose image',
    video: 'Choose video',
    imageFormats: 'JPG, PNG, WebP · up to 64 MiB',
    videoFormats: 'MP4, MOV, WebM, MKV · without re-encoding',
    ffmpeg: 'Video requires FFmpeg on PATH.',
    scope: 'The copy retains display data such as color and orientation. Video cleanup covers container tags. Marks inside frames, sound or the codec remain.',
    pending: 'Preparing a clean copy…',
    saved: 'Clean copy saved',
    cancelled: 'Cancelled',
    unavailable: 'Media cleanup is available in the desktop app.',
    errors: {
      MEDIA_BUSY: 'A media operation is already in progress.',
      MEDIA_IMAGE_TOO_LARGE: 'Choose an image up to 64 MiB.',
      MEDIA_IMAGE_UNSUPPORTED: 'Choose a supported JPG, PNG or WebP image.',
      MEDIA_IMAGE_INVALID: 'The image file is damaged.',
      MEDIA_VIDEO_UNSUPPORTED: 'Choose an MP4, MOV, WebM or MKV file.',
      MEDIA_FFMPEG_MISSING: 'Video requires FFmpeg on PATH.',
      MEDIA_OUTPUT_EXISTS: 'A file with that name exists. Choose a new name.',
      MEDIA_OUTPUT_FORMAT: 'Save the copy in the original file format.',
      MEDIA_VIDEO_TIMEOUT: 'Video cleanup exceeded the time limit.',
      MEDIA_VIDEO_FAILED: 'FFmpeg could not copy the video streams.',
    },
    error: 'Could not save a clean copy.',
  },
  ru: {
    close: 'Закрыть',
    purpose: 'Удаляет встроенные метки ИИ (C2PA), геоданные и описательные теги. Сохраняет отдельную копию на этом устройстве.',
    image: 'Выбрать изображение',
    video: 'Выбрать видео',
    imageFormats: 'JPG, PNG, WebP · до 64 MiB',
    videoFormats: 'MP4, MOV, WebM, MKV · без перекодирования',
    ffmpeg: 'Для видео нужен FFmpeg в PATH.',
    scope: 'Цветовой профиль и ориентация сохраняются. В видео очищаются теги контейнера. Метки внутри кадров, звука или кодека сохраняются.',
    pending: 'Подготовка очищенной копии…',
    saved: 'Очищенная копия сохранена',
    cancelled: 'Отменено',
    unavailable: 'Очистка доступна в настольном приложении.',
    errors: {
      MEDIA_BUSY: 'Обработка файла уже запущена.',
      MEDIA_IMAGE_TOO_LARGE: 'Выберите изображение размером до 64 MiB.',
      MEDIA_IMAGE_UNSUPPORTED: 'Выберите поддерживаемое изображение JPG, PNG или WebP.',
      MEDIA_IMAGE_INVALID: 'Файл изображения повреждён.',
      MEDIA_VIDEO_UNSUPPORTED: 'Выберите видео в формате MP4, MOV, WebM или MKV.',
      MEDIA_FFMPEG_MISSING: 'Для видео нужен FFmpeg в PATH.',
      MEDIA_OUTPUT_EXISTS: 'Файл с таким именем уже есть. Укажите новое имя.',
      MEDIA_OUTPUT_FORMAT: 'Сохраните копию в исходном формате файла.',
      MEDIA_VIDEO_TIMEOUT: 'Превышено время обработки видео.',
      MEDIA_VIDEO_FAILED: 'FFmpeg не смог скопировать дорожки видео.',
    },
    error: 'Не удалось сохранить очищенную копию.',
  },
  hy: {
    close: 'Փակել',
    purpose: 'Հեռացնում է ներկառուցված AI պիտակները (C2PA), տեղադրության տվյալներն ու նկարագրական պիտակները։ Պահպանում է առանձին պատճեն այս սարքում։',
    image: 'Ընտրել պատկեր',
    video: 'Ընտրել տեսանյութ',
    imageFormats: 'JPG, PNG, WebP · մինչև 64 MiB',
    videoFormats: 'MP4, MOV, WebM, MKV · առանց վերակոդավորման',
    ffmpeg: 'Տեսանյութի համար FFmpeg-ը պետք է հասանելի լինի PATH-ում։',
    scope: 'Գունային պրոֆիլն ու կողմնորոշումը պահպանվում են։ Տեսանյութից հեռացվում են կոնտեյների պիտակները։ Կադրերի, ձայնի կամ կոդեկի մեջ ներկառուցված նշանները մնում են։',
    pending: 'Մաքրված պատճենը պատրաստվում է…',
    saved: 'Մաքրված պատճենը պահպանվել է',
    cancelled: 'Չեղարկվեց',
    unavailable: 'Մաքրումը հասանելի է համակարգչային հավելվածում։',
    errors: {
      MEDIA_BUSY: 'Ֆայլի մշակումը արդեն ընթանում է։',
      MEDIA_IMAGE_TOO_LARGE: 'Ընտրեք մինչև 64 MiB պատկեր։',
      MEDIA_IMAGE_UNSUPPORTED: 'Ընտրեք աջակցվող JPG, PNG կամ WebP պատկեր։',
      MEDIA_IMAGE_INVALID: 'Պատկերի ֆայլը վնասված է։',
      MEDIA_VIDEO_UNSUPPORTED: 'Ընտրեք MP4, MOV, WebM կամ MKV տեսանյութ։',
      MEDIA_FFMPEG_MISSING: 'Տեսանյութի համար FFmpeg-ը պետք է հասանելի լինի PATH-ում։',
      MEDIA_OUTPUT_EXISTS: 'Այդ անունով ֆայլ արդեն կա։ Ընտրեք նոր անուն։',
      MEDIA_OUTPUT_FORMAT: 'Պահպանեք պատճենը սկզբնական ձևաչափով։',
      MEDIA_VIDEO_TIMEOUT: 'Տեսանյութի մշակման ժամանակը սպառվել է։',
      MEDIA_VIDEO_FAILED: 'FFmpeg-ը չկարողացավ պատճենել տեսանյութի հոսքերը։',
    },
    error: 'Չհաջողվեց պահպանել մաքրված պատճենը։',
  },
} as const;

export function MediaCleanerPanel({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const labels = copy[lang];
  const title = MEDIA_CLEANER_TITLE[lang];
  const api = platformApi.mediaCleaner;
  const [videoAvailable, setVideoAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    { kind: 'saved'; fileName: string } | { kind: 'cancelled' } | { kind: 'error'; code: string } | null
  >(null);

  useEffect(() => {
    let mounted = true;
    api?.videoAvailable().then(
      value => { if (mounted) setVideoAvailable(value); },
      () => { if (mounted) setVideoAvailable(false); },
    );
    return () => { mounted = false; };
  }, [api]);

  async function clean(kind: MediaCleanerKind) {
    if (!api) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await api.clean(kind);
      setOutcome(result ? { kind: 'saved', fileName: result.fileName } : { kind: 'cancelled' });
    } catch (issue) {
      setOutcome({ kind: 'error', code: nativeErrorCode(issue) });
    } finally {
      setBusy(false);
    }
  }

  const errorMessages: Partial<Record<string, string>> = labels.errors;
  return (
    <section className="panel panel--settings" aria-label={title}>
      <header className="panel__header">
        <h2>{title}</h2>
        <button type="button" className="panel__close" aria-label={labels.close} onClick={onClose} disabled={busy}>×</button>
      </header>
      <div className="panel__body media-cleaner">
        <p>{labels.purpose}</p>
        <div className="media-cleaner__option">
          <button type="button" disabled={busy || !api} onClick={() => void clean('image')}>{labels.image}</button>
          <small>{labels.imageFormats}</small>
        </div>
        <div className="media-cleaner__option">
          <button type="button" disabled={busy || videoAvailable !== true} onClick={() => void clean('video')}>{labels.video}</button>
          <small>{videoAvailable === false ? labels.ffmpeg : labels.videoFormats}</small>
        </div>
        <small>{labels.scope}</small>
        {!api && <p>{labels.unavailable}</p>}
        {busy && <p role="status">{labels.pending}</p>}
        {outcome?.kind === 'saved' && <p role="status">{labels.saved} · <strong>{outcome.fileName}</strong></p>}
        {outcome?.kind === 'cancelled' && <p role="status">{labels.cancelled}</p>}
        {outcome?.kind === 'error' && <p role="alert">{errorMessages[outcome.code] ?? labels.error}</p>}
      </div>
    </section>
  );
}
