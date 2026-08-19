type Listener = (paused: boolean) => void;
export type CanvasSyncAdapter = { pauseSubmissions: () => void; resumeSubmissions: () => void | Promise<void> };
const listeners = new Set<Listener>();
let paused = false;
let adapter: CanvasSyncAdapter | null = null;

// FE-7 的离线队列订阅这个门闩；暂停只阻止提交，不清空任何待提交 op。
export const canvasSyncControl = {
    pause(): void {
        if (paused) return;
        paused = true;
        adapter?.pauseSubmissions();
        listeners.forEach((listener) => listener(true));
    },
    async resume(): Promise<void> {
        if (!paused) return;
        await adapter?.resumeSubmissions();
        paused = false;
        listeners.forEach((listener) => listener(false));
    },
    isPaused: () => paused,
    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    register(next: CanvasSyncAdapter): () => void {
        adapter = next;
        if (paused) next.pauseSubmissions();
        return () => {
            if (adapter === next) adapter = null;
        };
    },
};
