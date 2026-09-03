/**
 * AIBOS — Integration test for CRITIQUE 2 only
 *
 * Does NOT need a database. Spawns real localhost HTTP servers to
 * reproduce the SSRF redirect attack and verify that safeFetch
 * rejects the chain before opening a TCP connection to the inner
 * probe.
 *
 * Run
 *   npm run test:e2e -- crit2-ssrf
 */

import { createServer, Server } from 'node:http';
import { safeFetch } from '../../src/common/security/ssrf';

describe('CRITIQUE 2 — SSRF safeFetch against a real redirect chain (no DB required)', () => {
  let evil: Server, probe: Server;
  let probeHits = 0;
  let evilPort: number, probePort: number;

  beforeAll(async () => {
    probe = createServer((_req, res) => {
      probeHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"leaked":true}');
    });
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    probePort = (probe.address() as any).port;

    evil = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${probePort}/final` });
      res.end();
    });
    await new Promise<void>((r) => evil.listen(0, '127.0.0.1', r));
    evilPort = (evil.address() as any).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => evil.close(() => r()));
    await new Promise<void>((r) => probe.close(() => r()));
  });

  it('blocks the 302 redirect before any TCP connection to the inner probe', async () => {
    probeHits = 0;
    const result = await safeFetch(`http://127.0.0.1:${evilPort}/start`, { timeoutMs: 3000 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SSRF_BLOCKED');
    expect(probeHits).toBe(0);
  });

  it('blocks a 2-hop chain: 302 → 302 → private IP, no connection on the third hop', async () => {
    // Set up: mid server (chained 302) → probe (private IP target)
    const mid = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${probePort}/chained-final` });
      res.end();
    });
    await new Promise<void>((r) => mid.listen(0, '127.0.0.1', r));
    const midPort = (mid.address() as any).port;
    const evil2 = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${midPort}/chained` });
      res.end();
    });
    await new Promise<void>((r) => evil2.listen(0, '127.0.0.1', r));
    const evil2Port = (evil2.address() as any).port;

    probeHits = 0;
    try {
      const result = await safeFetch(`http://127.0.0.1:${evil2Port}/start`, { timeoutMs: 3000 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('SSRF_BLOCKED');
      // The 3rd hop (probe) was never hit
      expect(probeHits).toBe(0);
    } finally {
      await new Promise<void>((r) => evil2.close(() => r()));
      await new Promise<void>((r) => mid.close(() => r()));
    }
  });
});
