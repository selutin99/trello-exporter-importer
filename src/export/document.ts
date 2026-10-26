import { snapshotRelations } from '../snapshot/relations';
import type { SnapshotRelations } from '../snapshot/relations';
import { orderedRecords } from '../snapshot/collections';
import type { Snapshot } from '../snapshot/types';
import { translations } from '../i18n';
import type { Locale } from '../i18n';

export enum BlockKind {
  Title = 'title',
  Section = 'section',
  Heading = 'heading',
  Text = 'text',
  Item = 'item',
}
export interface DocumentBlock {
  kind: BlockKind;
  text: string;
  checked?: boolean;
}

const paragraph = (text: string): DocumentBlock => ({ kind: BlockKind.Text, text });
const dateFormats = new Map<Locale, Intl.DateTimeFormat>();
function displayDate(value: string | null, locale: Locale): string {
  if (!value) return '';
  let formatter = dateFormats.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    dateFormats.set(locale, formatter);
  }
  return `${formatter.format(new Date(value))} UTC`;
}

function metadata(
  snapshot: Snapshot,
  card: Snapshot['cards'][number],
  locale: Locale,
): DocumentBlock[] {
  const text = translations[locale];
  const labels = snapshot.labels
    .filter((label) => card.labelIds.includes(label.id))
    .map((label) => label.name)
    .join(', ');
  const members = snapshot.members
    .filter((member) => card.memberIds.includes(member.id))
    .map((member) => member.displayName)
    .join(', ');
  return [
    [text.formatStart, displayDate(card.start, locale)],
    [text.formatDue, displayDate(card.due, locale)],
    [text.formatCompleted, card.dueComplete ? text.formatYes : text.formatNo],
    [text.formatLabels, labels],
    [text.formatMembers, members],
  ]
    .filter((entry) => entry[1])
    .map(([name, value]) => paragraph(`${name}: ${value}`));
}
function checklistBlocks(
  relations: SnapshotRelations,
  cardId: string,
  locale: Locale,
): DocumentBlock[] {
  return orderedRecords(relations.checklists.get(cardId) ?? []).flatMap((checklist) => [
    paragraph(checklist.name),
    ...orderedRecords(relations.items.get(checklist.id) ?? []).map((item): DocumentBlock => {
      const due = item.due ? ` (${displayDate(item.due, locale)})` : '';
      return { kind: BlockKind.Item, text: item.name + due, checked: item.checked };
    }),
  ]);
}
function cardBlocks(
  snapshot: Snapshot,
  relations: SnapshotRelations,
  card: Snapshot['cards'][number],
  locale: Locale,
): DocumentBlock[] {
  const text = translations[locale];
  return [
    { kind: BlockKind.Heading, text: card.name },
    paragraph(card.description),
    ...metadata(snapshot, card, locale),
    ...checklistBlocks(relations, card.id, locale),
    ...orderedRecords(relations.comments.get(card.id) ?? []).map((comment) =>
      paragraph(
        `${text.exportComments} · ${comment.authorDisplayName ?? '—'} · ${displayDate(comment.createdAt, locale)}\n${comment.text}`,
      ),
    ),
    ...(relations.attachments.get(card.id) ?? []).map((attachment) =>
      paragraph(
        `${text.exportAttachmentLabel}: ${attachment.name}\n${attachment.url ?? text.formatNoLink}`,
      ),
    ),
  ];
}

/**
 * Creates a complete reading view without executing board Markdown, HTML, or external links
 * @param snapshot - Current normalized board content
 * @param locale - Interface language for document labels
 * @returns Ordered board/list/card content blocks
 */
export function documentBlocks(snapshot: Snapshot, locale: Locale): DocumentBlock[] {
  const text = translations[locale];
  const relations = snapshotRelations(snapshot);
  const blocks: DocumentBlock[] = [
    { kind: BlockKind.Title, text: snapshot.board.name },
    paragraph(
      `${text.formatCapture}: ${displayDate(snapshot.capture.startedAt, locale)} — ${displayDate(snapshot.capture.completedAt, locale)}`,
    ),
    paragraph(text.formatNotice),
    paragraph(snapshot.board.description),
  ];
  for (const list of orderedRecords(snapshot.lists)) {
    blocks.push({ kind: BlockKind.Section, text: list.name });
    for (const card of orderedRecords(relations.cards.get(list.id) ?? []))
      blocks.push(...cardBlocks(snapshot, relations, card, locale));
  }
  if (snapshot.issues.length) {
    blocks.push({ kind: BlockKind.Section, text: text.exportWarnings });
    blocks.push(
      ...snapshot.issues.map((issue) =>
        paragraph(`${issue.code} · ${issue.entityType} · ${issue.entityId ?? '—'}`),
      ),
    );
  }
  return blocks;
}
