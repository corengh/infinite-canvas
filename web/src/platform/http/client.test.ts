import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { authEvents } from "@/platform/auth/events";
import { authStore } from "@/platform/auth/store";

import { api } from "./client";
import { ApiError } from "./errors";
import { ensureFreshToken } from "./refresh-queue";
import { authResultFixture, unauthorizedFixture } from "./test/fixtures";
import { server } from "./test/server";

describe("平台 HTTP 客户端", () => {
    it("注入 token、请求 ID、Cookie 凭据并解包 data", async () => {
        authStore.getState().setTokens("access-token", 900);
        server.use(
            http.post("http://localhost/api/example", async ({ request }) => {
                expect(request.headers.get("Authorization")).toBe("Bearer access-token");
                expect(request.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/i);
                expect(request.credentials).toBe("include");
                expect(await request.json()).toEqual({ prompt: "测试" });
                return HttpResponse.json({ data: { ok: true } });
            }),
        );

        await expect(api.post("/example", { prompt: "测试" })).resolves.toEqual({ ok: true });
    });

    it("10 个并发 401 只轮转一次 refresh token", async () => {
        authStore.getState().setTokens("expired-token", 900);
        let refreshCount = 0;
        server.use(
            http.get("http://localhost/api/protected", ({ request }) => {
                return request.headers.get("Authorization") === "Bearer fresh-access-token" ? HttpResponse.json({ data: { ok: true } }) : HttpResponse.json(unauthorizedFixture, { status: 401 });
            }),
            http.post("http://localhost/api/auth/refresh", async () => {
                refreshCount += 1;
                await delay(20);
                return HttpResponse.json({ data: authResultFixture });
            }),
        );

        const results = await Promise.all(Array.from({ length: 10 }, () => api.get<{ ok: boolean }>("/protected")));
        expect(results).toEqual(Array.from({ length: 10 }, () => ({ ok: true })));
        expect(refreshCount).toBe(1);
    });

    it("没有 access token 时用 refresh cookie 恢复受保护请求", async () => {
        let refreshCount = 0;
        server.use(
            http.post("http://localhost/api/auth/refresh", () => {
                refreshCount += 1;
                return HttpResponse.json({ data: authResultFixture });
            }),
            http.get("http://localhost/api/restored", ({ request }) => {
                expect(request.headers.get("Authorization")).toBe("Bearer fresh-access-token");
                return HttpResponse.json({ data: { ok: true } });
            }),
        );

        await expect(api.get<{ ok: boolean }>("/restored")).resolves.toEqual({ ok: true });
        expect(refreshCount).toBe(1);
    });

    it("公开认证请求不注入 token，也不因 401 触发刷新", async () => {
        authStore.getState().setTokens("nearly-expired-token", 30);
        let refreshCount = 0;
        server.use(
            http.post("http://localhost/api/auth/refresh", () => {
                refreshCount += 1;
                return HttpResponse.json({ data: authResultFixture });
            }),
            http.post("http://localhost/api/auth/login", ({ request }) => {
                expect(request.headers.get("Authorization")).toBeNull();
                return HttpResponse.json({ error: { ...unauthorizedFixture.error, code: "CREDENTIALS_INVALID" } }, { status: 401 });
            }),
        );

        await expect(api.post("/auth/login", { login_id: "bad", password: "bad" }, { auth: "public" })).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });
        expect(refreshCount).toBe(0);
    });

    it("账号切换后不使用新账号 token 重放旧请求", async () => {
        authStore.getState().setTokens("account-a-token", 900);
        let releaseResponse: (() => void) | undefined;
        const responseGate = new Promise<void>((resolve) => {
            releaseResponse = resolve;
        });
        let requestStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            requestStarted = resolve;
        });
        let requestCount = 0;
        server.use(
            http.post("http://localhost/api/write", async () => {
                requestCount += 1;
                requestStarted?.();
                await responseGate;
                return HttpResponse.json(unauthorizedFixture, { status: 401 });
            }),
        );

        const oldRequest = api.post("/write", { value: "account-a-operation" });
        await started;
        authStore.getState().startSession("account-b-token", 900);
        releaseResponse?.();

        await expect(oldRequest).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
        expect(requestCount).toBe(1);
        expect(authStore.getState().accessToken).toBe("account-b-token");
    });

    it("拒绝把平台认证请求发送到绝对 URL", async () => {
        authStore.getState().setTokens("access-token", 900);

        await expect(api.get("https://cdn.example/result.png")).rejects.toMatchObject({ code: "INVALID_REQUEST_URL" });
    });

    it("刷新在途时返回同一个 Promise", async () => {
        server.use(
            http.post("http://localhost/api/auth/refresh", async () => {
                await delay(10);
                return HttpResponse.json({ data: authResultFixture });
            }),
        );

        const first = ensureFreshToken();
        const second = ensureFreshToken();
        expect(first).toBe(second);
        await expect(first).resolves.toBe("fresh-access-token");
    });

    it("token 剩余不足两分钟时主动刷新", async () => {
        authStore.getState().setTokens("nearly-expired-token", 60);
        let refreshCount = 0;
        server.use(
            http.post("http://localhost/api/auth/refresh", () => {
                refreshCount += 1;
                return HttpResponse.json({ data: authResultFixture });
            }),
            http.get("http://localhost/api/proactive", ({ request }) => {
                expect(request.headers.get("Authorization")).toBe("Bearer fresh-access-token");
                return HttpResponse.json({ data: { ok: true } });
            }),
        );

        await api.get("/proactive");
        expect(refreshCount).toBe(1);
    });

    it("刷新失败时清理认证状态并发布 session-expired", async () => {
        authStore.getState().setTokens("expired-token", 900);
        const listener = vi.fn();
        const unsubscribe = authEvents.on("session-expired", listener);
        server.use(
            http.get("http://localhost/api/protected", () => HttpResponse.json(unauthorizedFixture, { status: 401 })),
            http.post("http://localhost/api/auth/refresh", () => HttpResponse.json(unauthorizedFixture, { status: 401 })),
        );

        await expect(api.get("/protected")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
        expect(authStore.getState().accessToken).toBeNull();
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it("刷新后仍是 401 时只重试一次", async () => {
        authStore.getState().setTokens("expired-token", 900);
        let requestCount = 0;
        server.use(
            http.get("http://localhost/api/always-unauthorized", () => {
                requestCount += 1;
                return HttpResponse.json(unauthorizedFixture, { status: 401 });
            }),
            http.post("http://localhost/api/auth/refresh", () => HttpResponse.json({ data: authResultFixture })),
        );

        await expect(api.get("/always-unauthorized")).rejects.toBeInstanceOf(ApiError);
        expect(requestCount).toBe(2);
    });

    it("超过配置时间后归一化为 TIMEOUT", async () => {
        authStore.getState().setTokens("access-token", 900);
        server.use(
            http.get("http://localhost/api/slow", async () => {
                await delay(100);
                return HttpResponse.json({ data: { ok: true } });
            }),
        );

        await expect(api.get("/slow", { timeoutMs: 5 })).rejects.toMatchObject({ code: "TIMEOUT", status: 0 });
    });
});
