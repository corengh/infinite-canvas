import { api } from "@/platform/http/client";
import { subscribeTask, type TaskProgress } from "@/platform/http/sse";
import type { ModelCapability } from "./models";

export type GenerationEstimateInput = {
    capability: ModelCapability;
    model_code: string;
    params: Record<string, unknown>;
};

export type GenerationEstimate = {
    credits: number;
    available: number;
    after: number;
    sufficient: boolean;
    requires_confirmation: boolean;
    pricing_version_id: string;
    breakdown: {
        base: string;
        units: string;
        quality: string;
        resolution: string;
        duration: string;
        discount: string;
    };
};

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timeout";
export type GenerationErrorKind = "invalid_params" | "content_rejected" | "quota_exceeded" | "unavailable" | "timeout" | "unknown";

export type GenerationOutput = {
    asset_id: string;
    url?: string | null;
    url_expires_at?: string | null;
    kind?: "image" | "video" | "audio" | "file" | null;
    mime_type?: string | null;
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
};

export type GenerationTask = {
    id: string;
    status: GenerationStatus;
    queue_position?: number | null;
    estimated_credits: number;
    charged_credits?: number | null;
    credits_refunded?: number | null;
    balance?: number | null;
    model_code: string;
    capability: ModelCapability;
    canvas_id?: string | null;
    node_id?: string | null;
    progress?: number | null;
    stage?: string | null;
    error_kind?: GenerationErrorKind | null;
    message?: string | null;
    outputs?: GenerationOutput[];
    created_at: string;
    timeout_at: string;
    finished_at?: string | null;
};

export type SubmitGenerationInput = GenerationEstimateInput & {
    estimated_credits: number;
    canvas_id?: string;
    node_id?: string;
    idempotency_key?: string;
};

export type GenerationTaskList = { items: GenerationTask[]; next_cursor: string | null };

export type TrackTaskProgress = {
    status: "queued" | "running";
    queue_position?: number | null;
    progress?: number | null;
    stage?: string | null;
};

const TERMINAL_STATUSES = new Set<GenerationStatus>(["succeeded", "failed", "cancelled", "timeout"]);

export const estimateGeneration = (input: GenerationEstimateInput) => api.post<GenerationEstimate>("/generation/estimate", input);

export function submitGeneration(input: SubmitGenerationInput, signal?: AbortSignal): Promise<GenerationTask> {
    const { idempotency_key = crypto.randomUUID(), ...body } = input;
    return api.post<GenerationTask>("/generation/submit", body, { headers: { "Idempotency-Key": idempotency_key }, signal });
}

export const getTask = (taskId: string, signal?: AbortSignal) => api.get<GenerationTask>(`/generation/${encodeURIComponent(taskId)}`, { signal });

const cancellationRequests = new Map<string, Promise<GenerationTask>>();

export function cancelTask(taskId: string): Promise<GenerationTask> {
    const existing = cancellationRequests.get(taskId);
    if (existing) return existing;
    const request = api.post<GenerationTask>(`/generation/${encodeURIComponent(taskId)}/cancel`).finally(() => cancellationRequests.delete(taskId));
    cancellationRequests.set(taskId, request);
    return request;
}

export function listTasks(filters: { status?: GenerationStatus; canvas_id?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GenerationTaskList> {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) query.set(key, String(value));
    });
    return api.get<GenerationTaskList>(`/generation${query.size ? `?${query}` : ""}`, { signal });
}

const ERROR_KIND_TEXT: Record<GenerationErrorKind, string> = {
    invalid_params: "参数不被模型接受，请调整后重试",
    content_rejected: "内容未通过安全审核，请修改提示词",
    quota_exceeded: "模型服务繁忙，请稍后重试",
    unavailable: "模型服务暂时不可用",
    timeout: "生成超时",
    unknown: "生成失败，请重试",
};

export function generationErrorText(kind?: GenerationErrorKind | null): string {
    return ERROR_KIND_TEXT[kind ?? "unknown"];
}

export function isTerminalTask(task: Pick<GenerationTask, "status">): boolean {
    return TERMINAL_STATUSES.has(task.status);
}

type TrackerListener = {
    progress?: (progress: TrackTaskProgress) => void;
    resolve: (task: GenerationTask) => void;
    reject: (error: unknown) => void;
    cleanup?: () => void;
};
type SharedTracker = { taskId: string; listeners: Set<TrackerListener>; unsubscribe?: () => void; active: boolean };

const MAX_TASK_STREAMS = 6;
const trackers = new Map<string, SharedTracker>();
const pendingTrackers: SharedTracker[] = [];
let activeTrackerCount = 0;

function releaseTracker(tracker: SharedTracker): void {
    tracker.unsubscribe?.();
    trackers.delete(tracker.taskId);
    const pendingIndex = pendingTrackers.indexOf(tracker);
    if (pendingIndex >= 0) pendingTrackers.splice(pendingIndex, 1);
    if (tracker.active) activeTrackerCount -= 1;
    startPendingTrackers();
}

function settleTracker(tracker: SharedTracker, task?: GenerationTask, error?: unknown): void {
    const listeners = [...tracker.listeners];
    tracker.listeners.clear();
    releaseTracker(tracker);
    listeners.forEach((listener) => {
        listener.cleanup?.();
        if (task) listener.resolve(task);
        else listener.reject(error);
    });
}

function startPendingTrackers(): void {
    while (activeTrackerCount < MAX_TASK_STREAMS && pendingTrackers.length) {
        const tracker = pendingTrackers.shift()!;
        if (!tracker.listeners.size || tracker.active) continue;
        tracker.active = true;
        activeTrackerCount += 1;
        tracker.unsubscribe = subscribeTask(tracker.taskId, {
            onProgress(progress: TaskProgress) {
                const normalized: TrackTaskProgress = {
                    status: progress.event === "queued" ? "queued" : "running",
                    queue_position: typeof progress.queue_position === "number" ? progress.queue_position : null,
                    progress: typeof progress.progress === "number" ? progress.progress : null,
                    stage: typeof progress.stage === "string" ? progress.stage : null,
                };
                tracker.listeners.forEach((listener) => listener.progress?.(normalized));
            },
            onDone(task) {
                settleTracker(tracker, task as GenerationTask);
            },
            onError(error) {
                // FE-1 会在最后一次 SSE 错误后继续轮询；网络错误不能提前判定任务失败。
                if (error.code !== "NETWORK_ERROR") settleTracker(tracker, undefined, error);
            },
        });
    }
}

/** 同一 task_id 复用订阅，并把并行 SSE/轮询连接限制为 6 条。 */
export function trackTask(taskId: string, onProgress?: (progress: TrackTaskProgress) => void, signal?: AbortSignal): Promise<GenerationTask> {
    return new Promise((resolve, reject) => {
        const tracker = trackers.get(taskId) ?? { taskId, listeners: new Set<TrackerListener>(), active: false };
        if (!trackers.has(taskId)) {
            trackers.set(taskId, tracker);
            pendingTrackers.push(tracker);
        }
        const listener: TrackerListener = { progress: onProgress, resolve, reject };
        tracker.listeners.add(listener);
        const abort = () => {
            tracker.listeners.delete(listener);
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("Aborted", "AbortError"));
            if (!tracker.listeners.size) releaseTracker(tracker);
        };
        listener.cleanup = () => signal?.removeEventListener("abort", abort);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
        startPendingTrackers();
    });
}
