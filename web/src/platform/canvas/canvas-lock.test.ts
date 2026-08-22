import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { canvasApi, type CanvasLockState } from "@/platform/api/canvas";
import { authStore } from "@/platform/auth/store";
import { server } from "@/platform/http/test/server";

import { LockManager } from "./lock";

const canvasId = "01911111-1111-7111-8111-111111111111";
const secondCanvasId = "01911111-1111-7111-8111-111111111144";
const holder = { user_id: "01911111-1111-7111-8111-111111111122", display_name: "张三" };

function lockState(patch: Partial<CanvasLockState> = {}): CanvasLockState {
    return { mode: "edit", holder: null, expires_at: "2026-08-22T00:01:30Z", takeover_request: null, lock_lost: false, ...patch };
}

function harness(
    options: {
        acquire?: CanvasLockState | ((id: string) => CanvasLockState | Promise<CanvasLockState>);
        heartbeats?: Array<CanvasLockState | Error>;
        takeovers?: Array<CanvasLockState | Promise<CanvasLockState>>;
    } = {},
) {
    const readonlyChanges: boolean[] = [];
    const lost: Array<Record<string, unknown> | undefined> = [];
    const releases: string[] = [];
    const keepaliveReleases: string[] = [];
    const heartbeats = [...(options.heartbeats ?? [])];
    const takeovers = [...(options.takeovers ?? [])];
    const manager = new LockManager({
        acquire: async (id) => (typeof options.acquire === "function" ? options.acquire(id) : (options.acquire ?? lockState())),
        heartbeat: async () => {
            const next = heartbeats.shift() ?? lockState();
            if (next instanceof Error) throw next;
            return next;
        },
        release: async (id) => void releases.push(id),
        releaseKeepalive: (id) => (keepaliveReleases.push(id), true),
        takeover: async () => takeovers.shift() ?? lockState(),
        respondTakeover: async () => lockState(),
        setReadonly: (value) => void readonlyChanges.push(value),
        markLockLost: (details) => void lost.push(details),
    });
    return { manager, readonlyChanges, lost, releases, keepaliveReleases };
}

afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
});

