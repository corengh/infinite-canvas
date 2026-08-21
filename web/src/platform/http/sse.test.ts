import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { authStore } from "@/platform/auth/store";

import { subscribeTask } from "./sse";
import { completedTaskFixture } from "./test/fixtures";
import { server } from "./test/server";

function sseResponse(events: string) {
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(events));
            controller.close();
        },
    });
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
}

function openSseResponse(event: string) {
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(event));
        },
    });
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
}

describe("生成任务 SSE 订阅", () => {
    it("忽略心跳，并携带 Last-Event-ID 断线续传", async () => {
        authStore.getState().setTokens("access-token", 900);
        let streamCount = 0;
        server.use(
            http.get("http://localhost/api/generation/task-1/stream", ({ request }) => {
                streamCount += 1;
                if (streamCount === 1) {
                    expect(request.headers.get("Last-Event-ID")).toBeNull();
                    return sseResponse(': keep-alive\n\nid: 1\nevent: progress\ndata: {"progress":0.35,"stage":"generating"}\n\n');
                }
                expect(request.headers.get("Last-Event-ID")).toBe("1");
                return sseResponse(`id: 2\nevent: done\ndata: ${JSON.stringify(completedTaskFixture)}\n\n`);
            }),
        );
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        const unsubscribe = subscribeTask("task-1", { onProgress, onDone, onError }, { reconnectDelaysMs: [1, 1, 1], pollIntervalMs: 1 });
        await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());

        expect(onProgress).toHaveBeenCalledWith({ event: "progress", progress: 0.35, stage: "generating" });
        expect(onError).not.toHaveBeenCalled();
        unsubscribe();
    });

    it("连续三次连接失败后降级为三秒轮询语义", async () => {
        authStore.getState().setTokens("access-token", 900);
        let streamCount = 0;
        let pollCount = 0;
        server.use(
            http.get("http://localhost/api/generation/task-2/stream", () => {
                streamCount += 1;
                return HttpResponse.error();
            }),
            http.get("http://localhost/api/generation/task-2", () => {
                pollCount += 1;
                return HttpResponse.json({ data: completedTaskFixture });
            }),
        );
        const onDone = vi.fn();
        const onError = vi.fn();

        const unsubscribe = subscribeTask("task-2", { onProgress: vi.fn(), onDone, onError }, { reconnectDelaysMs: [1, 2, 4], pollIntervalMs: 3 });
        await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());

        expect(streamCount).toBe(3);
        expect(pollCount).toBe(1);
        expect(onError).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it("轮询读到 timeout 时按终态结束订阅", async () => {
        authStore.getState().setTokens("access-token", 900);
        server.use(
            http.get("http://localhost/api/generation/task-timeout/stream", () => HttpResponse.error()),
            http.get("http://localhost/api/generation/task-timeout", () => HttpResponse.json({ data: { ...completedTaskFixture, status: "timeout" } })),
        );
        const onDone = vi.fn();
        const unsubscribe = subscribeTask("task-timeout", { onProgress: vi.fn(), onDone, onError: vi.fn() }, { reconnectDelaysMs: [1, 1, 1], pollIntervalMs: 1 });
        await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "timeout" })));
        unsubscribe();
    });

    it("取消订阅会 abort，且不再触发 handler", async () => {
        authStore.getState().setTokens("access-token", 900);
        server.use(http.get("http://localhost/api/generation/task-3/stream", () => openSseResponse('id: 1\nevent: progress\ndata: {"progress":0.1}\n\n')));
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const unsubscribe = subscribeTask("task-3", { onProgress, onDone, onError: vi.fn() }, { reconnectDelaysMs: [20, 20, 20], pollIntervalMs: 20 });

        await vi.waitFor(() => expect(onProgress).toHaveBeenCalledOnce());
        unsubscribe();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(onDone).not.toHaveBeenCalled();
        expect(onProgress).toHaveBeenCalledOnce();
    });
});
