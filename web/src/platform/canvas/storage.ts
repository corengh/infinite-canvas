import type { PersistStorage, StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type CachedCanvasState = { projects: CanvasProject[] };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedState: CachedCanvasState | null = null;

/** 本地快照只用于离线启动和刷新恢复；服务端文档与 op-log 始终是持久化真相。 */
export function createCanvasCacheStorage<T extends CachedCanvasState>(): PersistStorage<T> {
    return {
        async getItem(name) {
            const value = await localForageStorage.getItem(name);
            if (!value) return null;
            const parsed = JSON.parse(value) as StorageValue<T>;
            queuedState = parsed.state;
            return parsed;
        },
        setItem(name, value) {
            if (queuedState?.projects === value.state.projects) return;
            queuedState = value.state;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                void localForageStorage.setItem(name, JSON.stringify(value));
            }, 400);
        },
        removeItem(name) {
            return localForageStorage.removeItem(name);
        },
    };
}
