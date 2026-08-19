import { describe, expect, it, vi } from "vitest";

import { authEvents } from "@/platform/auth/events";
import { canvasEvents } from "@/platform/canvas/events";

import { ApiError, apiErrorEvents, handleApiError, normalizeError } from "./errors";
import { HttpResponseError, RequestTimeoutError } from "./transport";

describe("错误归一化与统一处置", () => {
    it("保留 D-19 的 code、details 与 request_id", () => {
        const response = new Response(null, { status: 402 });
        const error = normalizeError(
            new HttpResponseError(response, {
                error: {
                    code: "CREDIT_INSUFFICIENT",
                    message: "可用积分不足",
                    details: { required: 110, available: 45 },
                    request_id: "request-1",
                },
            }),
        );

        expect(error).toMatchObject({ code: "CREDIT_INSUFFICIENT", status: 402, details: { required: 110, available: 45 }, requestId: "request-1" });
    });

    it("区分网络错误与超时", () => {
        expect(normalizeError(new TypeError("fetch failed"))).toMatchObject({ code: "NETWORK_ERROR", status: 0 });
        expect(normalizeError(new RequestTimeoutError())).toMatchObject({ code: "TIMEOUT", status: 0 });
    });

    it("会话错误静默发布认证事件", () => {
        const listener = vi.fn();
        const unsubscribe = authEvents.on("session-expired", listener);
        expect(handleApiError(new ApiError("SESSION_REVOKED", 401, "已退出"), { scope: "test" })).toEqual({ kind: "silent" });
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it("按 code 选择重试、调用方处理与统一 UI 动作", () => {
        const action = vi.fn();
        const unsubscribe = apiErrorEvents.onAction(action);
        expect(handleApiError(new ApiError("RATE_LIMITED", 429, "限流", { retry_after: 2 }), { scope: "test" })).toEqual({ kind: "retry", delayMs: 2000 });
        expect(handleApiError(new ApiError("VALIDATION_ERROR", 422, "参数错误"), { scope: "test" })).toEqual({ kind: "caller" });
        expect(handleApiError(new ApiError("NOT_FOUND", 404, "不存在"), { scope: "test" })).toEqual({ kind: "navigate", target: "back" });
        expect(action).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it("画布锁丢失时发布事件并静默交给画布模块处理", () => {
        const listener = vi.fn();
        const unsubscribe = canvasEvents.on("lock-lost", listener);
        const details = { holder: { user_id: "user-2", display_name: "接管者" } };

        expect(handleApiError(new ApiError("CANVAS_LOCK_NOT_HELD", 409, "编辑锁已丢失", details), { scope: "canvas" })).toEqual({ kind: "silent" });
        expect(listener).toHaveBeenCalledWith(details);
        unsubscribe();
    });
});
