// [PLATFORM] 实现体已替换为调用平台原生 API（proposal §7.2），密钥不出服务端
import { nanoid } from "nanoid";

import { modelsApi } from "@/platform/api/models";
import { imageGenerationInput, platformModelCode, referenceAssetIds, rememberGeneratedOutput, requireOutputs, runPlatformGeneration, type PlatformRequestOptions } from "@/platform/generation/legacy-adapter";
import type { AiConfig, ModelChannel } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type RequestOptions = PlatformRequestOptions;

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const count = Math.max(1, Math.min(10, Math.floor(Math.abs(Number(config.count)) || 1)));
    const task = await runPlatformGeneration(await imageGenerationInput(config, prompt, count, "text2image"), options);
    return requireOutputs(task).map((output) => {
        rememberGeneratedOutput(output);
        return { id: output.asset_id || nanoid(), dataUrl: output.url!, assetId: output.asset_id };
    });
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const count = Math.max(1, Math.min(10, Math.floor(Math.abs(Number(config.count)) || 1)));
    const ids = await referenceAssetIds(mask ? [...references, mask] : references, options?.signal);
    const task = await runPlatformGeneration(await imageGenerationInput(config, prompt, count, "image2image", ids), options);
    return requireOutputs(task).map((output) => {
        rememberGeneratedOutput(output);
        return { id: output.asset_id || nanoid(), dataUrl: output.url!, assetId: output.asset_id };
    });
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const prompt = messages
        .map((message) =>
            typeof message.content === "string"
                ? message.content
                : message.content
                      .filter((part) => part.type === "text")
                      .map((part) => (part.type === "text" ? part.text : ""))
                      .join("\n"),
        )
        .filter(Boolean)
        .join("\n\n");
    const task = await runPlatformGeneration({ capability: "text", model_code: platformModelCode(config, "text"), params: { prompt, max_tokens: 4096 } }, options);
    const output = requireOutputs(task)[0];
    const response = await fetch(output.url!);
    if (!response.ok) throw new Error(`文本结果读取失败（HTTP ${response.status}）`);
    const text = await response.text();
    onDelta(text);
    options?.onConsumed?.(task);
    return text;
}

export async function fetchImageModels(_config?: Pick<AiConfig, "apiFormat">) {
    const result = await modelsApi.list();
    return result.items.filter((model) => model.capabilities.some((capability) => capability === "text2image" || capability === "image2image")).map((model) => model.code);
}

export async function fetchChannelModels(_channel: ModelChannel) {
    return fetchImageModels({ apiFormat: "openai" });
}
