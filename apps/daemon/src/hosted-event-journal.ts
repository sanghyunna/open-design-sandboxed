import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface HostedEventLimits {
  heartbeatMs: number;
  maxBufferedBytes: number;
  maxBytes: number;
  maxConnections: number;
  maxEvents: number;
  slowClientMs: number;
}

export const HOSTED_EVENT_LIMITS: Readonly<HostedEventLimits> = Object.freeze({
  heartbeatMs: 25_000,
  maxBufferedBytes: 1024 * 1024,
  maxBytes: 8 * 1024 * 1024,
  maxConnections: 4,
  maxEvents: 2_000,
  slowClientMs: 5_000,
});

export const HOSTED_EVENT_GLOBAL_LIMITS = Object.freeze({
  maxBufferedBytes: 64 * 1024 * 1024,
  maxBytes: 256 * 1024 * 1024,
  maxConnections: 256,
  maxEvents: 128_000,
});

export type HostedEventChannel =
  | { kind: 'owner' }
  | { kind: 'project'; projectId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'run-ui'; runId: string };

export interface HostedEventRecord {
  at: number;
  cursor: string;
  data: unknown;
  event: string;
}

export type HostedEventResyncReason =
  | 'cursor-expired'
  | 'cursor-invalid'
  | 'generation-expired'
  | 'slow-client';

export type HostedEventReplayResult =
  | { kind: 'events'; events: HostedEventRecord[] }
  | { kind: 'not-owned' }
  | { kind: 'resync'; reason: Exclude<HostedEventResyncReason, 'slow-client'> };

export class HostedEventJournalError extends Error {
  constructor(
    readonly code: 'HOSTED_CAPACITY_EXHAUSTED' | 'HOSTED_OVERLOADED' | 'HOSTED_QUOTA_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'HostedEventJournalError';
  }
}

export interface HostedEventBudget {
  adjustEvents(countDelta: number, bytesDelta: number): boolean;
  releaseBuffered(ownerKey: string, bytes: number): void;
  releaseConnection(ownerKey: string): void;
  reserveBuffered(ownerKey: string, bytes: number, ownerLimit: number): boolean;
  reserveConnection(ownerKey: string, ownerLimit: number): 'global-capacity' | 'owner-capacity' | 'reserved';
  snapshot(): { bufferedBytes: number; bytes: number; connections: number; events: number };
}

function boundedLimit(value: number | undefined, ceiling: number, name: string): number {
  if (value == null) return ceiling;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return Math.min(value, ceiling);
}

