import { canvasSyncControl } from "@/platform/auth/canvas-sync-control";
import { canvasApi, type ApplyOpsResult, type CanvasRemoteOp } from "@/platform/api/canvas";
import { ApiError } from "@/platform/http/errors";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

import { applyRemoteOps } from "./apply-remote";
import { diffProject } from "./diff";
import { canvasEvents } from "./events";
import { offlineQueue, type OfflineBatch, type OfflineQueue } from "./offline-queue";
import { mergeOps, opKey, type DraftOp, type Op } from "./ops";
import { canvasSessionId, uuid7 } from "./session";

const FRAME_MS = 120;
const MAX_BACKOFF_MS = 30_000;

export type SyncMode = "ops" | "document";
export type SyncStatus = { pendingCount: number; currentPendingCount: number; otherCanvasPendingCount: number; otherCanvasIds: string[]; offline: boolean; paused: boolean; readonly: boolean; deleted: boolean };

type SyncDependencies = {
    queue: OfflineQueue;
    applyOps: typeof canvasApi.applyOps;
    pullOps: typeof canvasApi.pullOps;
    putDocument: typeof canvasApi.putDocument;
};

const defaultDependencies: SyncDependencies = {
    queue: offlineQueue,
    applyOps: canvasApi.applyOps,
    pullOps: canvasApi.pullOps,
    putDocument: canvasApi.putDocument,
};

export class SyncEngine {
    private pending = new Map<string, DraftOp>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private inflight = false;
    private canvasId: string | null = null;
    private baseVersion = 0;
    private applyingRemote = false;
    private readonly = false;
    private deleted = false;
    private paused = false;
    private retryAttempt = 0;
    private latestProject: CanvasProject | null = null;
    private mode: SyncMode = "ops";
    private status: SyncStatus = { pendingCount: 0, currentPendingCount: 0, otherCanvasPendingCount: 0, otherCanvasIds: [], offline: false, paused: false, readonly: false, deleted: false };
    private listeners = new Set<() => void>();
    private attachmentEpoch = 0;

    constructor(private readonly dependencies: SyncDependencies = defaultDependencies) {}

    attach(canvasId: string, version: number, options: { readonly?: boolean; mode?: SyncMode } = {}): void {
        if (this.canvasId && this.canvasId !== canvasId) this.parkPending();
        this.cancelTimers();
        this.attachmentEpoch += 1;
        this.canvasId = canvasId;
        this.baseVersion = version;
        this.readonly = options.readonly ?? false;
        this.deleted = false;
        this.mode = options.mode ?? "ops";
        this.retryAttempt = 0;
        void this.refreshStatus();
        if (!this.readonly) this.scheduleFlush(0);
    }

    detach(canvasId: string): void {
        if (this.canvasId !== canvasId) return;
        this.parkPending();
        this.attachmentEpoch += 1;
        this.canvasId = null;
        this.cancelTimers();
        void this.refreshStatus();
    }

    setApplyingRemote(value: boolean): void {
        this.applyingRemote = value;
    }

    isApplyingRemote(): boolean {
        return this.applyingRemote;
    }

    onProjectPatched(id: string, previous: CanvasProject | null, next: CanvasProject): void {
        if (this.applyingRemote || this.canvasId !== id) return;
        this.latestProject = next;
        diffProject(previous, next).forEach((operation) => this.fold(operation));
        // 只读态原则上由 FE-8 禁止编辑；若仍有迟到状态变更，也必须进入导出通道而不是静默丢弃。
        if (this.pending.size && !this.readonly) this.scheduleFlush();
        void this.refreshStatus();
    }

    pauseSubmissions(): void {
        this.paused = true;
        this.cancelTimers();
        void this.refreshStatus();
    }

    async resumeSubmissions(): Promise<void> {
        this.paused = false;
        this.retryAttempt = 0;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        await this.refreshStatus();
        this.scheduleFlush(0);
    }

