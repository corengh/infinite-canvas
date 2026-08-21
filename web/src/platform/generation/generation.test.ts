import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { estimateGeneration, type GenerationEstimate, type GenerationEstimateInput } from "@/platform/api/generation";
import { modelsApi, type ModelDTO } from "@/platform/api/models";
import { authStore, type AuthResult } from "@/platform/auth/store";
import { creditRequestTaskContext, insufficientAction } from "@/platform/components/insufficient-hint";
import { ApiError } from "@/platform/http/errors";
import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import { capabilityForCanvas } from "./canvas-controls";
import { confirmationAllowed, shouldShowConfirmation } from "./confirm-dialog";
import { runConfirmedGeneration } from "./confirmed-submit";
import { EstimateScheduler, type EstimateState } from "./estimate";
import { historicalUnavailableModel, paramsForModel, schemaFields, shouldRenderGenerationEntry } from "./model-selector";

const input: GenerationEstimateInput = { capability: "text2image", model_code: "image-model", params: { quality: "low" } };

function estimate(credits: number, overrides: Partial<GenerationEstimate> = {}): GenerationEstimate {
    return {
        credits,
        available: 1_000,
        after: 1_000 - credits,
        sufficient: true,
        requires_confirmation: false,
        pricing_version_id: "price-1",
        breakdown: { base: "12", units: "1", quality: "1", resolution: "1", duration: "1", discount: "1" },
        ...overrides,
    };
}

function model(overrides: Partial<ModelDTO> = {}): ModelDTO {
    return {
        code: "image-model",
        name: "Image Model",
        description: null,
        capabilities: ["text2image"],
        pricing: { mode: "per_call", display: "约 12~480 积分/张", base_price: "12" },
        params_schema: { type: "object", properties: { quality: { enum: ["low", "high"] } } },
        defaults: { quality: "low" },
        priority: 100,
        enabled: true,
        is_default: true,
        default_for: ["text2image"],
        ...overrides,
    };
}

describe("FE-5 模型选择与预估确认", () => {
    beforeEach(() => authStore.getState().authenticate(authResultFixture as AuthResult));

    it("模型目录按能力请求，并保留后端单价展示串", async () => {
        server.use(
            http.get("http://localhost/api/models", ({ request }) => {
                expect(new URL(request.url).searchParams.get("capability")).toBe("text2video");
                return HttpResponse.json({ data: { items: [model({ capabilities: ["text2video"], pricing: { mode: "per_second", display: "约 50~200 积分/秒", base_price: "50" } })] } });
            }),
        );
        const result = await modelsApi.list("text2video");
        expect(result.items[0].pricing?.display).toContain("积分/秒");
    });

    it("防抖 300ms，且旧请求最后返回也会被 seq 丢弃", async () => {
        vi.useFakeTimers();
        const pending = new Map<string, (value: GenerationEstimate) => void>();
        const states: EstimateState[] = [];
        const scheduler = new EstimateScheduler(
            (request) => new Promise((resolve) => pending.set(String(request.params.quality), resolve)),
            (state) => states.push(state),
            300,
        );

        scheduler.update({ ...input, params: { quality: "low" } });
        await vi.advanceTimersByTimeAsync(299);
        expect(pending.size).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        scheduler.update({ ...input, params: { quality: "high" } });
        await vi.advanceTimersByTimeAsync(300);
        pending.get("high")?.(estimate(480));
        await Promise.resolve();
        pending.get("low")?.(estimate(12));
        await Promise.resolve();

        expect(states.at(-1)?.data?.credits).toBe(480);
        vi.useRealTimers();
    });

    it("40 倍质量价差随参数变化重新估价", async () => {
        server.use(
            http.post("http://localhost/api/generation/estimate", async ({ request }) => {
                const body = (await request.json()) as GenerationEstimateInput;
                const credits = body.params.quality === "high" ? 480 : 12;
                return HttpResponse.json({ data: estimate(credits) });
            }),
        );
        await expect(estimateGeneration({ ...input, params: { quality: "low" } })).resolves.toMatchObject({ credits: 12 });
        await expect(estimateGeneration({ ...input, params: { quality: "high" } })).resolves.toMatchObject({ credits: 480 });
    });

    it("JSON Schema 新增标量字段即可自动进入表单并合并默认值", () => {
        const changed = model({
            params_schema: { type: "object", required: ["camera_fixed"], properties: { quality: { enum: ["low", "high"] }, camera_fixed: { type: "boolean", title: "固定镜头" } } },
            defaults: { quality: "low", camera_fixed: false },
        });
        expect(schemaFields(changed.params_schema).map((field) => field.name)).toEqual(["quality", "camera_fixed"]);
        expect(paramsForModel(changed, { quality: "high" })).toEqual({ quality: "high", camera_fixed: false });
    });

    it("能力不匹配的上架模型不会被误报为历史下架模型", () => {
        expect(historicalUnavailableModel(model({ enabled: true }))).toBeUndefined();
        expect(historicalUnavailableModel(model({ enabled: false }))?.code).toBe("image-model");
    });

    it("纯提示词视频和带首帧视频使用不同能力，Audio 无模型时关闭入口", () => {
        expect(capabilityForCanvas("video", false)).toBe("text2video");
        expect(capabilityForCanvas("video", true)).toBe("image2video");
        expect(shouldRenderGenerationEntry("audio", 0)).toBe(false);
    });

    it("余额不足禁止确认，并按账号类型显示补拨或充值入口", () => {
        const insufficient = estimate(200, { available: 100, after: -100, sufficient: false });
        expect(confirmationAllowed(insufficient, true)).toBe(false);
        expect(insufficientAction("owner")).toBe("recharge");
        expect(insufficientAction("sub")).toBe("request");
    });

    it("补拨申请只保存模型与预估摘要，不携带完整提示词", () => {
        const context = creditRequestTaskContext(input, 200);
        expect(context).toEqual({ model_code: "image-model", capability: "text2image", estimated: 200 });
        expect(context).not.toHaveProperty("params");
        expect(context).not.toHaveProperty("prompt");
    });

    it("高消耗必须勾选，且会话静默不能绕过", () => {
        const high = estimate(800, { requires_confirmation: true });
        expect(shouldShowConfirmation(high, false, true)).toBe(true);
        expect(confirmationAllowed(high, false)).toBe(false);
        expect(confirmationAllowed(high, true)).toBe(true);
    });

    it("ESTIMATE_STALE 后强制重新估价并再次确认", async () => {
        const confirmations: boolean[] = [];
        const confirmer = vi.fn(async (_input: GenerationEstimateInput, options?: { force?: boolean }) => {
            confirmations.push(Boolean(options?.force));
            return estimate(options?.force ? 120 : 100);
        });
        let submissions = 0;
        const result = await runConfirmedGeneration(
            input,
            async (current) => {
                submissions += 1;
                if (submissions === 1) throw new ApiError("ESTIMATE_STALE", 409, "预估已变化", { server_credits: 120 });
                return current.credits;
            },
            confirmer,
        );
        expect(result).toBe(120);
        expect(confirmations).toEqual([false, true]);
    });
});
