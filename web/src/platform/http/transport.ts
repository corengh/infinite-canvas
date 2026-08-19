import { runtime } from "@/platform/runtime";

export const DEFAULT_TIMEOUT_MS = 30_000;

export type InternalRequestInit = RequestInit & {
    timeoutMs?: number;
};

export class HttpResponseError extends Error {
    constructor(
        public readonly response: Response,
        public readonly body: unknown,
    ) {
        super(`HTTP ${response.status}`);
        this.name = "HttpResponseError";
    }
}

export class RequestTimeoutError extends Error {
    constructor() {
        super("请求超时");
        this.name = "RequestTimeoutError";
    }
}

export class InvalidRequestUrlError extends Error {
    constructor() {
        super("平台 API 客户端只接受相对路径");
        this.name = "InvalidRequestUrlError";
    }
}

export function resolveApiUrl(path: string): string {
    // 禁止绝对地址，避免上层注入的 Bearer token 被发送到 CDN 或第三方域名。
    if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) throw new InvalidRequestUrlError();
    const base = runtime.apiBaseUrl.replace(/\/$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const relativeUrl = `${base}${suffix}`;
    // Node 测试环境没有页面 origin；生产浏览器继续使用相对地址以支持同源部署。
    return typeof window === "undefined" && relativeUrl.startsWith("/") ? new URL(relativeUrl, "http://localhost").toString() : relativeUrl;
}

function createRequestSignal(signal: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (signal?.aborted) abortFromCaller();
    const timer =
        timeoutMs > 0
            ? setTimeout(() => {
                  timedOut = true;
                  controller.abort();
              }, timeoutMs)
            : undefined;
    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        cleanup: () => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", abortFromCaller);
        },
    };
}

export async function readResponseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

export async function rawRequest(path: string, init: InternalRequestInit = {}): Promise<unknown> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...requestInit } = init;
    const requestSignal = createRequestSignal(signal, timeoutMs);
    try {
        const response = await fetch(resolveApiUrl(path), { ...requestInit, signal: requestSignal.signal, credentials: "include" });
        const body = await readResponseBody(response);
        if (!response.ok) throw new HttpResponseError(response, body);
        return body;
    } catch (error) {
        if (requestSignal.didTimeout()) throw new RequestTimeoutError();
        throw error;
    } finally {
        requestSignal.cleanup();
    }
}

// SSE 不使用 30 秒请求超时，但仍复用 URL 与 Cookie 规则；取消由订阅者自己的 signal 控制。
export async function rawStreamRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(resolveApiUrl(path), { ...init, credentials: "include" });
    if (!response.ok) throw new HttpResponseError(response, await readResponseBody(response));
    return response;
}
