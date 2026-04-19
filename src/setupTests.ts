import '@testing-library/jest-dom';

// jsdom doesn't provide Web Fetch API globals (Response, Headers).
// The @forge/bridge shim's productRequest() uses both Headers and Response,
// so tests that use requestJira/requestConfluence need these globals.
if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = class Headers {
    private _map = new Map<string, string>();
    constructor(init?: Record<string, string> | Array<[string, string]> | Headers) {
      if (init instanceof Headers) {
        (init as Headers).forEach((v: string, k: string) => this._map.set(k.toLowerCase(), v));
      } else if (Array.isArray(init)) {
        for (const [k, v] of init) this._map.set(k.toLowerCase(), v);
      } else if (init) {
        for (const [k, v] of Object.entries(init)) this._map.set(k.toLowerCase(), v);
      }
    }
    get(name: string) { return this._map.get(name.toLowerCase()) ?? null; }
    set(name: string, value: string) { this._map.set(name.toLowerCase(), value); }
    has(name: string) { return this._map.has(name.toLowerCase()); }
    delete(name: string) { this._map.delete(name.toLowerCase()); }
    forEach(cb: (value: string, key: string) => void) { this._map.forEach(cb); }
  } as unknown as typeof Headers;
}

if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = class Response {
    readonly status: number;
    readonly ok: boolean;
    readonly headers: Headers;
    private _body: string;

    constructor(body?: string | null, init?: { status?: number; headers?: Headers | Record<string, string> }) {
      this._body = body ?? '';
      this.status = init?.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = init?.headers instanceof Headers
        ? init.headers
        : new Headers(init?.headers as Record<string, string> | undefined);
    }

    async json() { return JSON.parse(this._body); }
    async text() { return this._body; }
  } as unknown as typeof Response;
}
