import { api } from "@/platform/http/client";

type UploadTicket = {
    ticket_id: string;
    asset_id: string;
    upload_url: string;
    upload_headers: Record<string, string>;
    expires_in: number;
};

export type AssetDTO = {
    id: string;
    kind: "image" | "video" | "audio" | "file";
    mime_type: string;
    bytes: number;
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
};

export const getAssetUrl = (assetId: string, signal?: AbortSignal) => api.get<{ url: string; expires_at: string }>(`/assets/${encodeURIComponent(assetId)}/url`, { signal });

export const batchAssetUrls = (assetIds: string[], signal?: AbortSignal): Promise<{ urls: Record<string, { url: string; expires_at: string }> }> =>
    assetIds.length ? api.post<{ urls: Record<string, { url: string; expires_at: string }> }>("/assets/urls", { asset_ids: assetIds }, { signal }) : Promise.resolve({ urls: {} });

async function sha256(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** 参考素材先直传私有对象存储，再把平台 asset_id 交给生成接口。 */
export async function uploadGenerationReference(blob: Blob, filename: string, signal?: AbortSignal): Promise<AssetDTO> {
    const checksum = await sha256(blob);
    const ticket = await api.post<UploadTicket>("/assets/upload-url", { filename, mime_type: blob.type || "application/octet-stream", bytes: blob.size, checksum }, { signal });
    // 预签名地址属于对象存储，禁止经过平台鉴权客户端，避免 Bearer token 外泄。
    const response = await fetch(ticket.upload_url, { method: "PUT", headers: ticket.upload_headers, body: blob, signal });
    if (!response.ok) throw new Error(`参考素材上传失败（HTTP ${response.status}）`);
    return api.post<AssetDTO>("/assets/confirm", { ticket_id: ticket.ticket_id, checksum }, { signal });
}