export function createHostedEventBudget(limits: {
  maxBufferedBytes?: number;
  maxBytes?: number;
  maxConnections?: number;
  maxEvents?: number;
} = {}): HostedEventBudget {
  const maximums = {
    maxBufferedBytes: boundedLimit(
      limits.maxBufferedBytes,
      HOSTED_EVENT_GLOBAL_LIMITS.maxBufferedBytes,
      'maxBufferedBytes',
    ),
    maxBytes: boundedLimit(limits.maxBytes, HOSTED_EVENT_GLOBAL_LIMITS.maxBytes, 'maxBytes'),
    maxConnections: boundedLimit(
      limits.maxConnections,
      HOSTED_EVENT_GLOBAL_LIMITS.maxConnections,
      'maxConnections',
    ),
    maxEvents: boundedLimit(limits.maxEvents, HOSTED_EVENT_GLOBAL_LIMITS.maxEvents, 'maxEvents'),
  };

  let events = 0;
  let bytes = 0;
  let connections = 0;
  let bufferedBytes = 0;
  const ownerConnections = new Map<string, number>();
  const ownerBufferedBytes = new Map<string, number>();

  return {
    adjustEvents(countDelta, bytesDelta) {
      const nextEvents = events + countDelta;
      const nextBytes = bytes + bytesDelta;
      if (
        nextEvents < 0 ||
        nextBytes < 0 ||
        nextEvents > maximums.maxEvents ||
        nextBytes > maximums.maxBytes
      ) return false;
      events = nextEvents;
      bytes = nextBytes;
      return true;
    },
    reserveConnection(ownerKey, ownerLimit) {
      const ownerCount = ownerConnections.get(ownerKey) ?? 0;
      if (ownerCount >= ownerLimit) return 'owner-capacity';
      if (connections >= maximums.maxConnections) return 'global-capacity';
      ownerConnections.set(ownerKey, ownerCount + 1);
      connections += 1;
      return 'reserved';
    },
    releaseConnection(ownerKey) {
      const ownerCount = ownerConnections.get(ownerKey) ?? 0;
      if (ownerCount <= 0) return;
      if (ownerCount === 1) ownerConnections.delete(ownerKey);
      else ownerConnections.set(ownerKey, ownerCount - 1);
      connections -= 1;
    },
    reserveBuffered(ownerKey, amount, ownerLimit) {
      const ownerBytes = ownerBufferedBytes.get(ownerKey) ?? 0;
      if (amount < 0 || ownerBytes + amount > ownerLimit || bufferedBytes + amount > maximums.maxBufferedBytes) {
        return false;
      }
      ownerBufferedBytes.set(ownerKey, ownerBytes + amount);
      bufferedBytes += amount;
      return true;
    },
    releaseBuffered(ownerKey, amount) {
      const ownerBytes = ownerBufferedBytes.get(ownerKey) ?? 0;
      const released = Math.min(ownerBytes, Math.max(0, amount));
      const nextOwnerBytes = ownerBytes - released;
      if (nextOwnerBytes === 0) ownerBufferedBytes.delete(ownerKey);
      else ownerBufferedBytes.set(ownerKey, nextOwnerBytes);
      bufferedBytes -= released;
    },
    snapshot() {
      return { bufferedBytes, bytes, connections, events };
    },
  };
}

interface StoredEvent extends HostedEventRecord {
  bytes: number;
  channelKey: string;
  dataJson: string;
  sequence: number;
}

export interface HostedEventResponse {
  destroyed: boolean;
  writableLength?: number;
  writableEnded: boolean;
  write(chunk: string): boolean;
  end(): void;
  on(event: 'close' | 'drain' | 'finish', listener: () => void): this;
  off(event: 'close' | 'drain' | 'finish', listener: () => void): this;
}

export type HostedEventAttachResult =
  | { close(): void; kind: 'attached' }
  | { code: 'HOSTED_CAPACITY_EXHAUSTED' | 'HOSTED_OVERLOADED'; kind: 'overloaded' }
  | { kind: 'not-owned' }
  | { kind: 'resync'; reason: Exclude<HostedEventResyncReason, 'slow-client'> };

interface EventConnection {
  bufferedBytes: number;
  channelKey: string;
  closed: boolean;
  heartbeat: NodeJS.Timeout | null;
  onClose: () => void;
  onDrain: () => void;
  response: HostedEventResponse;
  slowClient: NodeJS.Timeout | null;
}

function channelKey(channel: HostedEventChannel): string {
  if (channel.kind === 'owner') return 'owner';
  const id = channel.kind === 'project' ? channel.projectId : channel.runId;
  if (id.length === 0 || id.length > 128 || /[\0\r\n]/u.test(id)) throw new Error('hosted event channel id is invalid');
  return `${channel.kind}:${id}`;
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json == null) throw new Error('value is not JSON serializable');
    return json;
  } catch {
    throw new Error('hosted event data must be JSON serializable');
  }
}

