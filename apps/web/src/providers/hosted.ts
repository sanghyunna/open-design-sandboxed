import type {
  HostedProviderClearResponse,
  HostedProviderSetRequest,
  HostedProviderSetResponse,
  HostedProviderStatusResponse,
  HostedProviderTestRequest,
  HostedProviderTestResponse,
  HostedSessionResponse,
} from '@open-design/contracts';
import { HOSTED_CSRF_HEADER } from '@open-design/contracts';

export class HostedProviderRequestError extends Error {
  constructor(readonly status: number) {
    super(`Hosted provider request failed (${status})`);
    this.name = 'HostedProviderRequestError';
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new HostedProviderRequestError(502);
  }
}

export class HostedProviderClient {
  private session: HostedSessionResponse | null = null;
  private sessionRequest: Promise<HostedSessionResponse> | null = null;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  status(): Promise<HostedProviderStatusResponse> {
    return this.request('GET', '/api/hosted/provider');
  }

  set(request: HostedProviderSetRequest): Promise<HostedProviderSetResponse> {
    return this.request('PUT', '/api/hosted/provider', request);
  }

  test(request: HostedProviderTestRequest): Promise<HostedProviderTestResponse> {
    return this.request('POST', '/api/hosted/provider/test', request);
  }

  clear(): Promise<HostedProviderClearResponse> {
    return this.request('DELETE', '/api/hosted/provider');
  }

  async getSession(force = false): Promise<HostedSessionResponse> {
    if (!force && this.session && this.session.csrfExpiresAt > Date.now()) return this.session;
    if (!force && this.sessionRequest) return this.sessionRequest;

    const request = this.fetcher('/api/hosted/session', {
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
    }).then(async (response) => {
      if (!response.ok) throw new HostedProviderRequestError(response.status);
      const session = await parseResponse<HostedSessionResponse>(response);
      let publicOrigin: string;
      try {
        publicOrigin = new URL(session.publicOrigin).origin;
      } catch {
        throw new HostedProviderRequestError(502);
      }
      if (publicOrigin !== session.publicOrigin) throw new HostedProviderRequestError(502);
      if (typeof window !== 'undefined' && publicOrigin !== window.location.origin) {
        throw new HostedProviderRequestError(502);
      }
      this.session = session;
      return session;
    }).finally(() => {
      this.sessionRequest = null;
    });

    this.sessionRequest = request;
    return request;
  }

  private async request<T>(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    value?: unknown,
  ): Promise<T> {
    const body = value === undefined ? undefined : JSON.stringify(value);
    let session = await this.getSession();
    let response = await this.send(method, path, session, body);
    if (response.status === 401 || response.status === 419) {
      this.session = null;
      session = await this.getSession(true);
      response = await this.send(method, path, session, body);
    }
    if (!response.ok) throw new HostedProviderRequestError(response.status);
    return parseResponse<T>(response);
  }

  private send(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    session: HostedSessionResponse,
    body?: string,
  ): Promise<Response> {
    const unsafe = method !== 'GET';
    return this.fetcher(path, {
      method,
      body,
      credentials: 'include',
      redirect: 'error',
      headers: unsafe
        ? {
            'Content-Type': 'application/json',
            'Origin': session.publicOrigin,
            [HOSTED_CSRF_HEADER]: session.csrfToken,
          }
        : undefined,
    });
  }
}
