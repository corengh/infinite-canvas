import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import { consumeCaptchaAttempt } from "@/pages/auth/components";
import { queryClient } from "@/lib/query-client";
import { loginRedirectTarget } from "@/pages/auth/login";
import { ApiError } from "@/platform/http/errors";
import { authApi } from "./api";
import { canvasSyncControl } from "./canvas-sync-control";
import { canAccess } from "./capability";
import { retryAfterSeconds } from "./countdown";
import { authGuardDecision } from "./guard";
import { reloginCurrentSession } from "./relogin-overlay";
import { authStore, type AuthResult } from "./store";
import { logoutCurrentSession } from "./user-menu";

const typedAuthResult: AuthResult = {
    ...authResultFixture,
    user: { ...authResultFixture.user, account_type: "owner", role: "owner" },
};

function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value),
    };
}

describe("FE-2 认证行为", () => {
    it.each([" 13800138000 ", " ZhangSan@XiaoYunQue "])("两种登录标识都原样交给服务端分流：%s", async (loginId) => {
        server.use(
            http.post("http://localhost/api/auth/login", async ({ request }) => {
                const body = (await request.json()) as { login_id: string };
                expect(body.login_id).toBe(loginId.trim().toLowerCase());
                return HttpResponse.json({ data: authResultFixture });
            }),
        );
        await expect(authApi.login(loginId, "Password1")).resolves.toMatchObject({ access_token: "fresh-access-token" });
    });

    it("注册发码与最终提交使用两个独立图形验证码", async () => {
        let captchaCount = 0;
        const used: string[] = [];
        server.use(
            http.post("http://localhost/api/auth/captcha", () => HttpResponse.json({ data: { captcha_id: `captcha-${++captchaCount}`, image_base64: "AA==", expires_in: 300 } })),
            http.post("http://localhost/api/auth/register/code", async ({ request }) => {
                used.push(((await request.json()) as { captcha_id: string }).captcha_id);
                return HttpResponse.json({ data: { sent: true, resend_after: 60 } });
            }),
            http.post("http://localhost/api/auth/register", async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                used.push(body.captcha_id as string);
                expect(body.team_slug).toBe("xiaoyunque");
                return HttpResponse.json({ data: authResultFixture });
            }),
        );
        const first = await authApi.captcha();
        await authApi.registerCode("13800138000", first.captcha_id, "3f9a");
        const second = await authApi.captcha();
        await authApi.register({ phone: "13800138000", password: "Password1", smsCode: "123456", captchaId: second.captcha_id, captchaCode: "7k2m", teamSlug: "XiaoYunQue" });
        expect(used).toEqual(["captcha-1", "captcha-2"]);
    });

    it.each(["CAPTCHA_INVALID", "SMS_RATE_LIMITED", "SMS_QUOTA_EXCEEDED", "CODE_RESEND_TOO_SOON"])("发码错误 %s 不会被 API 层自动重试", async (code) => {
        let requests = 0;
        server.use(
            http.post("http://localhost/api/auth/register/code", () => {
                requests += 1;
                return HttpResponse.json({ error: { code, message: "请稍后再试", details: { retry_after: 37 } } }, { status: 429 });
            }),
        );
        await expect(authApi.registerCode("13800138000", "captcha", "3f9a")).rejects.toMatchObject({ code });
        expect(requests).toBe(1);
    });

    it("一次性验证码请求无论成功失败都会换新挑战", async () => {
        const renewAfterSuccess = vi.fn(async () => undefined);
        const renewAfterFailure = vi.fn(async () => undefined);

        await expect(consumeCaptchaAttempt(async () => "sent", renewAfterSuccess)).resolves.toBe("sent");
        await expect(consumeCaptchaAttempt(async () => Promise.reject(new Error("业务校验失败")), renewAfterFailure)).rejects.toThrow("业务校验失败");
        expect(renewAfterSuccess).toHaveBeenCalledOnce();
        expect(renewAfterFailure).toHaveBeenCalledOnce();
    });

    it("rehydrate 完成前保持 unknown，成功后写入用户、团队和能力集合", async () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        authStore.getState().authenticate(
            {
                ...authResultFixture,
                user: { ...authResultFixture.user, account_type: "owner" as const, role: "owner" as const, capabilities: ["credit.transfer"] },
            },
            "13800138000",
        );
        authStore.setState({ user: null, team: null, role: null, capabilities: new Set(), status: "unknown", accessToken: null, expiresAt: null });
        server.use(
            http.get("http://localhost/api/me", async () => {
                await delay(20);
                return HttpResponse.json({ data: { ...authResultFixture.user, role: "owner", capabilities: ["credit.transfer"] } });
            }),
        );

        const restoring = authStore.getState().rehydrate(() => authApi.me());
        expect(authStore.getState().status).toBe("unknown");
        await restoring;
        expect(authStore.getState()).toMatchObject({ status: "authed", role: "owner", team: authResultFixture.user.team });
        expect(canAccess(authStore.getState().capabilities, "credit.transfer")).toBe(true);
        vi.unstubAllGlobals();
    });

    it("rehydrate 临时失败时保留 token 并可重试，401 才清理会话", async () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        authStore.getState().authenticate(typedAuthResult, "13800138000");
        authStore.setState({ user: null, team: null, role: null, capabilities: new Set(), status: "unknown", accessToken: null, expiresAt: null });

        await authStore.getState().rehydrate(async () => Promise.reject(new ApiError("NETWORK_ERROR", 0, "网络连接失败")));
        expect(authStore.getState()).toMatchObject({ status: "unknown", rehydrateError: "网络连接失败", accessToken: "fresh-access-token" });

        await authStore.getState().rehydrate(async () => typedAuthResult.user);
        expect(authStore.getState()).toMatchObject({ status: "authed", rehydrateError: null, accessToken: "fresh-access-token" });

        await authStore.getState().rehydrate(async () => Promise.reject(new ApiError("UNAUTHORIZED", 401, "登录已过期")));
        expect(authStore.getState()).toMatchObject({ status: "anonymous", accessToken: null });
        vi.unstubAllGlobals();
    });

    it("服务端登出失败时保留当前登录态", async () => {
        authStore.getState().authenticate(typedAuthResult, "13800138000");
        server.use(http.post("http://localhost/api/auth/logout", () => HttpResponse.json({ error: { code: "HTTP_ERROR", message: "服务暂时不可用" } }, { status: 503 })));

        await expect(logoutCurrentSession()).rejects.toMatchObject({ status: 503 });
        expect(authStore.getState()).toMatchObject({ status: "authed", accessToken: "fresh-access-token" });
    });

    it("服务端登出成功后清除上一账号的查询缓存", async () => {
        authStore.getState().authenticate(typedAuthResult, "13800138000");
        queryClient.setQueryData(["wallet", typedAuthResult.user.id, "balance"], { available: 10_000 });
        server.use(http.post("http://localhost/api/auth/logout", () => HttpResponse.json({ data: { logged_out: true } })));

        await logoutCurrentSession();

        expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
        expect(authStore.getState().status).toBe("anonymous");
    });

    it("守卫不在恢复期跳登录页，且登录后返回原始完整路由", () => {
        expect(authGuardDecision("unknown")).toBe("spinner");
        expect(authGuardDecision("anonymous")).toBe("login");
        expect(authGuardDecision("authed")).toBe("content");
        expect(loginRedirectTarget({ from: { pathname: "/canvas/abc", search: "?mode=edit", hash: "#node-1" } })).toBe("/canvas/abc?mode=edit#node-1");
    });

    it("锁定倒计时读取 retry_after，重登后补交暂停期间积压的 op", async () => {
        expect(retryAfterSeconds({ retry_after: 42 }, 900)).toBe(42);
        const pending = ["op-before-expiry"];
        const submitted: string[] = [];
        const unregister = canvasSyncControl.register({
            pauseSubmissions: () => pending.push("op-during-relogin"),
            resumeSubmissions: () => {
                submitted.push(...pending.splice(0));
            },
        });
        canvasSyncControl.pause();
        expect(canvasSyncControl.isPaused()).toBe(true);
        await canvasSyncControl.resume();
        expect(canvasSyncControl.isPaused()).toBe(false);
        expect(submitted).toEqual(["op-before-expiry", "op-during-relogin"]);
        unregister();
    });

    it("重登失败保持提交暂停，认证成功后才补交积压 op", async () => {
        const submitted: string[] = [];
        const unregister = canvasSyncControl.register({
            pauseSubmissions: () => undefined,
            resumeSubmissions: () => {
                submitted.push("queued-op");
            },
        });
        canvasSyncControl.pause();
        server.use(http.post("http://localhost/api/auth/login", () => HttpResponse.json({ error: { code: "CREDENTIALS_INVALID", message: "账号或密码错误" } }, { status: 401 })));

        await expect(reloginCurrentSession("13800138000", "wrong-password")).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });
        expect(canvasSyncControl.isPaused()).toBe(true);
        expect(submitted).toEqual([]);

        server.use(
            http.post("http://localhost/api/auth/login", () => HttpResponse.json({ data: typedAuthResult })),
            http.get("http://localhost/api/me", () => HttpResponse.json({ data: typedAuthResult.user })),
        );
        await reloginCurrentSession("13800138000", "Password1");
        expect(canvasSyncControl.isPaused()).toBe(false);
        expect(submitted).toEqual(["queued-op"]);
        unregister();
    });
});
