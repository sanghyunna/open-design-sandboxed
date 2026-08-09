import type { ApiErrorCode } from '@open-design/contracts';

export class HostedRuntimeError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HostedRuntimeError';
    this.code = code;
  }
}
