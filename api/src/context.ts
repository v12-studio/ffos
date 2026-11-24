import type { ObjectId } from 'mongodb';
import type { Role } from '@ffos/shared';
import type { BookDoc, BookMemberDoc, Collections, UserDoc } from './db.ts';

/** Book + membership lookup started early by requireAuth, consumed by requireBook. */
export interface BookAccessLookup {
  bookId: string;
  result: Promise<[BookDoc | null, BookMemberDoc | null]>;
}

export interface AppEnv {
  Variables: {
    db: Collections;
    user: UserDoc;
    userId: ObjectId;
    sessionId: ObjectId;
    book: BookDoc;
    role: Role;
    bookAccess?: BookAccessLookup;
  };
}
