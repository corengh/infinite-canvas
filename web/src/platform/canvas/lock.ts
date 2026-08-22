import { useSyncExternalStore } from "react";

import { canvasApi, type CanvasLockState } from "@/platform/api/canvas";

import { canvasSessionId } from "./session";
import { canvasSync } from "./sync-engine";

const HEARTBEAT_MS = 30_000;
const MAX_HEARTBEAT_FAILURES = 3;

export type LockManagerState = CanvasLockState & {
    canvasId: string | null;
    heartbeatFailures: number;
};

type LockDependencies = {
    acquire: typeof canvasApi.acquireLock;
    heartbeat: typeof canvasApi.heartbeatLock;
    release: typeof canvasApi.releaseLock;
    releaseKeepalive: typeof canvasApi.releaseLockKeepalive;
    takeover: typeof canvasApi.requestTakeover;
    respondTakeover: typeof canvasApi.respondTakeover;
    setReadonly: (value: boolean) => void;
    markLockLost: (details?: Record<string, unknown>) => void;
};

const defaultDependencies: LockDependencies = {
    acquire: canvasApi.acquireLock,
    heartbeat: canvasApi.heartbeatLock,
    release: canvasApi.releaseLock,
    releaseKeepalive: canvasApi.releaseLockKeepalive,
    takeover: canvasApi.requestTakeover,
    respondTakeover: canvasApi.respondTakeover,
    setReadonly: (value) => canvasSync.setReadonly(value),
    markLockLost: (details) => canvasSync.markLockLost(details),
};

const EMPTY_STATE: LockManagerState = {
    canvasId: null,
    mode: "readonly",
    holder: null,
    expires_at: null,
    takeover_request: null,
    lock_lost: false,
    pending: false,
    wait_seconds: 0,
    heartbeatFailures: 0,
};

export class LockManager {
    private state: LockManagerState = EMPTY_STATE;
    private listeners = new Set<() => void>();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private countdownTimer: ReturnType<typeof setInterval> | null = null;
    private lifecycleAttached = false;
    private unloading = false;
    private heartbeatInflight = false;
    private epoch = 0;

