// Phase 5 / spec §15.6 — DaemonDb adapter tests.

import { describe, expect, it } from 'vitest';
import {
  DaemonDbConfigError,
  resolveDaemonDbConfig,
} from '../src/storage/daemon-db.js';

describe('resolveDaemonDbConfig', () => {
  it('defaults to sqlite', () => {
    expect(resolveDaemonDbConfig({})).toEqual({ kind: 'sqlite' });
  });

  it('parses postgres env vars when OD_DAEMON_DB=postgres', () => {
    const cfg = resolveDaemonDbConfig({
      OD_DAEMON_DB: 'postgres',
      OD_PG_HOST:   'pg.local',
      OD_PG_PORT:   '6543',
      OD_PG_DATABASE: 'open_design',
      OD_PG_USER:   'od',
      OD_PG_SSL_MODE: 'disable',
    });
    expect(cfg.kind).toBe('postgres');
    expect(cfg.postgres).toEqual({
      host:     'pg.local',
      port:     6543,
      database: 'open_design',
      user:     'od',
      sslMode:  'disable',
    });
  });

  it('throws when postgres env vars are incomplete', () => {
    expect(() =>
      resolveDaemonDbConfig({ OD_DAEMON_DB: 'postgres', OD_PG_HOST: 'pg.local' }),
    ).toThrow(DaemonDbConfigError);
  });

  it('throws on an unknown OD_DAEMON_DB value', () => {
    expect(() => resolveDaemonDbConfig({ OD_DAEMON_DB: 'mongo' })).toThrow(DaemonDbConfigError);
  });
});
