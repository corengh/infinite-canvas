import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";

import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { canvasApi } from "@/platform/api/canvas";
import { canvasSessionId } from "@/platform/canvas/session";
import { canvasSync } from "@/platform/canvas/sync-engine";
import { createCanvasCacheStorage } from "@/platform/canvas/storage";
import { ApiError } from "@/platform/http/errors";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    nodeCount?: number;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[]) => void;
    replaceProject: (project: CanvasProject) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "title" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
const canvasStorage = createCanvasCacheStorage<CanvasStore>();

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: async (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const created = await canvasApi.create(title);
                const project: CanvasProject = {
                    id: created.id,
                    title: created.title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return created.id;
            },
            importProject: async (source) => {
                const now = new Date().toISOString();
                const created = await canvasApi.create(source.title || i18n.t("canvas.project.imported"));
                const project: CanvasProject = {
                    id: created.id,
                    title: created.title,
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                const empty = { ...project, nodes: [], connections: [], backgroundMode: "lines" as const, showImageInfo: false, viewport: initialViewport };
                const lock = await canvasApi.acquireLock(project.id, canvasSessionId());
                canvasSync.attach(project.id, created.version, { readonly: lock.mode !== "edit" });
                canvasSync.onProjectPatched(project.id, empty, project);
                await canvasSync.flushNow();
                return created.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: async (id, title) => {
                const trimmed = title.trim();
                const current = get().projects.find((project) => project.id === id);
                if (!current || !trimmed || trimmed === current.title) return;
                await canvasSync.flushNow();
                if (await canvasSync.unsavedCount(id)) throw new Error("画布仍有未同步修改，请恢复网络后重试重命名");
                const updated = await canvasApi.update(id, trimmed);
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: updated.title, updatedAt: new Date().toISOString() } : project)),
                }));
            },
            deleteProjects: async (ids) => {
                const results = await Promise.allSettled(
                    ids.map(async (id) => {
                        try {
                            await canvasApi.delete(id);
                        } catch (error) {
                            // 删除是幂等用户意图；目标已不存在时，本地也应完成清理。
                            if (!(error instanceof ApiError) || (error.code !== "CANVAS_NOT_FOUND" && error.status !== 404)) throw error;
                        }
                        return id;
                    }),
                );
                const deletedIds = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
                if (deletedIds.length) {
                    await Promise.all(deletedIds.map((id) => canvasSync.discardCanvas(id)));
                    set((state) => ({ projects: state.projects.filter((project) => !deletedIds.includes(project.id)) }));
                }
                const failed = results.length - deletedIds.length;
                if (failed) throw new Error(`${ids.length} 个画布中 ${deletedIds.length} 个已删除，${failed} 个删除失败`);
            },
            replaceProjects: (projects) => set({ projects }),
            replaceProject: (project) =>
                set((state) => ({
                    projects: state.projects.some((item) => item.id === project.id) ? state.projects.map((item) => (item.id === project.id ? project : item)) : [project, ...state.projects],
                })),
            updateProject: (id, patch) =>
                set((state) => {
                    const previous = state.projects.find((project) => project.id === id) ?? null;
                    if (!previous) return state;
                    const next = { ...previous, ...patch, nodeCount: patch.nodes?.length ?? previous.nodeCount, updatedAt: new Date().toISOString() };
                    // [PLATFORM] 画布状态变更生成 op 并异步提交服务端（design C-1 / FE-7）。
                    canvasSync.onProjectPatched(id, previous, next);
                    return { projects: state.projects.map((project) => (project.id === id ? next : project)) };
                }),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
