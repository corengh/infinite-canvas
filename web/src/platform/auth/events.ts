export type AuthEvent = "session-expired";

type AuthEventListener = () => void;

const listeners = new Map<AuthEvent, Set<AuthEventListener>>();

// HTTP 层只发布会话事件，不直接控制路由或弹窗，避免网络基础设施反向依赖页面。
export const authEvents = {
    on(event: AuthEvent, listener: AuthEventListener): () => void {
        const eventListeners = listeners.get(event) ?? new Set<AuthEventListener>();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
        return () => eventListeners.delete(listener);
    },
    emit(event: AuthEvent): void {
        listeners.get(event)?.forEach((listener) => listener());
    },
};
