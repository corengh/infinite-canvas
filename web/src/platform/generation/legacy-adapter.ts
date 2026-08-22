import { uploadGenerationReference } from "@/platform/api/assets";
import { cancelTask, generationErrorText, submitGeneration, trackTask, type GenerationEstimateInput, type GenerationOutput, type GenerationTask, type TrackTaskProgress } from "@/platform/api/generation";
import { withCreditBadgeRefresh } from "@/platform/components/credit-badge";
import type { AiConfig, PlatformModelCapability } from "@/stores/use-config-store";
import { runConfirmedGeneration } from "./confirmed-submit";
import { resolveGenerationModelParams } from "./model-params";

export type PlatformRequestOptions = {
    signal?: AbortSignal;
    subscriptionSignal?: AbortSignal;
    canvasId?: string;
    nodeId?: string;
    onTask?: (task: GenerationTask) => void;
    onProgress?: (progress: TrackTaskProgress) => void;
    onTerminal?: (task: GenerationTask) => void;
    onConsumed?: (task: GenerationTask) => void;
};

export type PlatformReference = {
    id: string;
    name: string;
    type: string;
    dataUrl?: string;
    url?: string;
    storageKey?: string;
    assetId?: string;
};

const generatedOutputs = new Map<string, GenerationOutput>();

const IMAGE_RATIO_SIZES: Record<string, string> = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
};

const VIDEO_RATIO_SIZES: Record<string, string> = {
    "16:9": "1024x576",
    "4:3": "768x576",
    "1:1": "576x576",
    "3:4": "576x768",
    "9:16": "576x1024",
    "21:9": "1344x576",
};

export function platformModelCode(config: AiConfig, capability: PlatformModelCapability): string {
    // 兼容旧画布/测试快照：新增字段尚未写入的文档按“没有六类默认值”处理。
    const defaultModels = config.defaultModels || {};
    const family = capability === "text2image" || capability === "image2image" ? "image" : capability === "text2video" || capability === "image2video" ? "video" : capability;
    const familyModel = family === "image" ? config.imageModel : family === "video" ? config.videoModel : family === "audio" ? config.audioModel : config.textModel;
    const familyDefault = family === "image" ? defaultModels.text2image : family === "video" ? defaultModels.text2video : defaultModels[family];
    // 节点显式模型、工作台手工选择依次优先；仍在使用族默认值时才切到本次真实能力的默认模型。
    const explicitNodeModel = config.model && config.model !== familyModel ? config.model : "";
    const explicitFamilyModel = familyModel && familyModel !== familyDefault ? familyModel : "";
    const selected = explicitNodeModel || explicitFamilyModel || defaultModels[capability] || familyModel || config.model;
    return selected.includes("::") ? selected.slice(selected.lastIndexOf("::") + 2) : selected;
}

/** 保持旧 service 签名时，将现有界面配置收敛为模型目录声明的平台图片参数。 */
export async function imageGenerationInput(config: AiConfig, prompt: string, count: number, capability: "text2image" | "image2image", referenceIds: string[] = []): Promise<GenerationEstimateInput> {
    const resolved = await resolveGenerationModelParams(platformModelCode(config, capability), capability, {
        quality: config.quality === "auto" ? undefined : config.quality,
        size: IMAGE_RATIO_SIZES[config.size] ?? config.size,
        ...config.generationParams,
        prompt,
        count,
    });
    return {
        capability,
        model_code: resolved.modelCode,
        params: { ...resolved.params, ...(referenceIds.length ? { reference_asset_ids: referenceIds } : {}) },
    };
}

/** 旧界面的清晰度和比例只在平台边界转换一次，供应商 resolution/ratio 仍由后端负责。 */
export async function videoGenerationInput(config: AiConfig, prompt: string, capability: "text2video" | "image2video", referenceIds: string[] = []): Promise<GenerationEstimateInput> {
    const legacyQuality = config.vquality.replace(/p$/i, "");
    const quality = ["low", "medium", "high"].includes(config.quality) ? config.quality : legacyQuality === "480" ? "low" : legacyQuality === "1080" ? "high" : "medium";
    const resolved = await resolveGenerationModelParams(platformModelCode(config, capability), capability, {
        seconds: Math.max(1, Math.floor(Number(config.videoSeconds) || 1)),
        size: VIDEO_RATIO_SIZES[config.size] ?? config.size,
        quality,
        ...config.generationParams,
        prompt,
        count: 1,
    });
    return {
        capability,
        model_code: resolved.modelCode,
        params: { ...resolved.params, ...(referenceIds.length ? { reference_asset_ids: referenceIds } : {}) },
    };
}

