import type { ObjectId } from 'mongodb';
import type { Role } from '@ffos/shared';
import type { BookDoc, Collections, UserDoc } from './db.ts';

export interface AppEnv {
  Variables: {
    db: Collections;
    user: UserDoc;
    userId: ObjectId;
    sessionId: ObjectId;
    book: BookDoc;
    role: Role;
  };
}
