import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ObjectId } from 'mongodb';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, 'bad_request', message, fields);
export const unauthorized = (message = 'Please sign in again') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = "You don't have permission to do that") =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);

/** Parse with zod; turn failures into a 400 with per-field messages. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest(Object.values(fields)[0] ?? 'Invalid input', fields);
}

/** Invalid ids are treated as "not found" so callers can't probe for existence. */
export function oid(id: string | undefined): ObjectId {
  if (!id || !ObjectId.isValid(id) || !/^[a-f\d]{24}$/i.test(id)) throw notFound();
  return new ObjectId(id);
}

export function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
