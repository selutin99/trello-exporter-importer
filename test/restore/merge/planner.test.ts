import { expect, test } from 'vitest';
import { buildMergePlan, targetState } from '../../../src/restore/merge/planner';
import {
  MergeActionKind,
  MergeChoice,
  MergeConflictKind,
  MergeField,
} from '../../../src/restore/merge/types';
import { RestoreErrorCode, RestoreResource } from '../../../src/restore/codes';
import { IssueCode, AttachmentKind } from '../../../src/snapshot/codes';
import { createSyntheticCapture } from '../../helpers/board-capture';
import { readImport } from '../../../src/import/read';
import { jsonBytes } from '../../../src/snapshot/encoding';
import { restoreJournal } from '../../helpers/restore';
import { id } from '../../helpers/snapshot';
import { attributedComment } from '../../../src/restore/comments';
import { Locale } from '../../../src/i18n';

async function setup() {
  const input = await readImport(new Blob([jsonBytes(createSyntheticCapture().snapshot)]));
  return { input, current: structuredClone(input.snapshot) };
}

test('identical content is a no-op and capture timestamps do not invalidate review', async () => {
  const { input, current } = await setup();
  current.capture.completedAt = '2026-10-21T10:00:00Z';
  const plan = buildMergePlan(input, current);
  expect(plan.actions).toEqual([]);
  expect(plan.conflicts).toEqual([]);
  expect(plan.bindings[`cards/${input.snapshot.cards[0]!.id}`]).toBe(input.snapshot.cards[0]!.id);
  expect(targetState(current)).toBe(targetState(input.snapshot));
});

test.each([MergeField.Start, MergeField.Due] as const)(
  'Trello timestamp normalization does not introduce a card %s conflict',
  async (field) => {
    const { input, current } = await setup();
    const [sourceCard] = input.snapshot.cards;
    const [currentCard] = current.cards;
    if (!sourceCard || !currentCard) throw new Error('Expected synthetic cards');
    sourceCard[field] = '2026-11-20T12:00:00Z';
    currentCard[field] = '2026-11-20T12:00:00.000Z';
    expect(buildMergePlan(input, current).conflicts).toEqual([]);
    expect(buildMergePlan(input, current).actions).toEqual([]);
    currentCard[field] = '2026-11-20T12:00:00.001Z';
    expect(buildMergePlan(input, current).conflicts).toMatchObject([{ field }]);
    currentCard[field] = null;
    expect(buildMergePlan(input, current).conflicts).toMatchObject([{ field }]);
  },
);

test('equivalent checklist due timestamps do not require a conflict choice', async () => {
  const { input, current } = await setup();
  const [sourceItem] = input.snapshot.checklistItems;
  const [currentItem] = current.checklistItems;
  if (!sourceItem || !currentItem) throw new Error('Expected synthetic checklist items');
  sourceItem.due = '2026-11-20T12:00:00Z';
  currentItem.due = '2026-11-20T12:00:00.000Z';
  expect(buildMergePlan(input, current).conflicts).toEqual([]);
  currentItem.due = '2026-11-21T12:00:00.000Z';
  expect(buildMergePlan(input, current).conflicts).toMatchObject([
    { field: MergeField.Due, record: { resource: RestoreResource.Item } },
  ]);
});

test('each differing field requires its own choice and current-only data is retained', async () => {
  const { input, current } = await setup();
  const card = current.cards[0]!;
  card.name = 'Current name';
  card.description = 'Current description';
  current.cards.push({ ...card, id: id(900), name: 'Current-only card' });
  let plan = buildMergePlan(input, current);
  expect(plan.unresolved).toBe(2);
  const name = plan.conflicts.find((conflict) => conflict.field === MergeField.Name)!;
  const description = plan.conflicts.find((conflict) => conflict.field === MergeField.Description)!;
  plan = buildMergePlan(input, current, {
    [name.key]: MergeChoice.Current,
    [description.key]: MergeChoice.Snapshot,
  });
  expect(plan.unresolved).toBe(0);
  expect(plan.actions).toMatchObject([
    { targetId: card.id, field: MergeField.Description, before: card.description },
  ]);
  expect(plan.retained).toBeGreaterThanOrEqual(2);
});

test('card moves are explicit conflicts rather than duplicate cards', async () => {
  const { input, current } = await setup();
  current.cards[0]!.listId = current.lists[1]!.id;
  const plan = buildMergePlan(input, current);
  expect(plan.conflicts).toMatchObject([
    { field: MergeField.Parent, record: { resource: RestoreResource.Card } },
  ]);
  expect(plan.actions).toHaveLength(0);
});

test('name matches on another board require explicit target identity or separate creation', async () => {
  const { input, current } = await setup();
  input.snapshot.board.id = id(999);
  const source = input.snapshot.lists[0]!;
  const destination = id(850);
  current.lists[0]!.id = destination;
  current.cards.forEach((card) => {
    if (card.listId === source.id) card.listId = destination;
  });
  let plan = buildMergePlan(input, current);
  const conflict = plan.conflicts.find((item) => item.record.key === `lists/${source.id}`)!;
  expect(conflict.kind).toBe(MergeConflictKind.Identity);
  expect(conflict.candidates).toEqual([{ id: destination, name: source.name }]);
  expect(plan.unresolved).toBeGreaterThan(0);
  plan = buildMergePlan(input, current, { [conflict.key]: destination });
  expect(plan.bindings[`lists/${source.id}`]).toBe(destination);
  expect(plan.actions).toHaveLength(0);
  expect(plan.unresolved).toBe(0);
  const separate = buildMergePlan(input, current, { [conflict.key]: MergeChoice.Create });
  expect(separate.actions.some((action) => action.record.key === `lists/${source.id}`)).toBe(true);
  expect(buildMergePlan(input, current, { [conflict.key]: id(9999) }).unresolved).toBeGreaterThan(
    0,
  );
});

