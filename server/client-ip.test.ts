import { describe, expect, it } from 'vitest';
import { clientIp, UNKNOWN_CLIENT_IP } from './client-ip.js';

const PROXY = '10.0.0.5';

describe('clientIp', () => {
  it('uses the socket address with 0 trusted hops and ignores X-Forwarded-For', () => {
    expect(clientIp('203.0.113.7', '198.51.100.1', 0)).toBe('203.0.113.7');
  });

  it('uses the rightmost X-Forwarded-For entry with 1 trusted hop', () => {
    expect(clientIp(PROXY, '203.0.113.7', 1)).toBe('203.0.113.7');
  });

  it('never trusts a spoofed leftmost entry', () => {
    expect(clientIp(PROXY, '1.1.1.1, 203.0.113.7', 1)).toBe('203.0.113.7');
    expect(clientIp(PROXY, '1.1.1.1, 203.0.113.7, 10.0.0.9', 2)).toBe('203.0.113.7');
  });

  it('falls back to the socket address when the header is short, missing, or invalid', () => {
    expect(clientIp(PROXY, '203.0.113.7', 2)).toBe(PROXY);
    expect(clientIp(PROXY, undefined, 1)).toBe(PROXY);
    expect(clientIp(PROXY, '1.1.1.1, not-an-ip', 1)).toBe(PROXY);
  });

  it('returns a stable fallback when nothing is usable', () => {
    expect(clientIp(undefined, undefined, 0)).toBe(UNKNOWN_CLIENT_IP);
    expect(clientIp('', 'junk', 1)).toBe(UNKNOWN_CLIENT_IP);
  });

  it('unwraps IPv4-mapped IPv6 in any spelling', () => {
    expect(clientIp('::ffff:203.0.113.7', undefined, 0)).toBe('203.0.113.7');
    expect(clientIp('::FFFF:cb00:7107', undefined, 0)).toBe('203.0.113.7');
    expect(clientIp('0:0:0:0:0:ffff:203.0.113.7', undefined, 0)).toBe('203.0.113.7');
  });

  it('groups IPv6 by /64 and accepts port forms', () => {
    expect(clientIp('2001:DB8:1:2:aaaa::1', undefined, 0)).toBe('2001:db8:1:2::/64');
    expect(clientIp(PROXY, '[2001:db8:1:2::99]:4433', 1)).toBe('2001:db8:1:2::/64');
    expect(clientIp('::1', undefined, 0)).toBe('0:0:0:0::/64');
    expect(clientIp(PROXY, '203.0.113.7:51000', 1)).toBe('203.0.113.7');
  });
});
