import { runtime } from "@/platform/runtime";

import { api, fetchWithAuth } from "./client";
import { ApiError, normalizeError } from "./errors";

const RECONNECT_DELAYS_MS = [1000, 2000, 4000] as const;
const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "canceled", "timeout"]);

export type TaskDTO = Record<string, unknown> & { status?: string };
export type TaskProgress = Record<string, unknown> & { event: "queued" | "progress" };

export type TaskSubscriptionHandlers = {
    onProgress: (progress: TaskProgress) => void;
    onDone: (task: TaskDTO) => void;
    onError: (error: ApiError) => void;
};

type SubscriptionTimings = {
    reconnectDelaysMs?: readonly number[];
    pollIntervalMs?: number;
};

type SseEvent = { id?: string; event?: string; data: string };

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        signal.addEventListener("abort", finish, { once: true });
    });
}

function parseBlock(block: string): SseEvent | null {
    const event: SseEvent = { data: "" };
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const separator = line.indexOf(":");
        const field = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        else if (field === "id") event.id = value;
        else if (field === "event") event.event = value;
    }
    if (!data.length) return null;
    event.data = data.join("\n");
    return event;
}

export async function consumeSseStream(response: Response, onEvent: (event: SseEvent) => boolean, signal: AbortSignal): Promise<boolean> {
    if (!response.body) throw new ApiError("NETWORK_ERROR", 0, "SSE 响应缺少数据流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamEnded = false;
    try {
        while (!signal.aborted) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
                const event = parseBlock(block);
                if (event && onEvent(event)) return true;
            }
            if (done) {
                streamEnded = true;
                return false;
            }
        }
        return true;
    } finally {
        // done 事件、解析异常和组件卸载都必须主动关闭未结束的响应流。
        if (!streamEnded) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

function parseEventData(event: SseEvent): Record<string, unknown> {
    const data = JSON.parse(event.data) as unknown;
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new TypeError("SSE data 必须是对象");
    return data as Record<string, unknown>;
}

export function subscribeTask(taskId: string, handlers: TaskSubscriptionHandlers, timings: SubscriptionTimings = {}): () => void {
    const controller = new AbortController();
    const path = `/generation/${encodeURIComponent(taskId)}`;
    const reconnectDelays = timings.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    const pollInterval = timings.pollIntervalMs ?? POLL_INTERVAL_MS;

    const poll = async () => {
        while (!controller.signal.aborted) {
            await wait(pollInterval, controller.signal);
            if (controller.signal.aborted) return;
            try {
                const task = await api.get<TaskDTO>(path, { signal: controller.signal });
                if (task.status && TERMINAL_STATUSES.has(task.status)) {
                    handlers.onDone(task);
                    return;
                }
                handlers.onProgress({ ...task, event: "progress" });
            } catch (error) {
                if (!controller.signal.aborted) handlers.onError(normalizeError(error));
            }
        }
    };

    const connect = async () => {
        if (!runtime.sseEnabled) return poll();
        let lastEventId: string | undefined;
        for (let failureCount = 0; failureCount < reconnectDelays.length && !controller.signal.aborted; failureCount += 1) {
            try {
                const headers = new Headers({ Accept: "text/event-stream" });
                if (lastEventId) headers.set("Last-Event-ID", lastEventId);
                const response = await fetchWithAuth(`${path}/stream`, { method: "GET", headers, signal: controller.signal });
                const completed = await consumeSseStream(
                    response,
                    (event) => {
                        if (event.id) lastEventId = event.id;
                        const payload = parseEventData(event);
                        if (event.event === "done") {
                            handlers.onDone(payload);
                            return true;
                        }
                        if (event.event === "queued" || event.event === "progress") handlers.onProgress({ ...payload, event: event.event });
                        return false;
                    },
                    controller.signal,
                );
                if (completed || controller.signal.aborted) return;
            } catch (error) {
                if (controller.signal.aborted) return;
                if (failureCount === reconnectDelays.length - 1) handlers.onError(normalizeError(error));
            }
            // 第三次失败也执行 4 秒退避，然后才切换轮询，避免瞬时故障造成集中请求。
            await wait(reconnectDelays[failureCount], controller.signal);
        }
        if (!controller.signal.aborted) await poll();
    };

    void connect();
    return () => controller.abort();
}
