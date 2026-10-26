import { expect, test } from 'vitest';
import { createSyntheticCapture } from '../helpers/board-capture';

test('synthetic fixtures contain linked content and source attachment metadata', () => {
  const { snapshot } = createSyntheticCapture();
  expect(snapshot.cards).toHaveLength(6);
  expect(snapshot.checklistItems).toHaveLength(19);
  expect(snapshot.comments).toHaveLength(3);
  expect(snapshot.attachments).toHaveLength(3);
  expect(
    snapshot.attachments.every(
      (a) => a.file === null && a.url?.startsWith('https://trello.com/1/cards/'),
    ),
  ).toBe(true);
  expect(snapshot.cards.some((card) => card.closed)).toBe(false);
  expect(new Set(snapshot.cards.map((card) => card.id)).size).toBe(6);
  snapshot.cards[0]!.name = 'Changed';
  expect(createSyntheticCapture().snapshot.cards[0]?.name).not.toBe('Changed');
});
