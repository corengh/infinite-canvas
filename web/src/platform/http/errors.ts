import { authEvents } from "@/platform/auth/events";
import { canvasEvents } from "@/platform/canvas/events";

import { HttpResponseError, InvalidRequestUrlError, RequestTimeoutError } from "./transport";

type ErrorDetails = Record<string, unknown>;

type ErrorEnvelope = {
    error?: {
        code?: unknown;
        message?: unknown;
        details?: unknown;
        request_id?: unknown;
    };
};

export class ApiError extends Error {
    constructor(
        public readonly code: string,
        public readonly status: number,
        message: string,
        public readonly details?: ErrorDetails,
        public readonly requestId?: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

function asDetails(value: unknown): ErrorDetails | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as ErrorDetails) : undefined;
}

export function normalizeError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof RequestTimeoutError) return new ApiError("TIMEOUT", 0, "请求超时");
    if (error instanceof InvalidRequestUrlError) return new ApiError("INVALID_REQUEST_URL", 0, error.message);
    if (error instanceof HttpResponseError) {
        const envelope = error.body !== null && typeof error.body === "object" ? (error.body as ErrorEnvelope).error : undefined;
        const code = typeof envelope?.code === "string" ? envelope.code : "HTTP_ERROR";
        const message = typeof envelope?.message === "string" ? envelope.message : `请求失败（${error.response.status}）`;
        const requestId = typeof envelope?.request_id === "string" ? envelope.request_id : (error.response.headers.get("X-Request-Id") ?? undefined);
        return new ApiError(code, error.response.status, message, asDetails(envelope?.details), requestId);
    }
    if (error instanceof Error && error.name === "AbortError") return new ApiError("NETWORK_ERROR", 0, "请求已取消");
    return new ApiError("NETWORK_ERROR", 0, "网络连接失败");
}

export type ErrorDisposition =
    | { kind: "silent" }
    | { kind: "caller" }
    | { kind: "retry"; delayMs: number }
    | { kind: "toast"; message: string; requestId?: string }
    | { kind: "modal"; message: string; requestId?: string }
    | { kind: "navigate"; target: "back" };

type ErrorActionListener = (disposition: ErrorDisposition, error: ApiError, scope: string) => void;
const actionListeners = new Set<ErrorActionListener>();

// UI 层可统一订阅 toast、弹窗与跳转动作，HTTP 层本身不依赖 React 上下文。
export const apiErrorEvents = {
    onAction(listener: ErrorActionListener): () => void {
        actionListeners.add(listener);
        return () => actionListeners.delete(listener);
    },
};

function publish(disposition: ErrorDisposition, error: ApiError, scope: string): ErrorDisposition {
    actionListeners.forEach((listener) => listener(disposition, error, scope));
    return disposition;
}

export function handleApiError(error: ApiError, context: { scope: string }): ErrorDisposition {
    switch (error.code) {
        case "UNAUTHORIZED":
        case "REFRESH_TOKEN_INVALID":
        case "REFRESH_TOKEN_REUSED":
        case "SESSION_REVOKED":
            authEvents.emit("session-expired");
            return { kind: "silent" };
        case "CREDIT_INSUFFICIENT":
        case "RECLAIM_EXCEEDS_AVAILABLE":
        case "VALIDATION_ERROR":
        case "INVALID_REQUEST_URL":
        case "SMS_RATE_LIMITED":
        case "SMS_QUOTA_EXCEEDED":
        case "CODE_RESEND_TOO_SOON":
            return { kind: "caller" };
        case "RATE_LIMITED": {
            const retryAfter = typeof error.details?.retry_after === "number" ? error.details.retry_after * 1000 : 1000;
            return { kind: "retry", delayMs: retryAfter };
        }
        case "REQUEST_IN_PROGRESS":
        case "NETWORK_ERROR":
        case "TIMEOUT":
            return { kind: "retry", delayMs: 1000 };
        case "AUTH_SESSION_CHANGED":
            return { kind: "silent" };
        case "CANVAS_LOCK_NOT_HELD":
        case "CANVAS_LOCK_HELD_BY_OTHER":
            canvasEvents.emit("lock-lost", error.details);
            return { kind: "silent" };
        case "NOT_FOUND":
            return publish({ kind: "navigate", target: "back" }, error, context.scope);
        case "FORBIDDEN":
            return publish({ kind: "modal", message: error.message, requestId: error.requestId }, error, context.scope);
        default:
            return publish({ kind: "toast", message: error.message, requestId: error.requestId }, error, context.scope);
    }
}