    constructor(private readonly dependencies: LockDependencies = defaultDependencies) {}

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): LockManagerState {
        return this.state;
    }

    async acquire(canvasId: string, signal?: AbortSignal): Promise<CanvasLockState> {
        const epoch = ++this.epoch;
        this.stopTimers();
        this.unloading = false;
        const result = await this.dependencies.acquire(canvasId, canvasSessionId(), signal);
        if (epoch !== this.epoch || signal?.aborted) return result;
        this.setState({ ...result, canvasId, heartbeatFailures: 0, pending: false, wait_seconds: 0 });
        this.dependencies.setReadonly(result.mode !== "edit");
        if (result.mode === "edit") this.startHeartbeat();
        this.attachLifecycle();
        return result;
    }

    startHeartbeat(): void {
        if (this.heartbeatTimer || this.state.mode !== "edit" || !this.state.canvasId) return;
        this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    }

    async heartbeat(): Promise<void> {
        const canvasId = this.state.canvasId;
        if (!canvasId || this.state.mode !== "edit" || this.heartbeatInflight) return;
        const epoch = this.epoch;
        this.heartbeatInflight = true;
        try {
            const result = await this.dependencies.heartbeat(canvasId, canvasSessionId());
            if (epoch !== this.epoch) return;
            if (result.lock_lost || result.mode !== "edit") {
                this.handleLockLost(result);
                return;
            }
            this.setState({ ...result, canvasId, heartbeatFailures: 0 });
        } catch {
            if (epoch !== this.epoch) return;
            const heartbeatFailures = this.state.heartbeatFailures + 1;
            this.setState({ heartbeatFailures });
            // 三个周期都无法确认续期时按失锁处理；继续假定可写会让本地修改不断累积。
            if (heartbeatFailures >= MAX_HEARTBEAT_FAILURES) this.handleLockLost(this.state);
        } finally {
            this.heartbeatInflight = false;
        }
    }

    async release(expectedCanvasId?: string): Promise<void> {
        const canvasId = this.state.canvasId;
        if (!canvasId || (expectedCanvasId && expectedCanvasId !== canvasId)) return;
        ++this.epoch;
        this.stopTimers();
        this.detachLifecycle();
        this.state = EMPTY_STATE;
        this.emit();
        await this.dependencies.release(canvasId, canvasSessionId()).catch(() => undefined);
    }

    async requestTakeover(): Promise<CanvasLockState | null> {
        const canvasId = this.state.canvasId;
        if (!canvasId) return null;
        const epoch = this.epoch;
        const result = await this.dependencies.takeover(canvasId, canvasSessionId());
        // 用户可能在请求期间切换画布；旧响应不得覆盖新画布的锁、心跳或同步权限。
        if (epoch !== this.epoch || this.state.canvasId !== canvasId) return null;
        this.setState({ ...result, canvasId, heartbeatFailures: 0 });
        if (result.mode === "edit") {
            this.stopCountdown();
            this.dependencies.setReadonly(false);
            this.attachLifecycle();
            this.startHeartbeat();
        } else if (result.pending && result.wait_seconds) {
            this.startCountdown();
        }
        return result;
    }

    async respondTakeover(): Promise<void> {
        const canvasId = this.state.canvasId;
        if (!canvasId || this.state.mode !== "edit") return;
        const epoch = ++this.epoch;
        const result = await this.dependencies.respondTakeover(canvasId, canvasSessionId());
        if (epoch !== this.epoch || this.state.canvasId !== canvasId) return;
        this.setState({ ...result, canvasId, heartbeatFailures: 0 });
    }

    async yieldLock(): Promise<void> {
        const canvasId = this.state.canvasId;
        if (!canvasId) return;
        const requester = this.state.takeover_request?.by ?? null;
        const epoch = ++this.epoch;
        this.stopTimers();
        await this.dependencies.release(canvasId, canvasSessionId()).catch(() => undefined);
        // 让出期间若已切换画布，迟到的释放结果不能把新画布重新设为只读。
        if (epoch !== this.epoch || this.state.canvasId !== canvasId) return;
        this.setState({ ...EMPTY_STATE, canvasId, holder: requester });
        this.dependencies.setReadonly(true);
    }

    private handleLockLost(result: CanvasLockState): void {
        this.stopTimers();
        this.setState({ ...result, mode: "readonly", lock_lost: true, heartbeatFailures: this.state.heartbeatFailures });
        this.dependencies.markLockLost({ holder: result.holder });
    }

    private startCountdown(): void {
        this.stopCountdown();
        this.countdownTimer = setInterval(() => {
            const wait = Math.max(0, (this.state.wait_seconds ?? 0) - 1);
            this.setState({ wait_seconds: wait });
            if (!wait) this.stopCountdown();
        }, 1000);
    }

    private stopCountdown(): void {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
    }

    private stopTimers(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.stopCountdown();
    }

    private attachLifecycle(): void {
        if (this.lifecycleAttached || typeof window === "undefined") return;
        window.addEventListener("pagehide", this.releaseOnExit);
        window.addEventListener("pageshow", this.reacquireAfterRestore);
        window.addEventListener("beforeunload", this.releaseOnExit);
        document.addEventListener("visibilitychange", this.heartbeatWhenVisible);
        this.lifecycleAttached = true;
    }

    private detachLifecycle(): void {
        if (!this.lifecycleAttached || typeof window === "undefined") return;
        window.removeEventListener("pagehide", this.releaseOnExit);
        window.removeEventListener("pageshow", this.reacquireAfterRestore);
        window.removeEventListener("beforeunload", this.releaseOnExit);
        document.removeEventListener("visibilitychange", this.heartbeatWhenVisible);
        this.lifecycleAttached = false;
    }

    private readonly heartbeatWhenVisible = () => {
        // 隐藏不释放也不暂停；恢复可见时立即确认锁，弥补后台定时器可能被浏览器节流。
        if (document.visibilityState === "visible") void this.heartbeat();
    };

    private readonly releaseOnExit = () => {
        if (this.unloading || this.state.mode !== "edit" || !this.state.canvasId) return;
        this.unloading = true;
        this.stopTimers();
        this.dependencies.releaseKeepalive(this.state.canvasId, canvasSessionId());
    };

    private readonly reacquireAfterRestore = () => {
        const canvasId = this.state.canvasId;
        if (!this.unloading || !canvasId) return;
        // BFCache 会在 pagehide 后恢复同一页面；恢复时先关写，再重新向服务端确认锁归属。
        this.dependencies.setReadonly(true);
        this.setState({ mode: "readonly", holder: null, lock_lost: false });
        void this.acquire(canvasId).catch(() => undefined);
    };

    private setState(patch: Partial<LockManagerState>): void {
        this.state = { ...this.state, ...patch };
        this.emit();
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }
}

export const lockManager = new LockManager();

export function useCanvasLockState(): LockManagerState {
    return useSyncExternalStore(
        (listener) => lockManager.subscribe(listener),
        () => lockManager.getState(),
        () => lockManager.getState(),
    );
}
