import { describe, expect, it } from 'vitest';
import { can, canManageMember, canModifyRecord, ROLES } from '@ffos/shared';

describe('role permissions', () => {
  it('every role can view the book', () => {
    for (const role of ROLES) expect(can(role, 'book.view')).toBe(true);
  });

  it('only the owner can delete or transfer a book', () => {
    for (const role of ROLES) {
      expect(can(role, 'book.delete')).toBe(role === 'owner');
      expect(can(role, 'book.transfer')).toBe(role === 'owner');
    }
  });

  it('viewer cannot create; contributor edits only own; editor edits any', () => {
    expect(can('viewer', 'txn.create')).toBe(false);
    expect(canModifyRecord('contributor', 'update', 'me', 'me')).toBe(true);
    expect(canModifyRecord('contributor', 'update', 'other', 'me')).toBe(false);
    expect(canModifyRecord('editor', 'delete', 'other', 'me')).toBe(true);
    expect(canModifyRecord('viewer', 'update', 'me', 'me')).toBe(false);
  });

  it('member management rules', () => {
    expect(canManageMember('owner', { role: 'admin', isSelf: false }, 'viewer')).toBe(true);
    expect(canManageMember('owner', { role: 'editor', isSelf: false }, 'owner')).toBe(false);
    expect(canManageMember('admin', { role: 'admin', isSelf: false }, 'viewer')).toBe(false);
    expect(canManageMember('admin', { role: 'editor', isSelf: false }, 'admin')).toBe(true);
    expect(canManageMember('admin', { role: 'owner', isSelf: false })).toBe(false);
    expect(canManageMember('owner', { role: 'owner', isSelf: true }, 'admin')).toBe(false);
    expect(canManageMember('editor', { role: 'viewer', isSelf: false }, 'contributor')).toBe(false);
  });
});
