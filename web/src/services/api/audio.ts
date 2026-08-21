// [PLATFORM] 实现体已替换为调用平台原生 API（proposal §7.2），密钥不出服务端
import { audioMimeType } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

/** D-17：MVP 保留导出签名供上游兼容，但没有上架 Audio 模型，生成入口必须保持关闭。 */
export async function requestAudioGeneration(_config: AiConfig, _prompt: string, _options?: RequestOptions): Promise<Blob> {
    throw new Error("当前版本暂不支持音频生成，请上传已有音频文件");
}

/** 用户上传的音频仍沿用基座本地读取路径；FE-9 会统一接管为平台资产直传。 */
export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}
