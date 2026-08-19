import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';

export type WaitingChild = {
  child: ChildProcessWithoutNullStreams;
  line: Promise<string>;
};

export function spawnWaitingForOutputLine(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
  pattern: RegExp,
  timeoutMs = 15_000,
): WaitingChild {
  const child = spawn(command, args, { ...options, stdio: 'pipe' });
  // stdout/stderr pipes are paused and buffer data until these listeners are
  // registered. Keep this as the first operation after spawn so callers cannot
  // perform work that races readiness observation.
  const line = waitForOutputLine(child, pattern, timeoutMs);
  return { child, line };
}

function waitForOutputLine(
  child: ChildProcessWithoutNullStreams,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for stdout ${pattern}; output:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const line = output.split(/\r?\n/u).find((candidate) => pattern.test(candidate));
      if (line) {
        cleanup();
        resolve(line);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`child exited before stdout matched ${pattern}: code=${code} signal=${signal}; output:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}
