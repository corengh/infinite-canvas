import { create } from "zustand";

import { assetsApi, getAssetUrl, uploadAsset, type AssetDTO, type AssetListParams, type AssetVisibility } from "@/platform/api/assets";
import { promptsApi } from "@/platform/api/prompts";

export type AssetKind = "text" | "image" | "video" | "audio" | "file";
type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
    visibility: AssetVisibility;
    ownerId: string;
    urlExpiresAt?: string;
};
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number } };
export type FileAsset = AssetBase<"file"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset | FileAsset;
type Draft<T extends Asset> = Omit<T, "id" | "createdAt" | "updatedAt" | "visibility" | "ownerId"> & { visibility?: AssetVisibility; ownerId?: string };
export type AssetDraft = Draft<TextAsset> | Draft<ImageAsset> | Draft<VideoAsset> | Draft<AudioAsset> | Draft<FileAsset>;

type AssetStore = {
    hydrated: boolean;
    loading: boolean;
    assets: Asset[];
    nextCursor: string | null;
    filters: AssetListParams;
    loadAssets: (filters?: AssetListParams, append?: boolean) => Promise<void>;
    addAsset: (asset: AssetDraft) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => void;
    refreshExpiringUrls: () => Promise<void>;
    reloadAssetUrl: (id: string) => Promise<string | undefined>;
    cleanupImages: (_extra?: unknown) => void;
};

const REFRESH_WINDOW_MS = 3 * 60 * 1000;
const renewedAfterError = new Set<string>();

export function assetFromDto(dto: AssetDTO): Asset {
    const common = {
        id: dto.id,
        title: dto.filename || "未命名资产",
        coverUrl: dto.kind === "image" ? dto.url || "" : "",
        tags: [],
        source: dto.source,
        createdAt: dto.created_at,
        updatedAt: dto.created_at,
        metadata: { taskId: dto.task_id, status: dto.status },
        visibility: dto.visibility,
        ownerId: dto.owner.id,
        urlExpiresAt: dto.url_expires_at,
    };
    // 服务端 UUID 是画布快照可长期保存的稳定引用；签名 URL 过期后据此重新签发。
    if (dto.kind === "image") return { ...common, kind: "image", data: { dataUrl: dto.url || "", storageKey: dto.id, width: dto.width || 0, height: dto.height || 0, bytes: dto.bytes, mimeType: dto.mime_type } };
    if (dto.kind === "video") return { ...common, kind: "video", data: { url: dto.url || "", storageKey: dto.id, width: dto.width || 0, height: dto.height || 0, bytes: dto.bytes, mimeType: dto.mime_type } };
    if (dto.kind === "audio") return { ...common, kind: "audio", data: { url: dto.url || "", storageKey: dto.id, bytes: dto.bytes, mimeType: dto.mime_type, durationMs: dto.duration_ms || undefined } };
    return { ...common, kind: "file", data: { url: dto.url || "", storageKey: dto.id, bytes: dto.bytes, mimeType: dto.mime_type } };
}

async function blobFromDraft(asset: AssetDraft): Promise<{ blob: Blob; filename: string } | null> {
    if (asset.kind === "text") return null;
    const url = asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.data.url;
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error("读取待上传资产失败");
    const blob = await response.blob();
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    return { blob, filename: `${asset.title || "asset"}.${extension}` };
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: true,
    loading: false,
    assets: [],
    nextCursor: null,
    filters: { limit: 40 },
    loadAssets: async (filters = get().filters, append = false) => {
        set({ loading: true, filters });
        try {
            const page = await assetsApi.list({ ...filters, cursor: append ? get().nextCursor || undefined : filters.cursor });
            const items = page.items.map(assetFromDto);
            // 新一轮服务端列表代表新的签名 URL 生命周期，允许媒体加载失败后再次续签一次。
            for (const item of items) renewedAfterError.delete(item.id);
            set((state) => ({ assets: append ? [...state.assets, ...items] : items, nextCursor: page.next_cursor }));
            await get().refreshExpiringUrls();
        } finally {
            set({ loading: false });
        }
    },
    addAsset: async (draft) => {
        // 只有服务端确认成功后才写入列表，调用方可据真实结果展示成功或失败。
        if (draft.kind === "text") {
            const saved = await promptsApi.create({ title: draft.title, content: draft.data.content, tags: draft.tags, visibility: draft.visibility || "private" });
            return saved.id;
        }
        const source = await blobFromDraft(draft);
        if (!source) throw new Error("待上传资产没有可读取的内容");
        const saved = assetFromDto(await uploadAsset(source.blob, source.filename));
        set((state) => ({ assets: [saved, ...state.assets.filter((item) => item.id !== saved.id)] }));
        return saved.id;
    },
    updateAsset: (id, patch) => set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)) })),
    removeAsset: async (id) => {
        const asset = get().assets.find((item) => item.id === id);
        if (!asset) return;
        if (asset.kind === "text") await promptsApi.remove(id);
        else await assetsApi.remove(id);
        set((state) => ({ assets: state.assets.filter((item) => item.id !== id) }));
    },
    replaceAssets: (assets) => set({ assets }),
    refreshExpiringUrls: async () => {
        const ids = get()
            .assets.filter((asset) => asset.kind !== "text" && (!asset.urlExpiresAt || new Date(asset.urlExpiresAt).getTime() - Date.now() < REFRESH_WINDOW_MS))
            .map((asset) => asset.id);
        if (!ids.length) return;
        const { urls } = await assetsApi.urls(ids);
        set((state) => ({
            assets: state.assets.map((asset) => {
                const signed = urls[asset.id];
                if (!signed || asset.kind === "text") return asset;
                const data = asset.kind === "image" ? { ...asset.data, dataUrl: signed.url } : { ...asset.data, url: signed.url };
                return { ...asset, coverUrl: asset.kind === "image" ? signed.url : asset.coverUrl, data, urlExpiresAt: signed.expires_at } as Asset;
            }),
        }));
    },
    reloadAssetUrl: async (id) => {
        if (renewedAfterError.has(id)) return undefined;
        renewedAfterError.add(id);
        const signed = await getAssetUrl(id);
        let result: string | undefined;
        set((state) => ({
            assets: state.assets.map((asset) => {
                if (asset.id !== id || asset.kind === "text") return asset;
                result = signed.url;
                const data = asset.kind === "image" ? { ...asset.data, dataUrl: signed.url } : { ...asset.data, url: signed.url };
                return { ...asset, coverUrl: asset.kind === "image" ? signed.url : asset.coverUrl, data, urlExpiresAt: signed.expires_at } as Asset;
            }),
        }));
        return result;
    },
    cleanupImages: () => undefined,
}));