export function createHostedEventJournal(options: {
  budget: HostedEventBudget;
  generation: string;
  limits?: Partial<HostedEventLimits>;
  ownerKey: string;
  secret?: Uint8Array;
}) {
  if (options.ownerKey.length === 0 || options.generation.length === 0) {
    throw new Error('hosted event owner and generation are required');
  }
  const limits: HostedEventLimits = {
    heartbeatMs: boundedLimit(options.limits?.heartbeatMs, HOSTED_EVENT_LIMITS.heartbeatMs, 'heartbeatMs'),
    maxBufferedBytes: boundedLimit(
      options.limits?.maxBufferedBytes,
      HOSTED_EVENT_LIMITS.maxBufferedBytes,
      'maxBufferedBytes',
    ),
    maxBytes: boundedLimit(options.limits?.maxBytes, HOSTED_EVENT_LIMITS.maxBytes, 'maxBytes'),
    maxConnections: boundedLimit(
      options.limits?.maxConnections,
      HOSTED_EVENT_LIMITS.maxConnections,
      'maxConnections',
    ),
    maxEvents: boundedLimit(options.limits?.maxEvents, HOSTED_EVENT_LIMITS.maxEvents, 'maxEvents'),
    slowClientMs: boundedLimit(options.limits?.slowClientMs, HOSTED_EVENT_LIMITS.slowClientMs, 'slowClientMs'),
  };

  const secret = Buffer.from(options.secret ?? randomBytes(32));
  const generationTag = createHash('sha256').update(options.generation).digest('base64url');
  const events: StoredEvent[] = [];
  const connections = new Set<EventConnection>();
  const closedChannels = new Set<string>();
  let eventBytes = 0;
  let evictedThrough = 0;
  let nextSequence = 1;
  let disposed = false;

  const signCursor = (scope: string, sequence: number): string => createHmac('sha256', secret)
    .update(`${options.ownerKey}\0${scope}\0${generationTag}\0${sequence}`)
    .digest('base64url');

  const makeCursor = (scope: string, sequence: number): string => (
    `${generationTag}.${sequence.toString(36)}.${signCursor(scope, sequence)}`
  );

  const parseCursor = (
    scope: string,
    cursor: string,
  ): { kind: 'ok'; sequence: number } | { kind: 'resync'; reason: Exclude<HostedEventResyncReason, 'slow-client'> } => {
    const parts = cursor.split('.');
    if (parts.length !== 3) return { kind: 'resync', reason: 'cursor-invalid' };
    if (parts[0] !== generationTag) return { kind: 'resync', reason: 'generation-expired' };
    if (!/^[0-9a-z]+$/u.test(parts[1]!)) return { kind: 'resync', reason: 'cursor-invalid' };
    const sequence = Number.parseInt(parts[1]!, 36);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= nextSequence) {
      return { kind: 'resync', reason: 'cursor-invalid' };
    }
    const expected = Buffer.from(signCursor(scope, sequence));
    const actual = Buffer.from(parts[2]!);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { kind: 'resync', reason: 'cursor-invalid' };
    }
    if (sequence <= evictedThrough) return { kind: 'resync', reason: 'cursor-expired' };
    return { kind: 'ok', sequence };
  };

  const replay = (input: {
    after?: string | null;
    channel: HostedEventChannel;
    ownerKey: string;
  }): HostedEventReplayResult => {
    if (input.ownerKey !== options.ownerKey) return { kind: 'not-owned' };
    if (disposed) return { kind: 'resync', reason: 'generation-expired' };
    const scope = channelKey(input.channel);
    let afterSequence = 0;
    if (input.after != null && input.after.length > 0) {
      const parsed = parseCursor(scope, input.after);
      if (parsed.kind === 'resync') return parsed;
      afterSequence = parsed.sequence;
    }
    return {
      kind: 'events',
      events: events
        .filter((event) => event.channelKey === scope && event.sequence > afterSequence)
        .map(({ at, cursor, dataJson, event }) => ({
          at,
          cursor,
          data: JSON.parse(dataJson) as unknown,
          event,
        })),
    };
  };

  const frameForEvent = (record: Pick<StoredEvent, 'cursor' | 'dataJson' | 'event'>): string => (
    `id: ${record.cursor}\nevent: ${record.event}\ndata: ${record.dataJson}\n\n`
  );

  const writeResync = (response: HostedEventResponse, reason: HostedEventResyncReason): void => {
    if (response.destroyed || response.writableEnded) return;
    try {
      response.write(`event: resync\ndata: ${JSON.stringify({ reason })}\n\n`);
      response.end();
    } catch {
      // The peer has already gone away.
    }
  };

  const detach = (connection: EventConnection): void => {
    if (connection.closed) return;
    connection.closed = true;
    if (connection.heartbeat != null) clearTimeout(connection.heartbeat);
    if (connection.slowClient != null) clearTimeout(connection.slowClient);
    connection.heartbeat = null;
    connection.slowClient = null;
    connection.response.off('close', connection.onClose);
    connection.response.off('finish', connection.onClose);
    connection.response.off('drain', connection.onDrain);
    connections.delete(connection);
    options.budget.releaseBuffered(options.ownerKey, connection.bufferedBytes);
    options.budget.releaseConnection(options.ownerKey);
    connection.bufferedBytes = 0;
  };

  const closeSlowClient = (connection: EventConnection): void => {
    if (connection.closed) return;
    const response = connection.response;
    detach(connection);
    writeResync(response, 'slow-client');
  };

  const scheduleHeartbeat = (connection: EventConnection): void => {
    if (connection.closed) return;
    if (connection.heartbeat != null) clearTimeout(connection.heartbeat);
    connection.heartbeat = setTimeout(() => {
      connection.heartbeat = null;
      writeToConnection(connection, ': keepalive\n\n');
    }, limits.heartbeatMs);
    connection.heartbeat.unref?.();
  };

  const writeToConnection = (connection: EventConnection, frame: string): boolean => {
    if (connection.closed || connection.response.destroyed || connection.response.writableEnded) {
      detach(connection);
      return false;
    }
    let writable: boolean;
    try {
      writable = connection.response.write(frame);
    } catch {
      detach(connection);
      return false;
    }
    scheduleHeartbeat(connection);
    if (writable) return true;

    const frameBytes = Buffer.byteLength(frame);
    const bytes = connection.response.writableLength == null
      ? frameBytes
      : Math.max(0, connection.response.writableLength - connection.bufferedBytes);
    if (bytes <= 0) return true;
    if (!options.budget.reserveBuffered(options.ownerKey, bytes, limits.maxBufferedBytes)) {
      closeSlowClient(connection);
      return false;
    }
    connection.bufferedBytes += bytes;
    if (connection.slowClient == null) {
      connection.slowClient = setTimeout(() => closeSlowClient(connection), limits.slowClientMs);
      connection.slowClient.unref?.();
    }
    return true;
  };

  const attach = (input: {
    after?: string | null;
    channel: HostedEventChannel;
    ownerKey: string;
    response: HostedEventResponse;
  }): HostedEventAttachResult => {
    const replayResult = replay(input);
    if (replayResult.kind !== 'events') {
      if (replayResult.kind === 'resync') writeResync(input.response, replayResult.reason);
      return replayResult;
    }
    if (input.response.destroyed || input.response.writableEnded) {
      return { close() {}, kind: 'attached' };
    }
    const reservation = options.budget.reserveConnection(options.ownerKey, limits.maxConnections);
    if (reservation !== 'reserved') {
      return {
        code: reservation === 'owner-capacity' ? 'HOSTED_OVERLOADED' : 'HOSTED_CAPACITY_EXHAUSTED',
        kind: 'overloaded',
      };
    }

    const scope = channelKey(input.channel);
    const connection: EventConnection = {
      bufferedBytes: 0,
      channelKey: scope,
      closed: false,
      heartbeat: null,
      onClose: () => detach(connection),
      onDrain: () => {
        options.budget.releaseBuffered(options.ownerKey, connection.bufferedBytes);
        connection.bufferedBytes = 0;
        if (connection.slowClient != null) clearTimeout(connection.slowClient);
        connection.slowClient = null;
      },
      response: input.response,
      slowClient: null,
    };
    connections.add(connection);
    input.response.on('close', connection.onClose);
    input.response.on('finish', connection.onClose);
    input.response.on('drain', connection.onDrain);
    scheduleHeartbeat(connection);
    const replayCursors = new Set(replayResult.events.map((event) => event.cursor));
    for (const record of events) {
      if (
        connection.closed ||
        record.channelKey !== scope ||
        !replayCursors.has(record.cursor)
      ) continue;
      writeToConnection(connection, frameForEvent(record));
    }
    if (closedChannels.has(scope)) {
      detach(connection);
      if (!input.response.destroyed && !input.response.writableEnded) input.response.end();
    }
    return {
      close: () => {
        const response = connection.response;
        detach(connection);
        if (!response.destroyed && !response.writableEnded) {
          try { response.end(); } catch { /* The peer has already gone away. */ }
        }
      },
      kind: 'attached',
    };
  };

  return {
    publish(channel: HostedEventChannel, event: string, data: unknown): HostedEventRecord {
      if (disposed) throw new Error('hosted event journal is disposed');
      if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(event)) throw new Error('hosted event name is invalid');
      const scope = channelKey(channel);
      const dataJson = safeJson(data);
      const sequence = nextSequence;
      const cursor = makeCursor(scope, sequence);
      const bytes = Buffer.byteLength(`id: ${cursor}\nevent: ${event}\ndata: ${dataJson}\n\n`);
      if (bytes > limits.maxBytes) {
        throw new HostedEventJournalError('HOSTED_QUOTA_EXCEEDED', 'hosted event exceeds the per-user journal byte limit');
      }

      let removeCount = 0;
      let removeBytes = 0;
      while (
        events.length - removeCount + 1 > limits.maxEvents ||
        eventBytes - removeBytes + bytes > limits.maxBytes
      ) {
        const removed = events[removeCount];
        if (removed == null) break;
        removeCount += 1;
        removeBytes += removed.bytes;
      }
      if (!options.budget.adjustEvents(1 - removeCount, bytes - removeBytes)) {
        throw new HostedEventJournalError('HOSTED_CAPACITY_EXHAUSTED', 'hosted event journal global capacity is exhausted');
      }
      if (removeCount > 0) {
        const removed = events.splice(0, removeCount);
        evictedThrough = removed.at(-1)!.sequence;
        eventBytes -= removeBytes;
      }

      nextSequence += 1;
      const publicRecord: HostedEventRecord = {
        at: Date.now(),
        cursor,
        data: JSON.parse(dataJson) as unknown,
        event,
      };
      const storedRecord = { ...publicRecord, bytes, channelKey: scope, dataJson, sequence };
      events.push(storedRecord);
      eventBytes += bytes;
      for (const connection of connections) {
        if (connection.channelKey === scope) writeToConnection(connection, frameForEvent(storedRecord));
      }
      return publicRecord;
    },
    close(channel: HostedEventChannel): void {
      const scope = channelKey(channel);
      closedChannels.add(scope);
      for (const connection of [...connections]) {
        if (connection.channelKey !== scope) continue;
        const response = connection.response;
        detach(connection);
        if (!response.destroyed && !response.writableEnded) {
          try { response.end(); } catch { /* The peer has already gone away. */ }
        }
      }
    },
    attach,
    replay,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const connection of [...connections]) {
        const response = connection.response;
        detach(connection);
        if (!response.destroyed && !response.writableEnded) {
          try { response.end(); } catch { /* Continue releasing the remaining journal resources. */ }
        }
      }
      options.budget.adjustEvents(-events.length, -eventBytes);
      events.length = 0;
      eventBytes = 0;
      closedChannels.clear();
    },
  };
}
