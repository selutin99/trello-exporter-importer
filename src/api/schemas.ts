import { z } from 'zod';
import { ApiError } from './errors';
import { ApiErrorCode } from '../shared/error-codes';
import { CheckItemState, TrelloActionType } from './types';

const id = z.string().regex(/^[a-f0-9]{24}$/);
const position = z.number();
const date = z.string().nullable();
export const boardSchema = z.object({
  id,
  shortLink: z.string(),
  name: z.string(),
  desc: z.string(),
  closed: z.boolean(),
  dateLastActivity: date,
});
export const cardSchema = z.object({
  id,
  idBoard: id,
  idList: id,
  name: z.string(),
  desc: z.string(),
  pos: position,
  closed: z.boolean(),
  start: date,
  due: date,
  dueComplete: z.boolean(),
  idLabels: z.array(id),
  idMembers: z.array(id),
  cover: z
    .object({
      idAttachment: id.nullable(),
      color: z.string().nullable(),
      size: z.string(),
      brightness: z.string(),
    })
    .nullable(),
});
export const attachmentSchema = z.object({
  id,
  name: z.string(),
  fileName: z.string().nullish(),
  isUpload: z.boolean(),
  url: z.string(),
  mimeType: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  pos: position,
});
export const checklistSchema = z.object({
  id,
  idCard: id,
  name: z.string(),
  pos: position,
  checkItems: z.array(
    z.object({
      id,
      name: z.string(),
      pos: position,
      state: z.enum(CheckItemState),
      due: date.optional(),
      idMember: id.nullable().optional(),
    }),
  ),
});
export const commentSchema = z.object({
  id,
  date: z.string(),
  type: z.literal(TrelloActionType.Comment),
  data: z.object({ text: z.string(), card: z.object({ id }), board: z.object({ id }) }),
  memberCreator: z.object({ id, fullName: z.string() }).nullable().optional(),
});
export const labelSchema = z.object({ id, name: z.string(), color: z.string().nullable() });
export const memberSchema = z.object({ id, username: z.string(), fullName: z.string() });
/**
 * Projects untrusted API data through an explicit schema without leaking response data
 * @param schema - Allowed response shape
 * @param value - Untrusted response data
 * @returns Validated data with unknown properties removed
 * @throws ApiError when the response does not match the schema
 */
export function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(ApiErrorCode.InvalidResponse);
  return result.data;
}

export type SourceBoard = z.infer<typeof boardSchema>;
export type SourceCard = z.infer<typeof cardSchema>;
export type SourceAttachment = z.infer<typeof attachmentSchema>;
export type SourceChecklist = z.infer<typeof checklistSchema>;
export type SourceComment = z.infer<typeof commentSchema>;
export type SourceLabel = z.infer<typeof labelSchema>;
export type SourceMember = z.infer<typeof memberSchema>;
