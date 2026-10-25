import { describe, expect, it } from 'vitest';
import { REJECT_REASONS, ROOM_ERROR_REASONS } from '../../shared/protocol';
import { DEVELOPER_ONLY, rejectCopy, roomErrorCopy } from './copy';

describe('copy', () => {
  it('maps every reject reason to copy or the developer marker (Requirement 13.2)', () => {
    for (const reason of REJECT_REASONS) {
      const copy = rejectCopy(reason);
      expect(copy === DEVELOPER_ONLY || (typeof copy === 'string' && copy.length > 0)).toBe(true);
    }
  });

  it('gives every room error a next step', () => {
    for (const reason of [...ROOM_ERROR_REASONS, 'lost', 'connect-failed'] as const) {
      expect(roomErrorCopy(reason)).toMatch(/\.$/);
    }
  });
});
