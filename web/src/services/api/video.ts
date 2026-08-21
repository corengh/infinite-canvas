// [PLATFORM] 实现体已替换为调用平台原生 API（proposal §7.2），密钥不出服务端
import { generationErrorText, getTask, type GenerationTask } from "@/platform/api/generation";
import { referenceAssetIds, rememberGeneratedOutput, requireOutputs, runPlatformGeneration, submitPlatformGeneration, takeGeneratedOutput, videoGenerationInput, type PlatformRequestOptions } from "@/platform/generation/legacy-adapter";
import type { UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = PlatformRequestOptions;

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

const submittedTasks = new Map<string, GenerationTask>();

async function input(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], signal?: AbortSignal) {
    if (videoReferences.length || audioReferences.length) throw new Error("MVP 视频生成仅支持图片首帧，不支持视频或音频参考");
    const referenceIds = await referenceAssetIds(references, signal);
    return videoGenerationInput(config, prompt, referenceIds.length ? "image2video" : "text2video", referenceIds);
}

function result(task: GenerationTask): VideoGenerationResult {
    const output = requireOutputs(task)[0];
    rememberGeneratedOutput(output);
    return { url: output.url!, mimeType: output.mime_type || "video/mp4" };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    return result(await runPlatformGeneration(await input(config, prompt, references, videoReferences, audioReferences, options?.signal), options));
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const submitted = await submitPlatformGeneration(await input(config, prompt, references, videoReferences, audioReferences, options?.signal), options);
    submittedTasks.set(submitted.id, submitted);
    // provider 字段仅为兼容基座持久化签名；平台任务不会据此选择任何供应商路径。
    return { id: submitted.id, provider: "plugin", model: submitted.model_code };
}

export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const current = await getTask(task.id, options?.signal);
    submittedTasks.set(task.id, current);
    if (current.status === "succeeded") return { status: "completed", result: result(current) };
    if (current.status === "failed" || current.status === "cancelled" || current.status === "timeout") {
        return { status: "failed", error: `${generationErrorText(current.error_kind)}，积分已退还` };
    }
    options?.onProgress?.({
        status: current.status,
        queue_position: current.queue_position,
        progress: current.progress,
        stage: current.stage,
    });
    return { status: "pending" };
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (!result.url) throw new Error("生成已完成，但没有可播放视频");
    // 生成产物已由后端写入私有对象存储，不再下载后重复上传浏览器 IndexedDB。
    const output = takeGeneratedOutput(result.url);
    return {
        url: result.url,
        storageKey: output?.asset_id || "",
        bytes: 0,
        mimeType: output?.mime_type || result.mimeType || "video/mp4",
        width: output?.width ?? undefined,
        height: output?.height ?? undefined,
        durationMs: output?.duration_ms ?? undefined,
    };
}
