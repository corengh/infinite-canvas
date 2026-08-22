import { api } from "@/platform/http/client";

export type AssetKind = "image" | "video" | "audio" | "file";
export type AssetVisibility = "private" | "team";
export type AssetDTO = {
    id: string;
    kind: AssetKind;
    filename: string | null;
    mime_type: string;
    bytes: number;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    visibility: AssetVisibility;
    owner: { id: string };
    source: "uploaded" | "generated";
    task_id: string | null;
    status: "pending" | "ready" | "failed";
    url?: string;
    url_expires_at?: string;
    created_at: string;
};
export type AssetListParams = { kind?: AssetKind; visibility?: AssetVisibility; owner?: string; cursor?: string; limit?: number };
type UploadTicket = { ticket_id: string; asset_id: string; upload_url: string; upload_headers: Record<string, string>; expires_in: number };
export type UploadProgress = { loaded: number; total: number; percent: number };

function queryString(params: AssetListParams): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
    return query.size ? `?${query}` : "";
}

export const assetsApi = {
    list: (params: AssetListParams = {}, signal?: AbortSignal) => api.get<{ items: AssetDTO[]; next_cursor: string | null }>(`/assets${queryString(params)}`, { signal }),
    urls: (assetIds: string[], signal?: AbortSignal): Promise<{ urls: Record<string, { url: string; expires_at: string }> }> =>
        assetIds.length ? api.post<{ urls: Record<string, { url: string; expires_at: string }> }>("/assets/urls", { asset_ids: assetIds }, { signal }) : Promise.resolve({ urls: {} }),
    setVisibility: (assetId: string, visibility: AssetVisibility) => api.patch<AssetDTO>(`/assets/${encodeURIComponent(assetId)}`, { visibility }),
    reference: (assetId: string, input: { canvas_id?: string | null; node_id: string }) => api.post<void>(`/assets/${encodeURIComponent(assetId)}/reference`, input),
    remove: (assetId: string) => api.delete<void>(`/assets/${encodeURIComponent(assetId)}`),
};

export const getAssetUrl = (assetId: string, signal?: AbortSignal) => api.get<{ url: string; expires_at: string }>(`/assets/${encodeURIComponent(assetId)}/url`, { signal });
export const batchAssetUrls = (assetIds: string[], signal?: AbortSignal) => assetsApi.urls(assetIds, signal);

async function sha256(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function directPut(ticket: UploadTicket, blob: Blob, onProgress?: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("PUT", ticket.upload_url);
        for (const [name, value] of Object.entries(ticket.upload_headers)) request.setRequestHeader(name, value);
        request.upload.onprogress = (event) => {
            const total = event.lengthComputable ? event.total : blob.size;
            onProgress?.({ loaded: event.loaded, total, percent: total ? Math.round((event.loaded / total) * 100) : 0 });
        };
        request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`对象存储上传失败（HTTP ${request.status}）`)));
        request.onerror = () => reject(new Error("对象存储上传网络异常"));
        request.onabort = () => reject(new DOMException("上传已取消", "AbortError"));
        signal?.addEventListener("abort", () => request.abort(), { once: true });
        request.send(blob);
    });
}

/** 大文件只经过对象存储；平台 API 只签发凭据和确认元数据。 */
export async function uploadAsset(blob: Blob, filename: string, options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {}): Promise<AssetDTO> {
    const checksum = await sha256(blob);
    const ticket = await api.post<UploadTicket>("/assets/upload-url", { filename, mime_type: blob.type || "application/octet-stream", bytes: blob.size, checksum }, { signal: options.signal });
    // 预签名地址属于对象存储，绝不能经过带平台 Bearer token 的 HTTP 客户端。
    await directPut(ticket, blob, options.onProgress, options.signal);
    options.onProgress?.({ loaded: blob.size, total: blob.size, percent: 100 });
    return api.post<AssetDTO>("/assets/confirm", { ticket_id: ticket.ticket_id, checksum }, { signal: options.signal });
}

export const uploadGenerationReference = (blob: Blob, filename: string, signal?: AbortSignal) => uploadAsset(blob, filename, { signal });
