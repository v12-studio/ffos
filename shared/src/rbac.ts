// Single source of truth for book roles and permissions.
// The API uses this to enforce access; the web app uses it to hide controls.

export const ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that can be handed out through invites or role changes (ownership moves only via transfer). */
export const ASSIGNABLE_ROLES = ['admin', 'editor', 'contributor', 'viewer'] as const satisfies readonly Role[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PERMISSIONS = [
  'book.view',
  'txn.create',
  'txn.update.own',
  'txn.delete.own',
  'txn.update.any',
  'txn.delete.any',
  'plan.manage',
  'budget.manage',
  'setup.manage',
  'members.invite',
  'members.manage',
  'book.export',
  'book.settings',
  'activity.view',
  'book.delete',
  'book.transfer',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ['book.view'];
const CONTRIBUTOR: Permission[] = [...VIEWER, 'txn.create', 'txn.update.own', 'txn.delete.own'];
const EDITOR: Permission[] = [
  ...CONTRIBUTOR,
  'txn.update.any',
  'txn.delete.any',
  'plan.manage',
  'budget.manage',
  'book.export',
  'activity.view',
];
const ADMIN: Permission[] = [...EDITOR, 'setup.manage', 'members.invite', 'members.manage', 'book.settings'];
const OWNER: Permission[] = [...ADMIN, 'book.delete', 'book.transfer'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  editor: new Set(EDITOR),
  contributor: new Set(CONTRIBUTOR),
  viewer: new Set(VIEWER),
};

export const ROLE_LABELS: Record<Role, { name: string; description: string }> = {
  owner: { name: 'Owner', description: 'Full control, including deleting the book' },
  admin: { name: 'Admin', description: 'Manage members and setup, edit everything' },
  editor: { name: 'Editor', description: 'Add and edit any record' },
  contributor: { name: 'Contributor', description: 'Add records, edit only their own' },
  viewer: { name: 'Viewer', description: 'Read-only access' },
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].has(permission) : false;
}

/** Whether `role` may update/delete a record created by `createdBy` when acting as `userId`. */
export function canModifyRecord(
  role: Role | null | undefined,
  action: 'update' | 'delete',
  createdBy: string,
  userId: string,
): boolean {
  if (can(role, `txn.${action}.any`)) return true;
  return createdBy === userId && can(role, `txn.${action}.own`);
}

/**
 * Member-management rules:
 * - nobody can change or remove the owner (ownership moves only via transfer)
 * - nobody can change their own role (use "leave" instead)
 * - admins cannot change or remove other admins
 * - the new role must be assignable (never "owner")
 */
export function canManageMember(
  actorRole: Role,
  target: { role: Role; isSelf: boolean },
  newRole?: Role,
): boolean {
  if (!can(actorRole, 'members.manage')) return false;
  if (target.isSelf || target.role === 'owner') return false;
  if (actorRole === 'admin' && target.role === 'admin') return false;
  if (newRole !== undefined && !(ASSIGNABLE_ROLES as readonly Role[]).includes(newRole)) return false;
  return true;
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