describe("FE-8 画布编辑锁", () => {
    it("锁 API 使用冻结端点并携带标签页 session", async () => {
        authStore.getState().setTokens("lock-token", 900);
        const methods: string[] = [];
        const check = async ({ request }: { request: Request }) => {
            methods.push(request.method);
            expect(request.headers.get("Authorization")).toBe("Bearer lock-token");
            expect(await request.json()).toMatchObject({ session_id: "01911111-1111-7111-8111-111111111133" });
            return request.method === "DELETE" ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({ data: lockState() });
        };
        server.use(
            http.post("http://localhost/api/canvas/:id/lock", check),
            http.post("http://localhost/api/canvas/:id/lock/heartbeat", check),
            http.delete("http://localhost/api/canvas/:id/lock", check),
            http.post("http://localhost/api/canvas/:id/lock/takeover", check),
            http.post("http://localhost/api/canvas/:id/lock/takeover/respond", check),
        );
        const sessionId = "01911111-1111-7111-8111-111111111133";
        await canvasApi.acquireLock(canvasId, sessionId);
        await canvasApi.heartbeatLock(canvasId, sessionId);
        await canvasApi.requestTakeover(canvasId, sessionId);
        await canvasApi.respondTakeover(canvasId, sessionId);
        await canvasApi.releaseLock(canvasId, sessionId);
        expect(methods).toEqual(["POST", "POST", "POST", "POST", "DELETE"]);
    });

    it("退出释放使用带 Bearer 的 keepalive 请求", async () => {
        authStore.getState().setTokens("keepalive-token", 900);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
        expect(canvasApi.releaseLockKeepalive(canvasId, "01911111-1111-7111-8111-111111111133")).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/canvas/${canvasId}/lock/release`), expect.objectContaining({ method: "POST", keepalive: true, headers: expect.objectContaining({ Authorization: "Bearer keepalive-token" }) }));
        fetchMock.mockRestore();
    });

    it("获取失败进入只读并保留持锁人", async () => {
        const { manager, readonlyChanges } = harness({ acquire: lockState({ mode: "readonly", holder }) });
        await manager.acquire(canvasId);
        expect(manager.getState()).toMatchObject({ mode: "readonly", holder });
        expect(readonlyChanges).toEqual([true]);
    });

    it("每 30 秒心跳续期并接收接管申请", async () => {
        vi.useFakeTimers();
        const request = { by: { user_id: "u2", display_name: "李四" }, requested_at: "2026-08-22T00:00:30Z" };
        const { manager } = harness({ heartbeats: [lockState({ takeover_request: request, expires_at: "2026-08-22T00:02:00Z" })] });
        await manager.acquire(canvasId);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(manager.getState()).toMatchObject({ heartbeatFailures: 0, takeover_request: request, expires_at: "2026-08-22T00:02:00Z" });
    });

    it("连续三个心跳周期失败后转只读", async () => {
        vi.useFakeTimers();
        const { manager, lost } = harness({ heartbeats: [new Error("offline"), new Error("offline"), new Error("offline")] });
        await manager.acquire(canvasId);
        await vi.advanceTimersByTimeAsync(90_000);
        expect(manager.getState()).toMatchObject({ mode: "readonly", lock_lost: true, heartbeatFailures: 3 });
        expect(lost).toHaveLength(1);
    });

    it("接管申请倒计时结束后再次调用可强制接管", async () => {
        vi.useFakeTimers();
        const pending = lockState({ mode: "readonly", holder, pending: true, wait_seconds: 30 });
        const { manager, readonlyChanges } = harness({ acquire: lockState({ mode: "readonly", holder }), takeovers: [pending, lockState({ pending: false, wait_seconds: 0 })] });
        await manager.acquire(canvasId);
        await manager.requestTakeover();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(manager.getState().wait_seconds).toBe(0);
        await manager.requestTakeover();
        expect(manager.getState().mode).toBe("edit");
        expect(readonlyChanges.at(-1)).toBe(false);
    });

    it("切换画布后忽略旧画布迟到的接管响应", async () => {
        let resolveTakeover!: (value: CanvasLockState) => void;
        const delayedTakeover = new Promise<CanvasLockState>((resolve) => {
            resolveTakeover = resolve;
        });
        const { manager, readonlyChanges } = harness({
            acquire: () => lockState({ mode: "readonly", holder }),
            takeovers: [delayedTakeover],
        });
        await manager.acquire(canvasId);
        const takeover = manager.requestTakeover();
        await manager.release(canvasId);
        await manager.acquire(secondCanvasId);

        resolveTakeover(lockState());

        await expect(takeover).resolves.toBeNull();
        expect(manager.getState()).toMatchObject({ canvasId: secondCanvasId, mode: "readonly" });
        expect(readonlyChanges).toEqual([true, true]);
    });

    it("让出后重新取得锁仍会在退出时主动释放", async () => {
        const fakeWindow = new EventTarget();
        const fakeDocument = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
        fakeDocument.visibilityState = "visible";
        Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
        Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
        const { manager, keepaliveReleases } = harness();
        await manager.acquire(canvasId);
        await manager.yieldLock();
        await manager.requestTakeover();

        fakeWindow.dispatchEvent(new Event("beforeunload"));

        expect(keepaliveReleases).toEqual([canvasId]);
    });

    it("隐藏页面不释放，恢复可见立即心跳，退出使用 keepalive 释放", async () => {
        const fakeWindow = new EventTarget();
        const fakeDocument = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
        fakeDocument.visibilityState = "hidden";
        Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
        Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
        const { manager, keepaliveReleases } = harness();
        const heartbeat = vi.spyOn(manager, "heartbeat");
        await manager.acquire(canvasId);
        fakeDocument.dispatchEvent(new Event("visibilitychange"));
        expect(heartbeat).not.toHaveBeenCalled();
        fakeDocument.visibilityState = "visible";
        fakeDocument.dispatchEvent(new Event("visibilitychange"));
        expect(heartbeat).toHaveBeenCalledTimes(1);
        fakeWindow.dispatchEvent(new Event("beforeunload"));
        fakeWindow.dispatchEvent(new Event("pagehide"));
        expect(keepaliveReleases).toEqual([canvasId]);
    });
});
