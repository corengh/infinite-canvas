import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { cancelTask, generationErrorText, listTasks, submitGeneration, trackTask, type GenerationTask } from "@/platform/api/generation";
import { authStore, type AuthResult } from "@/platform/auth/store";
import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { applyCanvasTaskTerminal, finishCanvasTaskTracking } from "./canvas-task";
import { imageGenerationInput, videoGenerationInput } from "./legacy-adapter";

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
    return {
        id: "01990d52-3f44-7000-8000-000000000001",
        status: "queued",
        queue_position: 2,
        estimated_credits: 110,
        model_code: "image-model",
        capability: "text2image",
        outputs: [],
        created_at: "2026-08-21T00:00:00Z",
        timeout_at: "2026-08-21T00:05:00Z",
        ...overrides,
    };
}

describe("FE-6 平台生成链路", () => {
    beforeEach(() => authStore.getState().authenticate(authResultFixture as AuthResult));

    it("提交携带幂等键，列表保留画布过滤条件", async () => {
        server.use(
            http.post("http://localhost/api/generation/submit", async ({ request }) => {
                expect(request.headers.get("Idempotency-Key")).toBe("idem-1");
                expect(await request.json()).toMatchObject({ estimated_credits: 110, canvas_id: "01990d52-3f44-7000-8000-000000000002" });
                return HttpResponse.json({ data: task() });
            }),
            http.get("http://localhost/api/generation", ({ request }) => {
                expect(new URL(request.url).searchParams.get("status")).toBe("running");
                return HttpResponse.json({ data: { items: [task({ status: "running" })], next_cursor: null } });
            }),
        );
        await submitGeneration({ capability: "text2image", model_code: "image-model", params: { prompt: "scene" }, estimated_credits: 110, canvas_id: "01990d52-3f44-7000-8000-000000000002", idempotency_key: "idem-1" });
        await expect(listTasks({ status: "running" })).resolves.toMatchObject({ items: [{ status: "running" }] });
    });

    it("相同任务复用一条 SSE，并向所有监听者推送真实进度", async () => {
        let streams = 0;
        server.use(
            http.get("http://localhost/api/generation/:id/stream", () => {
                streams += 1;
                return new HttpResponse(
                    ['id: 1\nevent: queued\ndata: {"queue_position":2}\n\n', 'id: 2\nevent: progress\ndata: {"progress":0.35,"stage":"generating"}\n\n', `id: 3\nevent: done\ndata: ${JSON.stringify(task({ status: "succeeded", progress: 1 }))}\n\n`].join(
                        "",
                    ),
                    { headers: { "Content-Type": "text/event-stream" } },
                );
            }),
        );
        const firstProgress: number[] = [];
        const secondProgress: number[] = [];
        const [first, second] = await Promise.all([trackTask(task().id, (progress) => firstProgress.push(progress.progress ?? 0)), trackTask(task().id, (progress) => secondProgress.push(progress.progress ?? 0))]);
        expect(streams).toBe(1);
        expect(first.status).toBe("succeeded");
        expect(second.status).toBe("succeeded");
        expect(firstProgress).toContain(0.35);
        expect(secondProgress).toContain(0.35);
    });

    it("重复点击取消只发出一次请求", async () => {
        let requests = 0;
        server.use(
            http.post("http://localhost/api/generation/:id/cancel", async () => {
                requests += 1;
                await new Promise((resolve) => setTimeout(resolve, 10));
                return HttpResponse.json({ data: task({ status: "cancelled", credits_refunded: 110 }) });
            }),
        );
        const first = cancelTask(task().id);
        const second = cancelTask(task().id);
        expect(first).toBe(second);
        await Promise.all([first, second]);
        expect(requests).toBe(1);
    });

    it("失败与取消显式展示退款，多版本结果合并进 images", () => {
        const node: CanvasNodeData = { id: "node-1", type: CanvasNodeType.Image, title: "图", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { status: "loading", images: [] } };
        const succeeded = applyCanvasTaskTerminal(
            node,
            task({
                status: "succeeded",
                outputs: [
                    { asset_id: "asset-1", url: "https://assets.example/1.png", width: 1024, height: 1024 },
                    { asset_id: "asset-2", url: "https://assets.example/2.png", width: 1024, height: 1024 },
                ],
            }),
        );
        expect(succeeded.metadata?.images).toHaveLength(2);
        const failed = applyCanvasTaskTerminal(node, task({ status: "failed", error_kind: "content_rejected", credits_refunded: 110 }));
        expect(failed.metadata?.errorDetails).toContain("积分已退还");
        expect(failed.metadata?.creditsRefunded).toBe(110);
        expect(generationErrorText("content_rejected")).toContain("安全审核");
    });

    it("图片和视频旧界面值转换为模型目录声明的平台参数", async () => {
        server.use(
            http.get("http://localhost/api/models", ({ request }) => {
                const capability = new URL(request.url).searchParams.get("capability");
                if (capability === "text2image") {
                    return HttpResponse.json({
                        data: {
                            items: [
                                {
                                    code: "gpt-image-2",
                                    name: "GPT Image 2",
                                    capabilities: ["text2image", "image2image"],
                                    params_schema: {
                                        type: "object",
                                        properties: { prompt: { type: "string" }, quality: { enum: ["low", "medium", "high"] }, size: { enum: ["1024x1024", "1024x1536"] }, count: { type: "integer", minimum: 1, maximum: 10 } },
                                    },
                                    defaults: { quality: "medium", size: "1024x1024", count: 1 },
                                    priority: 100,
                                    default_for: ["text2image"],
                                },
                            ],
                        },
                    });
                }
                return HttpResponse.json({
                    data: {
                        items: [
                            {
                                code: "seeddance",
                                name: "Seedance",
                                capabilities: ["text2video", "image2video"],
                                params_schema: {
                                    type: "object",
                                    properties: {
                                        prompt: { type: "string" },
                                        quality: { enum: ["low", "medium", "high"] },
                                        size: { enum: ["1024x576", "576x576"] },
                                        seconds: { type: "integer", minimum: 4, maximum: 15 },
                                        count: { type: "integer", const: 1 },
                                    },
                                },
                                defaults: { quality: "medium", size: "1024x576", seconds: 5, count: 1 },
                                priority: 100,
                                default_for: ["text2video"],
                            },
                        ],
                    },
                });
            }),
        );
        const imageConfig = { model: "gpt-image-2", imageModel: "gpt-image-2", quality: "auto", size: "1:1" } as AiConfig;
        const videoConfig = { model: "seeddance", videoModel: "seeddance", quality: "auto", vquality: "720", size: "16:9", videoSeconds: "6" } as AiConfig;
        const image = await imageGenerationInput(imageConfig, "场景", 1, "text2image");
        const video = await videoGenerationInput(videoConfig, "镜头", "text2video");
        expect(image.params).toMatchObject({ prompt: "场景", quality: "medium", size: "1024x1024", count: 1 });
        expect(video.params).toMatchObject({ prompt: "镜头", quality: "medium", size: "1024x576", seconds: 6, count: 1 });
    });

    it("批量恢复只更新当前任务槽，并在终态后移除活动任务 ID", () => {
        const node: CanvasNodeData = {
            id: "node-1",
            type: CanvasNodeType.Image,
            title: "批量图",
            position: { x: 0, y: 0 },
            width: 320,
            height: 320,
            metadata: {
                status: "loading",
                taskId: "task-2",
                taskIds: ["task-1", "task-2"],
                generationTaskSlots: { "task-1": "slot-1", "task-2": "slot-2" },
                images: [
                    { id: "slot-1", status: "loading", content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" },
                    { id: "slot-2", status: "loading", content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" },
                ],
            },
        };
        const terminal = task({ id: "task-1", status: "succeeded", outputs: [{ asset_id: "asset-1", url: "https://assets.example/1.png" }] });
        const recovered = finishCanvasTaskTracking(applyCanvasTaskTerminal(node, terminal, "slot-1"), terminal);
        expect(recovered.metadata?.images).toMatchObject([
            { id: "slot-1", status: "success" },
            { id: "slot-2", status: "loading" },
        ]);
        expect(recovered.metadata?.status).toBe("loading");
        expect(recovered.metadata?.taskIds).toEqual(["task-2"]);
        expect(recovered.metadata?.generationTaskSlots).toEqual({ "task-2": "slot-2" });
    });
});
