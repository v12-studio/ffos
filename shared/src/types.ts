import type { AssignableRole, Permission, Role } from './rbac.ts';

// API response shapes shared by the API and the web app. Ids are hex strings.

export interface UserDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isInstanceOwner: boolean;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
  /** Present only right after setup/register: shown once, never retrievable again. */
  recoveryCodes?: string[];
}

export interface BookDTO {
  id: string;
  name: string;
  currency: string;
  color: string;
  isPersonal: boolean;
  ownerId: string;
  role: Role;
  permissions: Permission[];
  memberCount: number;
}

export interface MemberDTO {
  userId: string;
  name: string;
  phone: string;
  role: Role;
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  role: AssignableRole;
  phone: string | null;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
}

export interface InviteCreatedDTO extends InviteDTO {
  /** Raw token, returned only once at creation. */
  token: string;
}

export interface InvitePreviewDTO {
  bookName: string;
  role: AssignableRole;
  invitedByName: string;
  phoneRestricted: boolean;
  expiresAt: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
}

export interface TransactionDTO {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  categoryId: string;
  note: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SummaryDTO {
  month: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  byCategory: { categoryId: string; total: number }[];
  recent: TransactionDTO[];
}

export interface ActivityDTO {
  id: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  at: string;
}

export interface SessionDTO {
  id: string;
  deviceName: string;
  lastUsedAt: string;
  current: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
