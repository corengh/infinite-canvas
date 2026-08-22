export type CanvasEvent = "lock-lost" | "readonly-edit-blocked" | "remote-project-applied" | "canvas-deleted";

type CanvasEventDetails = Record<string, unknown> | undefined;
type CanvasEventListener = (details: CanvasEventDetails) => void;

const listeners = new Map<CanvasEvent, Set<CanvasEventListener>>();

// HTTP 层只发布锁状态变化；FE-8 负责转只读、保护未提交修改并展示接管提示。
export const canvasEvents = {
    on(event: CanvasEvent, listener: CanvasEventListener): () => void {
        const eventListeners = listeners.get(event) ?? new Set<CanvasEventListener>();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
        return () => eventListeners.delete(listener);
    },
    emit(event: CanvasEvent, details?: CanvasEventDetails): void {
        listeners.get(event)?.forEach((listener) => listener(details));
    },
};
