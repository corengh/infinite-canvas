import { authStore } from "@/platform/auth/store";
import type { UserDTO } from "@/platform/auth/store";

import { normalizeError } from "./errors";
import { HttpResponseError, rawRequest } from "./transport";

type AuthResult = {
    access_token: string;
    expires_in: number;
    user?: UserDTO;
};

type RefreshingRequest = {
    epoch: number;
    controller: AbortController;
    promise: Promise<string | null>;
};

let refreshing: RefreshingRequest | null = null;

function unwrapData<T>(body: unknown): T {
    if (body !== null && typeof body === "object" && "data" in body) return (body as { data: T }).data;
    return body as T;
}

export function ensureFreshToken(expectedEpoch = authStore.getState().sessionEpoch): Promise<string | null> {
    if (authStore.getState().sessionEpoch !== expectedEpoch) return Promise.resolve(null);
    if (refreshing?.epoch === expectedEpoch) return refreshing.promise;
    // 账号切换时先等待旧刷新被 abort，不能让两个 refresh token 轮转请求并发。
    if (refreshing) return refreshing.promise.then(() => ensureFreshToken(expectedEpoch));

    const controller = new AbortController();
    const request: RefreshingRequest = { epoch: expectedEpoch, controller, promise: Promise.resolve(null) };
    request.promise = (async () => {
        try {
            const result = unwrapData<AuthResult>(await rawRequest("/auth/refresh", { method: "POST", signal: controller.signal }));
            if (!result || typeof result.access_token !== "string" || typeof result.expires_in !== "number") throw new TypeError("刷新响应不符合 AuthResult 契约");
            if (authStore.getState().sessionEpoch !== expectedEpoch) return null;
            authStore.getState().updateAccessToken(result.access_token, result.expires_in);
            // 启动恢复期必须等 GET /me 完成后再结束 unknown，避免守卫提前放行。
            if (result.user && authStore.getState().status !== "unknown") authStore.getState().setUser(result.user);
            return result.access_token;
        } catch (cause) {
            // 旧会话的迟到失败不得清除或干扰用户刚登录的新会话。
            if (authStore.getState().sessionEpoch !== expectedEpoch) return null;
            if (cause instanceof HttpResponseError && cause.response.status === 401) {
                authStore.getState().expireSession(expectedEpoch);
                return null;
            }
            // 网络、超时与 5xx 不是凭据失效；向上抛出以便页面保留会话并提供重试。
            throw normalizeError(cause);
        } finally {
            if (refreshing === request) refreshing = null;
        }
    })();
    refreshing = request;
    return request.promise;
}

authStore.subscribe((state, previousState) => {
    if (state.sessionEpoch !== previousState.sessionEpoch && refreshing?.epoch !== state.sessionEpoch) refreshing?.controller.abort();
});

export function resetRefreshQueueForTests(): void {
    refreshing?.controller.abort();
    refreshing = null;
}