export function rememberGeneratedOutput(output: GenerationOutput): void {
    if (!output.url) return;
    generatedOutputs.set(output.url, output);
    // 工作台若只预览不入画布，登记项不会被 take；限制容量避免长会话持续增长。
    if (generatedOutputs.size > 200) generatedOutputs.delete(generatedOutputs.keys().next().value!);
}

export function takeGeneratedOutput(url: string): GenerationOutput | undefined {
    const output = generatedOutputs.get(url);
    generatedOutputs.delete(url);
    return output;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function abortError(): DOMException {
    return new DOMException("Aborted", "AbortError");
}

function assertSucceeded(task: GenerationTask): GenerationTask {
    if (task.status === "succeeded") return task;
    const reason = generationErrorText(task.error_kind);
    const refunded = task.status === "failed" || task.status === "cancelled" || task.status === "timeout" ? "，积分已退还" : "";
    throw new Error(`${reason}${refunded}`);
}

async function referenceBlob(reference: PlatformReference): Promise<Blob> {
    const url = reference.dataUrl || reference.url;
    if (!url) throw new Error(`参考素材“${reference.name}”缺少可读取内容`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`无法读取参考素材“${reference.name}”`);
    return response.blob();
}

export async function referenceAssetIds(references: PlatformReference[], signal?: AbortSignal): Promise<string[]> {
    return Promise.all(
        references.map(async (reference) => {
            const known = reference.assetId || (UUID_RE.test(reference.storageKey || "") ? reference.storageKey : undefined);
            if (known) return known;
            const blob = await referenceBlob(reference);
            return (await uploadGenerationReference(blob, reference.name, signal)).id;
        }),
    );
}

/** 旧 service 的统一落点：确认、预扣刷新、提交、SSE 跟踪和取消都只实现一次。 */
export async function runPlatformGeneration(input: GenerationEstimateInput, options: PlatformRequestOptions = {}): Promise<GenerationTask> {
    const submitted = await submitPlatformGeneration(input, options);
    return waitPlatformGeneration(submitted, options);
}

export async function submitPlatformGeneration(input: GenerationEstimateInput, options: PlatformRequestOptions = {}): Promise<GenerationTask> {
    const result = await runConfirmedGeneration(input, async (estimate) => {
        const submitted = await submitGeneration(
            {
                ...input,
                estimated_credits: estimate.credits,
                canvas_id: options.canvasId,
                node_id: options.nodeId,
            },
            options.signal,
        );
        options.onTask?.(submitted);
        // 提交完成后立即刷新 held，避免余额徽标仍显示提交前的可用积分。
        return withCreditBadgeRefresh(async () => submitted);
    });
    if (!result) throw abortError();
    return result;
}

export async function waitPlatformGeneration(submitted: GenerationTask, options: PlatformRequestOptions = {}): Promise<GenerationTask> {
    return withCreditBadgeRefresh(async () => {
        let cancelSent = false;
        const cancel = () => {
            if (cancelSent) return;
            cancelSent = true;
            // 取消请求失败时继续等待服务端终态；不能制造未处理的 Promise rejection。
            void cancelTask(submitted.id).catch(() => undefined);
        };
        options.signal?.addEventListener("abort", cancel, { once: true });
        try {
            if (options.signal?.aborted) cancel();
            // 用户取消后仍监听到服务端终态，确保 UI 展示退款结果；卸载恢复订阅则由画布层单独清理。
            const terminal = await trackTask(submitted.id, options.onProgress, options.subscriptionSignal);
            options.onTerminal?.(terminal);
            return assertSucceeded(terminal);
        } finally {
            options.signal?.removeEventListener("abort", cancel);
        }
    });
}

export function requireOutputs(task: GenerationTask): GenerationOutput[] {
    const outputs = task.outputs?.filter((output) => output.url) ?? [];
    if (!outputs.length) throw new Error("生成已完成，但没有可用产物");
    return outputs;
}
