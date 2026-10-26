import { z } from 'zod';
import {
  AttachmentKind,
  CaptureOutcome,
  CoverageStatus,
  CustomFieldType,
  IssueCode,
} from '../snapshot/codes';
import type { Snapshot } from '../snapshot/types';
import { safeLink } from '../snapshot/normalize';
import { ImportError, ImportErrorCode } from './codes';
import { validateReferences } from './references';
import { ProductName } from '../config/product';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const text = z.string().max(500_000);
const date = z.iso.datetime({ offset: true }).nullable();
const order = z.number().int().min(0).max(100_000);
const url = z
  .string()
  .max(8192)
  .refine((value) => safeLink(value) !== null)
  .nullable();
const collection = <T extends z.ZodType>(schema: T) => z.array(schema).max(100_000);
export const fileSchema = z.object({
  path: z.string().regex(/^(snapshot\.json|attachments\/[a-zA-Z0-9_-]{1,128}\/content)$/),
  size: z
    .number()
    .int()
    .min(0)
    .max(300 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const snapshotSchema = z.object({
  format: z.literal('trello-exporter.snapshot'),
  formatVersion: z.literal('0.1.0'),
  snapshotId: z.uuid(),
  exporter: z.object({ name: z.enum(ProductName), version: z.string().max(100) }),
  capture: z.object({
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    consistency: z.literal('best-effort'),
    changedDuringCapture: z.boolean().nullable(),
    outcome: z.enum(CaptureOutcome),
  }),
  coverage: z.record(
    z.string().max(100),
    z.object({ status: z.enum(CoverageStatus), count: order }),
  ),
  board: z.object({ id, name: text, description: text, url, closed: z.boolean() }),
  lists: collection(z.object({ id, name: text, order, closed: z.literal(false) })),
  cards: collection(
    z.object({
      id,
      listId: id,
      name: text,
      description: text,
      order,
      closed: z.literal(false),
      start: date,
      due: date,
      dueComplete: z.boolean(),
      labelIds: collection(id),
      memberIds: collection(id),
      cover: z
        .object({
          idAttachment: id.nullable(),
          color: text.nullable(),
          size: text,
          brightness: text,
        })
        .nullable(),
    }),
  ),
  labels: collection(z.object({ id, name: text, color: z.string().max(30).nullable() })),
  members: collection(z.object({ id, username: text, displayName: text })),
  // Legacy fields stay validated for compatibility, but are excluded from MVP capture and writes.
  customFields: collection(
    z.object({
      id,
      name: text,
      type: z.enum(CustomFieldType),
      order,
      options: collection(z.object({ id, text, color: z.string().max(30), order })),
    }),
  ),
  customFieldValues: collection(
    z.object({
      cardId: id,
      fieldId: id,
      value: z
        .object({
          text: text.optional(),
          number: text.optional(),
          date: text.optional(),
          checked: text.optional(),
        })
        .optional(),
      optionId: id.optional(),
    }),
  ),
  checklists: collection(z.object({ id, cardId: id, name: text, order })),
  checklistItems: collection(
    z.object({
      id,
      checklistId: id,
      name: text,
      order,
      checked: z.boolean(),
      due: date.optional(),
      memberId: id.nullable().optional(),
    }),
  ),
  comments: collection(
    z.object({
      id,
      cardId: id,
      authorId: id.nullable(),
      authorDisplayName: text.nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      text,
      order,
    }),
  ),
  attachments: collection(
    z.object({
      id,
      cardId: id,
      name: text,
      kind: z.enum(AttachmentKind),
      url,
      mimeType: z.string().max(200).nullable(),
      size: z.number().int().nonnegative().nullable(),
      file: fileSchema.nullable(),
    }),
  ),
  issues: collection(
    z.object({
      code: z.enum(IssueCode),
      severity: z.literal('warning'),
      entityType: z.string().max(100),
      entityId: id.nullable(),
      message: text,
    }),
  ),
});

/**
 * Validates the complete versioned snapshot before any API request or mutation
 * @param value - Untrusted parsed JSON
 * @returns A projected snapshot with validated relationships
 * @throws ImportError for unsupported formats, versions, entities, or relationships
 */
export function parseSnapshot(value: unknown): Snapshot {
  if (
    typeof value === 'object' &&
    value !== null &&
    'formatVersion' in value &&
    value.formatVersion !== '0.1.0'
  )
    throw new ImportError(ImportErrorCode.UnsupportedVersion);
  const result = snapshotSchema.safeParse(value);
  if (!result.success) throw new ImportError(ImportErrorCode.InvalidSnapshot);
  const snapshot: Snapshot = result.data;
  validateReferences(snapshot);
  return snapshot;
}
