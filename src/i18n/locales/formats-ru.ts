import type { formatsEn } from './formats-en';
export const formatsRu = {
  formatYes: 'Да',
  formatNo: 'Нет',
  formatGlyphFallback:
    'Символы, недоступные во встроенных шрифтах, сохранены в виде кодов Unicode, например [U+1F642]',
  exportMarkdownNote: 'Структура доски и ссылки на вложения в Markdown',
  exportPdfNote: 'Документ с разбивкой на страницы для чтения и отправки',
  exportXlsxNote: 'Связанные листы с полными данными доски',
  exportCsvNote: 'Одна строка на карточку, связанные коллекции в ячейках JSON',
  formatCapture: 'Интервал экспорта',
  formatBoard: 'Доска',
  formatStart: 'Начало',
  formatDue: 'Срок',
  formatCompleted: 'Завершено',
  formatLabels: 'Метки',
  formatMembers: 'Участники',
  formatNoLink: 'Исходная ссылка недоступна',
  formatNotice: 'Активное содержимое и ссылки на вложения · импорт из JSON',
} satisfies { [Key in keyof typeof formatsEn]: string };