test('skipping a list excludes its cards and nested content', async () => {
  const { input, current } = await setup();
  const source = input.snapshot.lists[0]!;
  current.lists[0]!.id = id(850);
  current.cards = current.cards.filter((card) => card.listId !== source.id);
  const plan = buildMergePlan(input, current, { [`match/lists/${source.id}`]: MergeChoice.Skip });
  const skippedCards = input.snapshot.cards.filter((card) => card.listId === source.id);
  expect(
    plan.actions.some((action) => skippedCards.some((card) => action.record.sourceId === card.id)),
  ).toBe(false);
  expect(plan.unresolved).toBe(0);
});

test('ambiguous duplicate names never select a candidate automatically or share a claimed target', async () => {
  const { input, current } = await setup();
  const source = input.snapshot.lists[0]!;
  current.lists = [
    { ...source, id: id(800) },
    { ...source, id: id(801) },
    ...current.lists.slice(1),
  ];
  const conflict = buildMergePlan(input, current).conflicts.find(
    (item) => item.record.key === `lists/${source.id}`,
  )!;
  expect(conflict.candidates).toHaveLength(2);
  const plan = buildMergePlan(input, current, { [conflict.key]: id(800) });
  expect(plan.bindings[`lists/${source.id}`]).toBe(id(800));
  expect(plan.bindings[`lists/${source.id}`]).not.toBe(id(801));
});

test('skipping a label removes unresolved references from newly created cards', async () => {
  const { input, current } = await setup();
  const label = input.snapshot.labels[0]!;
  current.labels[0]!.id = id(850);
  current.cards = [];
  const plan = buildMergePlan(input, current, { [`match/labels/${label.id}`]: MergeChoice.Skip });
  const action = plan.actions.find(
    (action) =>
      action.record.resource === RestoreResource.Card &&
      input.snapshot.cards
        .find((card) => card.id === action.record.sourceId)
        ?.labelIds.includes(label.id),
  )!;
  expect(JSON.stringify(action.record.fields[MergeField.Labels])).not.toContain(label.id);
});

test('changed comments and attachments offer separate copies without overwriting current objects', async () => {
  const { input, current } = await setup();
  current.comments[0]!.text = 'Edited comment';
  current.attachments[0]!.name = 'Edited attachment';
  const first = buildMergePlan(input, current);
  expect(first.unresolved).toBe(2);
  const plan = buildMergePlan(
    input,
    current,
    Object.fromEntries(first.conflicts.map((item) => [item.key, MergeChoice.Snapshot])),
  );
  expect(plan.actions.every((action) => action.kind === MergeActionKind.Copy)).toBe(true);
  expect(plan.actions.map((action) => action.record.resource)).toEqual([
    RestoreResource.Comment,
    RestoreResource.Attachment,
  ]);
});

test('attributed comments in either interface language compare equal to their source', async () => {
  const { input, current } = await setup();
  for (const locale of Object.values(Locale)) {
    current.comments = input.snapshot.comments.map((comment) => ({
      ...comment,
      text: attributedComment(comment, locale),
    }));
    expect(buildMergePlan(input, current).unresolved).toBe(0);
  }
});

test('same-browser mappings are ignored for a different source board or destination', async () => {
  const { input, current } = await setup();
  const previous = restoreJournal();
  previous.sourceBoardId = id(987);
  previous.bindings = { [`cards/${input.snapshot.cards[0]!.id}`]: current.cards[1]!.id };
  expect(buildMergePlan(input, current, {}, previous).actions).toHaveLength(0);
  previous.sourceBoardId = input.snapshot.board.id;
  previous.target!.id = id(987);
  expect(buildMergePlan(input, current, {}, previous).actions).toHaveLength(0);
});

test.each(['closed', 'changed', 'unavailable'])(
  'incomplete target comparison blocks merging: %s',
  async (reason) => {
    const { input, current } = await setup();
    if (reason === 'closed') current.board.closed = true;
    if (reason === 'changed') current.capture.changedDuringCapture = true;
    if (reason === 'unavailable')
      current.issues.push({
        code: IssueCode.SectionUnavailable,
        severity: 'warning',
        entityType: 'comments',
        entityId: null,
        message: 'Unavailable',
      });
    expect(() => buildMergePlan(input, current)).toThrow(
      expect.objectContaining({ code: RestoreErrorCode.IncompleteTarget }),
    );
  },
);

test('label order is not a content conflict and uploaded attachment URLs are not compared', async () => {
  const { input, current } = await setup();
  input.snapshot.cards[0]!.labelIds = input.snapshot.labels.map((label) => label.id);
  current.cards[0]!.labelIds = [...input.snapshot.cards[0]!.labelIds].reverse();
  current.attachments[0]!.url = 'https://example.invalid/canonical';
  expect(buildMergePlan(input, current).actions).toHaveLength(0);
  expect(buildMergePlan(input, current).unresolved).toBe(0);
  input.snapshot.attachments[0]!.kind = AttachmentKind.Link;
  expect(buildMergePlan(input, current).unresolved).toBe(1);
});
