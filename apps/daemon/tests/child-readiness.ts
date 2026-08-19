import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';

export type WaitingChild = {
  child: ChildProcessWithoutNullStreams;
  line: Promise<string>;
  terminate(): Promise<void>;
};

type CloseResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

const GRACEFUL_CLOSE_TIMEOUT_MS = 1_000;
const FORCED_CLOSE_TIMEOUT_MS = 5_000;

export function spawnWaitingForOutputLine(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
  pattern: RegExp,
  timeoutMs = 15_000,
): WaitingChild {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform === 'win32' ? options.detached : true,
    stdio: 'pipe',
  });
  let stdout = '';
  let stderr = '';
  let readinessState: 'pending' | 'ready' | 'failing' | 'failed' = 'pending';
  let terminationPromise: Promise<void> | undefined;
  let closeResult: CloseResult | undefined;

  let resolveLine!: (line: string) => void;
  let rejectLine!: (error: Error) => void;
  const line = new Promise<string>((resolve, reject) => {
    resolveLine = resolve;
    rejectLine = reject;
  });

  const closed = new Promise<CloseResult>((resolve) => {
    child.once('close', (code, signal) => {
      closeResult = { code, signal };
      resolve(closeResult);
    });
  });

  const terminate = (): Promise<void> => {
    terminationPromise ??= terminateOwnedTree(child, closed, () => closeResult);
    return terminationPromise;
  };

  const timer = setTimeout(() => {
    void failReadiness(new Error(`timed out waiting for stdout ${pattern}`));
  }, timeoutMs);

  const detachReadinessObservers = () => {
    clearTimeout(timer);
    child.stdout.off('data', onStdout);
    child.stderr.off('data', onStderr);
    child.off('error', onSpawnError);
  };

  const diagnostic = (reason: string, result = closeResult): Error => new Error([
    reason,
    `code=${result?.code ?? child.exitCode ?? 'null'} signal=${result?.signal ?? child.signalCode ?? 'null'}`,
    `stdout:\n${stdout}`,
    `stderr:\n${stderr}`,
  ].join('\n'));

  async function failReadiness(cause: Error): Promise<void> {
    if (readinessState !== 'pending') return;
    readinessState = 'failing';
    try {
      await terminate();
      detachReadinessObservers();
      readinessState = 'failed';
      rejectLine(diagnostic(cause.message));
    } catch (terminationError) {
      detachReadinessObservers();
      readinessState = 'failed';
      rejectLine(diagnostic(
        `${cause.message}; termination failed: ${terminationError instanceof Error ? terminationError.message : String(terminationError)}`,
      ));
    }
  }

  const acceptChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
    const text = chunk.toString('utf8');
    if (stream === 'stdout') stdout += text;
    else stderr += text;
    if (readinessState !== 'pending') return;
    const combined = `${stdout}\n${stderr}`;
    const matchingLine = combined.split(/\r?\n/u).find((candidate) => pattern.test(candidate));
    if (!matchingLine) return;
    readinessState = 'ready';
    detachReadinessObservers();
    resolveLine(matchingLine);
  };
  const onStdout = (chunk: Buffer) => acceptChunk(chunk, 'stdout');
  const onStderr = (chunk: Buffer) => acceptChunk(chunk, 'stderr');
  const onSpawnError = (error: Error) => {
    void failReadiness(error);
  };

  // Pipes are paused-buffered until data listeners are attached. Register all
  // readiness observers synchronously before returning ownership to the caller.
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.on('error', onSpawnError);

  void closed.then((result) => {
    if (readinessState !== 'pending') return;
    readinessState = 'failed';
    detachReadinessObservers();
    rejectLine(diagnostic('child closed before stdout matched readiness pattern', result));
  });

  return { child, line, terminate };
}

async function terminateOwnedTree(
  child: ChildProcessWithoutNullStreams,
  closed: Promise<CloseResult>,
  currentClose: () => CloseResult | undefined,
): Promise<void> {
  if (currentClose() !== undefined) return;
  const pid = child.pid;
  if (pid === undefined) {
    await requireClose(closed, FORCED_CLOSE_TIMEOUT_MS, 'spawn failure did not emit close');
    return;
  }

  if (process.platform === 'win32') {
    // Node's child.kill() targets only the direct process on Windows. taskkill
    // owns the tree and returns only after descendants have been terminated.
    await taskkillTree(pid).catch(() => undefined);
    if (await closesWithin(closed, GRACEFUL_CLOSE_TIMEOUT_MS)) return;
    child.kill('SIGKILL');
  } else {
    signalPosixTree(child, pid, 'SIGTERM');
    if (await closesWithin(closed, GRACEFUL_CLOSE_TIMEOUT_MS)) return;
    signalPosixTree(child, pid, 'SIGKILL');
  }

  await requireClose(closed, FORCED_CLOSE_TIMEOUT_MS, `child tree ${pid} did not close after forced termination`);
}

function signalPosixTree(
  child: ChildProcessWithoutNullStreams,
  pid: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
}

function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { timeout: FORCED_CLOSE_TIMEOUT_MS, windowsHide: true },
      (error) => error ? reject(error) : resolve(),
    );
  });
}

async function closesWithin(closed: Promise<CloseResult>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function requireClose(
  closed: Promise<CloseResult>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  if (!(await closesWithin(closed, timeoutMs))) throw new Error(message);
}