    notifyOnline(): void {
        // online 事件不能越过 401 门闩；只有完成重登的 resumeSubmissions 才能解除 paused。
        if (this.paused || this.readonly) return;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryAttempt = 0;
        this.scheduleFlush(0);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getStatus(): SyncStatus {
        return this.status;
    }

    async exportUnsaved(): Promise<Blob> {
        // 顶部状态会汇总其他画布的遗留批次，导出也必须覆盖全部队列，不能只导出当前画布。
        const queued = await this.dependencies.queue.list();
        const pending = [...this.pending.values()];
        return new Blob([JSON.stringify({ canvas_id: this.canvasId, base_version: this.baseVersion, queued, pending }, null, 2)], { type: "application/json" });
    }

    async unsavedCount(canvasId: string): Promise<number> {
        return (await this.dependencies.queue.count(canvasId)) + (this.canvasId === canvasId ? this.pending.size : 0);
    }

    /** 页面刷新后，以服务端文档为基线重放已持久化批次和尚未入批次的乐观操作。 */
    async restoreOptimisticProject(canvasId: string, project: CanvasProject): Promise<CanvasProject> {
        const queued = await this.dependencies.queue.list(canvasId);
        const operations: CanvasRemoteOp[] = queued.flatMap((batch) => batch.ops.map((op) => ({ op_id: op.op_id, type: op.type, target_id: op.targetId, payload: op.payload })));
        if (this.canvasId === canvasId) {
            operations.push(...[...this.pending.values()].map((op) => ({ op_id: "pending", type: op.type, target_id: op.targetId, payload: op.payload })));
        }
        return operations.length ? applyRemoteOps(project, operations) : project;
    }

    async discardCanvas(canvasId: string): Promise<void> {
        if (this.canvasId === canvasId) {
            this.pending.clear();
            this.attachmentEpoch += 1;
            this.canvasId = null;
            this.cancelTimers();
        }
        await this.dependencies.queue.removeCanvas(canvasId);
        await this.refreshStatus();
    }

    async flushNow(): Promise<void> {
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = null;
        await this.flush();
    }

    private fold(next: DraftOp): void {
        const key = opKey(next);
        const previous = this.pending.get(key);
        if (!previous) this.pending.set(key, next);
        else {
            const merged = mergeOps(previous, next);
            if (merged) this.pending.set(key, merged);
            else this.pending.delete(key);
        }
    }

    private scheduleFlush(delay = FRAME_MS): void {
        if (this.paused || this.readonly || !this.canvasId || this.flushTimer || this.retryTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, delay);
    }

    private async flush(): Promise<void> {
        if (this.inflight || this.paused || this.readonly || !this.canvasId) return;
        const canvasId = this.canvasId;
        const epoch = this.attachmentEpoch;
        const baseVersion = this.baseVersion;
        this.inflight = true;
        let batch: OfflineBatch | null = null;
        let persisted = false;
        try {
            const queued = await this.dependencies.queue.list(canvasId);
            batch = queued[0] ?? this.takePendingBatch();
            persisted = Boolean(queued[0]);
            if (!batch) return;
            if (!persisted) await this.dependencies.queue.push(batch);
            const result = await this.submit(batch, baseVersion);
            if (result.conflict) {
                await this.resolveConflict(result, batch, canvasId, epoch);
                return;
            }
            await this.dependencies.queue.ack(batch.id);
            if (this.attachmentEpoch === epoch) {
                this.baseVersion = result.server_version;
                this.retryAttempt = 0;
            }
        } catch (error) {
            if (batch && !persisted) await this.dependencies.queue.push(batch);
            if (error instanceof ApiError && error.status === 401) this.pauseSubmissions();
            else if (error instanceof ApiError && error.code === "CANVAS_LOCK_NOT_HELD" && this.attachmentEpoch === epoch) this.loseLock(error.details);
            else if (error instanceof ApiError && (error.code === "CANVAS_NOT_FOUND" || error.status === 404) && this.attachmentEpoch === epoch) this.loseCanvas(error.details);
            else this.scheduleRetry();
        } finally {
            this.inflight = false;
            await this.refreshStatus();
            if (!this.paused && !this.readonly) {
                const remaining = (await this.dependencies.queue.count(this.canvasId)) > 0 || this.pending.size > 0;
                if (remaining && !this.retryTimer) this.scheduleFlush(0);
            }
        }
    }

    private takePendingBatch(): OfflineBatch | null {
        if (!this.canvasId || !this.pending.size) return null;
        const drafts = [...this.pending.values()].slice(0, 500);
        drafts.forEach((draft) => this.pending.delete(opKey(draft)));
        const ops: Op[] = drafts.map((draft) => ({ ...draft, op_id: uuid7() }));
        return { id: uuid7(), canvasId: this.canvasId, ops, createdAt: new Date().toISOString() };
    }

    private submit(batch: OfflineBatch, baseVersion: number): Promise<ApplyOpsResult> {
        if (this.mode === "document" && this.latestProject && batch.canvasId === this.canvasId) {
            const project = this.latestProject;
            return this.dependencies.putDocument(batch.canvasId, {
                session_id: canvasSessionId(),
                base_version: baseVersion,
                canvas: { title: project.title, background_mode: project.backgroundMode, show_image_info: project.showImageInfo, viewport: project.viewport },
                nodes: project.nodes,
                connections: project.connections,
            });
        }
        return this.dependencies.applyOps(batch.canvasId, canvasSessionId(), baseVersion, batch.ops);
    }

    private async resolveConflict(result: Extract<ApplyOpsResult, { conflict: true }>, batch: OfflineBatch, canvasId: string, epoch: number): Promise<void> {
        if (this.attachmentEpoch === epoch && this.readonly) {
            this.loseLock();
            return;
        }
        const operations: CanvasRemoteOp[] = [...result.missed_ops];
        let hasMore = result.has_more;
        let since = result.next_since;
        while (hasMore && since !== null) {
            const page = await this.dependencies.pullOps(canvasId, since);
            operations.push(...page.ops);
            hasMore = page.has_more;
            since = page.next_since;
        }
        this.applyingRemote = true;
        try {
            const project = useCanvasStore.getState().openProject(canvasId);
            if (project) {
                const remote = applyRemoteOps(project, operations);
                // 远端补偿后重新覆盖本批本地乐观修改；批次仍在离线队列中，随后会按新版本重试。
                const local = applyRemoteOps(
                    remote,
                    batch.ops.map((op) => ({ op_id: op.op_id, type: op.type, target_id: op.targetId, payload: op.payload })),
                );
                useCanvasStore.getState().replaceProject(local);
                // 画布页面持有自己的渲染状态，必须同步灌入，不能只更新 Zustand 缓存。
                canvasEvents.emit("remote-project-applied", { canvas_id: canvasId, project: local });
            }
        } finally {
            this.applyingRemote = false;
        }
        if (this.attachmentEpoch === epoch) this.baseVersion = result.server_version;
    }

    private parkPending(): void {
        const batches: OfflineBatch[] = [];
        while (this.pending.size) {
            const batch = this.takePendingBatch();
            if (!batch) break;
            batches.push(batch);
        }
        if (batches.length)
            void (async () => {
                for (const batch of batches) await this.dependencies.queue.push(batch);
                await this.refreshStatus();
            })();
    }

    private loseLock(details?: Record<string, unknown>): void {
        this.readonly = true;
        this.cancelTimers();
        canvasEvents.emit("lock-lost", { ...details, pending_count: this.status.pendingCount });
    }

    private loseCanvas(details?: Record<string, unknown>): void {
        this.readonly = true;
        this.deleted = true;
        this.cancelTimers();
        // 画布已经不存在时停止无意义重试，但保留队列供用户导出。
        canvasEvents.emit("canvas-deleted", { ...details, pending_count: this.status.pendingCount });
    }

    private scheduleRetry(): void {
        if (this.retryTimer || this.paused || this.readonly) return;
        const delay = Math.min(1000 * 2 ** this.retryAttempt, MAX_BACKOFF_MS);
        this.retryAttempt += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.flush();
        }, delay);
    }

    private cancelTimers(): void {
        if (this.flushTimer) clearTimeout(this.flushTimer);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.flushTimer = null;
        this.retryTimer = null;
    }

    private async refreshStatus(): Promise<void> {
        const queued = await this.dependencies.queue.list();
        const totalQueued = queued.reduce((total, batch) => total + batch.ops.length, 0);
        const currentQueued = queued.filter((batch) => batch.canvasId === this.canvasId).reduce((total, batch) => total + batch.ops.length, 0);
        const otherCanvasPendingCount = Math.max(0, totalQueued - currentQueued);
        const otherCanvasIds = [...new Set(queued.filter((batch) => batch.canvasId !== this.canvasId).map((batch) => batch.canvasId))];
        const currentPendingCount = currentQueued + this.pending.size;
        const next = {
            pendingCount: otherCanvasPendingCount + currentPendingCount,
            currentPendingCount,
            otherCanvasPendingCount,
            otherCanvasIds,
            offline: totalQueued > 0,
            paused: this.paused,
            readonly: this.readonly,
            deleted: this.deleted,
        };
        if (JSON.stringify(next) === JSON.stringify(this.status)) return;
        this.status = next;
        this.listeners.forEach((listener) => listener());
    }
}

export const canvasSync = new SyncEngine();
canvasSyncControl.register(canvasSync);

if (typeof window !== "undefined") {
    window.addEventListener("online", () => canvasSync.notifyOnline());
}
