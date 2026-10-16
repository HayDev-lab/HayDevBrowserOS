import type { AppLocale } from './app-locale';

// Codes cross both native IPC and the internal-page bridge. Never display a
// parser's raw message, filesystem path, document excerpt or provider payload.
const rows: Record<string, readonly [string, string, string]> = {
  ATTACHMENT_PICK_TIMEOUT: ['Document selection timed out.', 'Время выбора документа истекло.', 'Փաստաթղթի ընտրության ժամանակը սպառվել է։'],
  ATTACHMENT_PICK_FAILED: ['Document selection failed.', 'Не удалось выбрать документ.', 'Չհաջողվեց ընտրել փաստաթուղթը։'],
  DOCUMENT_EMPTY: ['The document is empty.', 'Документ пуст.', 'Փաստաթուղթը դատարկ է։'],
  DOCUMENT_CORRUPT: ['The document is damaged or unreadable.', 'Документ повреждён или не читается.', 'Փաստաթուղթը վնասված է կամ չի ընթերցվում։'],
  DOCUMENT_PROTECTED: ['The document is password protected.', 'Документ защищён паролем.', 'Փաստաթուղթը պաշտպանված է գաղտնաբառով։'],
  DOCUMENT_SCAN_REQUIRES_OCR: ['This scan needs OCR; no text was extracted.', 'Для скана требуется OCR; текст не извлечён.', 'Այս սկանը պահանջում է OCR․ տեքստ չի արտահանվել։'],
  DOCUMENT_TOO_LARGE: ['The file exceeds the size limit.', 'Файл превышает допустимый размер.', 'Ֆայլը գերազանցում է չափի սահմանը։'],
  DOCUMENT_PAGE_LIMIT: ['The PDF exceeds the 300 page limit.', 'PDF превышает лимит в 300 страниц.', 'PDF-ը գերազանցում է 300 էջի սահմանը։'],
  DOCUMENT_ARCHIVE_LIMIT: ['The expanded document exceeds the safety limit.', 'Распакованный документ превышает допустимый объём.', 'Ապափաթեթավորված փաստաթուղթը գերազանցում է թույլատրելի ծավալը։'],
  DOCUMENT_CANCELLED: ['Document processing was cancelled.', 'Обработка документа отменена.', 'Փաստաթղթի մշակումը չեղարկվել է։'],
  DOCUMENT_TIMEOUT: ['Document processing exceeded 10 seconds.', 'Обработка документа превысила 10 секунд.', 'Փաստաթղթի մշակումը գերազանցել է 10 վայրկյանը։'],
  DOCUMENT_UNSUPPORTED: ['This document format is not supported.', 'Этот формат документа не поддерживается.', 'Փաստաթղթի այս ձևաչափը չի աջակցվում։'],
  ATTACHMENT_NOT_FOUND: ['The attachment is no longer available. Select it again.', 'Вложение недоступно. Выберите файл заново.', 'Կցված ֆայլն այլևս հասանելի չէ։ Ընտրեք այն կրկին։'],
  ATTACHMENT_EXPIRED: ['The attachment expired. Select it again.', 'Срок хранения вложения истёк. Выберите файл заново.', 'Կցված ֆայլի պահպանման ժամկետը լրացել է։ Ընտրեք այն կրկին։'],
  ATTACHMENT_OWNER_MISMATCH: ['This attachment belongs to another page.', 'Это вложение принадлежит другой странице.', 'Այս կցված ֆայլը պատկանում է այլ էջի։'],
  ATTACHMENT_RUN_MISMATCH: ['This attachment is being used by another run.', 'Это вложение используется другим запуском.', 'Այս կցված ֆայլն օգտագործվում է այլ գործարկման կողմից։'],
  ATTACHMENT_LIMIT: ['The attachment limit was reached.', 'Достигнут лимит вложений.', 'Կցված ֆայլերի սահմանը լրացել է։'],
};
export function attachmentErrorStrings(lang: AppLocale): Record<string, string> {
  const index = lang === 'ru' ? 1 : lang === 'hy' ? 2 : 0;
  return Object.fromEntries(Object.entries(rows).map(([code, values]) => [code, values[index]]));
}
export function attachmentErrorMessage(error: unknown, lang: AppLocale, fallback: string): string {
  const raw = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }).code ?? (error as { message?: unknown }).message : error;
  const code = String(raw ?? '').match(/(?:DOCUMENT|ATTACHMENT)_[A-Z_]+/)?.[0];
  return code ? attachmentErrorStrings(lang)[code] ?? fallback : fallback;
}
