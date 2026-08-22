import { batchAssetUrls } from "@/platform/api/assets";
import { canvasApi, type CanvasDocument, type CanvasSummary } from "@/platform/api/canvas";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

import { canvasSessionId } from "./session";
import { lockManager } from "./lock";
import { canvasSync } from "./sync-engine";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function summaryProject(item: CanvasSummary, cached?: CanvasProject): CanvasProject {
    return {
        id: item.id,
        title: item.title,
        createdAt: cached?.createdAt ?? item.updated_at,
        updatedAt: item.updated_at,
        nodes: cached?.nodes ?? [],
        connections: cached?.connections ?? [],
        chatSessions: cached?.chatSessions ?? [],
        activeChatId: cached?.activeChatId ?? null,
        backgroundMode: cached?.backgroundMode ?? "lines",
        showImageInfo: cached?.showImageInfo ?? false,
        viewport: cached?.viewport ?? { x: 0, y: 0, k: 1 },
        nodeCount: item.node_count,
    };
}

function documentProject(document: CanvasDocument, cached?: CanvasProject): CanvasProject {
    const now = new Date().toISOString();
    return {
        id: document.canvas.id,
        title: document.canvas.title,
        createdAt: cached?.createdAt ?? now,
        updatedAt: now,
        nodes: document.nodes,
        connections: document.connections,
        // 对话、选中态和撤销历史明确不进入服务端同步范围，只保留本标签页本地数据。
        chatSessions: cached?.chatSessions ?? [],
        activeChatId: cached?.activeChatId ?? null,
        backgroundMode: document.canvas.background_mode as CanvasProject["backgroundMode"],
        showImageInfo: document.canvas.show_image_info,
        viewport: document.canvas.viewport,
        nodeCount: document.nodes.length,
    };
}

async function signNodeAssets(project: CanvasProject, signal?: AbortSignal): Promise<CanvasProject> {
    const ids = new Set<string>();
    project.nodes.forEach((node) => {
        if (node.metadata?.storageKey && UUID_PATTERN.test(node.metadata.storageKey)) ids.add(node.metadata.storageKey);
        node.metadata?.images?.forEach((image) => {
            if (UUID_PATTERN.test(image.storageKey)) ids.add(image.storageKey);
        });
    });
    if (!ids.size) return project;
    const { urls } = await batchAssetUrls([...ids], signal);
    return {
        ...project,
        nodes: project.nodes.map((node) => {
            const primary = node.metadata?.storageKey ? urls[node.metadata.storageKey]?.url : undefined;
            const images = node.metadata?.images?.map((image) => ({ ...image, content: urls[image.storageKey]?.url ?? image.content }));
            return primary || images ? { ...node, metadata: { ...node.metadata, content: primary ?? node.metadata?.content, images } } : node;
        }),
    };
}

export const canvasLoader = {
    async list(): Promise<CanvasProject[]> {
        const cached = new Map(useCanvasStore.getState().projects.map((project) => [project.id, project]));
        const summaries: CanvasSummary[] = [];
        let cursor: string | undefined;
        do {
            const page = await canvasApi.list(cursor);
            summaries.push(...page.items);
            cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
        } while (cursor);
        const projects = summaries.map((item) => summaryProject(item, cached.get(item.id)));
        canvasSync.setApplyingRemote(true);
        try {
            useCanvasStore.getState().replaceProjects(projects);
        } finally {
            canvasSync.setApplyingRemote(false);
        }
        return projects;
    },

    async open(id: string, signal?: AbortSignal): Promise<CanvasProject> {
        const document = await canvasApi.load(id, canvasSessionId(), signal);
        signal?.throwIfAborted();
        await lockManager.acquire(id, signal);
        signal?.throwIfAborted();
        const cached = useCanvasStore.getState().openProject(id) ?? undefined;
        // 服务端文档是版本基线；IndexedDB 队列必须在其上重放，刷新后乐观修改才不会从界面消失。
        const optimistic = await canvasSync.restoreOptimisticProject(id, documentProject(document, cached));
        const project = await signNodeAssets(optimistic, signal);
        signal?.throwIfAborted();
        canvasSync.setApplyingRemote(true);
        try {
            useCanvasStore.getState().replaceProject(project);
        } finally {
            canvasSync.setApplyingRemote(false);
        }
        const currentLock = lockManager.getState();
        // 资源签名可能耗时较长；挂载同步时必须读取最新锁状态，不能复用 acquire 时的旧快照。
        canvasSync.attach(id, document.version, { readonly: currentLock.canvasId !== id || currentLock.mode !== "edit" });
        return project;
    },
};
