import { authEvents } from "@/platform/auth/events";
import { authStore } from "@/platform/auth/store";

import { ApiError, normalizeError } from "./errors";
import { ensureFreshToken } from "./refresh-queue";
import { HttpResponseError, rawRequest, rawStreamRequest } from "./transport";

const PROACTIVE_REFRESH_WINDOW_MS = 2 * 60 * 1000;

export type ApiAuthMode = "required" | "public";

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
    body?: unknown;
    timeoutMs?: number;
    auth?: ApiAuthMode;
};

type PreparedAuth = {
    mode: ApiAuthMode;
    token: string | null;
    sessionEpoch: number;
};

function createHeaders(headers: HeadersInit | undefined, token: string | null, body: unknown): Headers {
    const result = new Headers(headers);
    result.set("X-Request-Id", crypto.randomUUID());
    if (token) result.set("Authorization", `Bearer ${token}`);
    if (body !== undefined && !(body instanceof FormData) && !result.has("Content-Type")) result.set("Content-Type", "application/json");
    return result;
}

function serializeBody(body: unknown): BodyInit | undefined {
    if (body === undefined) return undefined;
    if (body instanceof FormData || body instanceof Blob || typeof body === "string" || body instanceof URLSearchParams || body instanceof ArrayBuffer) return body;
    return JSON.stringify(body);
}

function unwrapData<T>(body: unknown): T {
    if (body !== null && typeof body === "object" && "data" in body) return (body as { data: T }).data;
    return body as T;
}

function sessionChangedError(): ApiError {
    return new ApiError("AUTH_SESSION_CHANGED", 0, "登录账号已变更，旧请求已取消");
}

function assertSessionCurrent(sessionEpoch: number): void {
    const current = authStore.getState();
    if (current.sessionEpoch === sessionEpoch) return;
    if (current.expiredSessionEpoch === sessionEpoch) {
        authEvents.emit("session-expired");
        throw new ApiError("UNAUTHORIZED", 401, "登录已过期");
    }
    throw sessionChangedError();
}

async function prepareAuth(mode: ApiAuthMode): Promise<PreparedAuth> {
    const { accessToken, expiresAt, sessionEpoch, expiredSessionEpoch } = authStore.getState();
    if (mode === "public") return { mode, token: null, sessionEpoch };
    if (accessToken && expiresAt !== null && expiresAt - Date.now() >= PROACTIVE_REFRESH_WINDOW_MS) return { mode, token: accessToken, sessionEpoch };
    if (!accessToken && expiredSessionEpoch !== null) {
        authEvents.emit("session-expired");
        throw new ApiError("UNAUTHORIZED", 401, "登录已过期");
    }

    // 新标签页或标签页重开后 sessionStorage 可能为空，此时用 30 天 refresh cookie 恢复会话。
    const freshToken = await ensureFreshToken(sessionEpoch);
    assertSessionCurrent(sessionEpoch);
    if (freshToken) return { mode, token: freshToken, sessionEpoch };
    authEvents.emit("session-expired");
    throw new ApiError("UNAUTHORIZED", 401, "登录已过期");
}

async function executeJson<T>(path: string, options: ApiRequestOptions = {}, __retried = false, preparedAuth?: PreparedAuth): Promise<T> {
    const { auth = "required", ...requestOptions } = options;
    const prepared = preparedAuth ?? (await prepareAuth(auth));
    const headers = createHeaders(requestOptions.headers, prepared.token, requestOptions.body);
    try {
        const body = await rawRequest(path, {
            ...requestOptions,
            headers,
            body: serializeBody(requestOptions.body),
        });
        if (prepared.mode === "required") assertSessionCurrent(prepared.sessionEpoch);
        return unwrapData<T>(body);
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if (prepared.mode === "required") assertSessionCurrent(prepared.sessionEpoch);
        if (!(error instanceof HttpResponseError) || error.response.status !== 401 || __retried || prepared.mode === "public") throw normalizeError(error);
        // 较早发出的请求可能在另一请求完成刷新后才收到 401，此时直接复用新 token，避免再次轮转 refresh token。
        const currentToken = authStore.getState().accessToken;
        const freshToken = currentToken && currentToken !== prepared.token ? currentToken : await ensureFreshToken(prepared.sessionEpoch);
        assertSessionCurrent(prepared.sessionEpoch);
        if (!freshToken) {
            authEvents.emit("session-expired");
            throw normalizeError(error);
        }
        return executeJson<T>(path, options, true, { ...prepared, token: freshToken });
    }
}

export async function fetchWithAuth(path: string, options: RequestInit = {}, __retried = false, preparedAuth?: PreparedAuth): Promise<Response> {
    const prepared = preparedAuth ?? (await prepareAuth("required"));
    const headers = createHeaders(options.headers, prepared.token, undefined);
    try {
        const response = await rawStreamRequest(path, { ...options, headers });
        if (authStore.getState().sessionEpoch !== prepared.sessionEpoch) {
            await response.body?.cancel().catch(() => undefined);
            assertSessionCurrent(prepared.sessionEpoch);
        }
        return response;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        assertSessionCurrent(prepared.sessionEpoch);
        if (!(error instanceof HttpResponseError) || error.response.status !== 401 || __retried) throw normalizeError(error);
        const currentToken = authStore.getState().accessToken;
        const freshToken = currentToken && currentToken !== prepared.token ? currentToken : await ensureFreshToken(prepared.sessionEpoch);
        assertSessionCurrent(prepared.sessionEpoch);
        if (!freshToken) {
            authEvents.emit("session-expired");
            throw normalizeError(error);
        }
        return fetchWithAuth(path, options, true, { ...prepared, token: freshToken });
    }
}

export const api = {
    request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
        return executeJson<T>(path, options);
    },
    get<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
        return executeJson<T>(path, { ...options, method: "GET" });
    },
    post<T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
        return executeJson<T>(path, { ...options, method: "POST", body });
    },
    patch<T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
        return executeJson<T>(path, { ...options, method: "PATCH", body });
    },
    delete<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
        return executeJson<T>(path, { ...options, method: "DELETE" });
    },
};
