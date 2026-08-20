import { rechargeApi, type OrderStatusResult } from "@/platform/api/recharge";

export const FAST_POLL_WINDOW_MS = 2 * 60 * 1000;
export const FAST_POLL_INTERVAL_MS = 2_000;
export const SLOW_POLL_INTERVAL_MS = 5_000;

export function pollingInterval(elapsedMs: number): number {
    return elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
}

type VisibilitySource = {
    hidden: boolean;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export type OrderPoller = { checkNow(): void; stop(): void };

export function watchOrder(
    orderId: string,
    expiresAt: string,
    handlers: {
        onStatus(result: OrderStatusResult): void;
        onTimeout(): void;
        onError(error: unknown): void;
    },
    dependencies: {
        getOrder?: (id: string) => Promise<OrderStatusResult>;
        now?: () => number;
        visibility?: VisibilitySource;
        setTimer?: typeof setTimeout;
        clearTimer?: typeof clearTimeout;
    } = {},
): OrderPoller {
    const getOrder = dependencies.getOrder ?? rechargeApi.order;
    const now = dependencies.now ?? Date.now;
    const visibility = dependencies.visibility ?? (typeof document === "undefined" ? undefined : document);
    const setTimer = dependencies.setTimer ?? setTimeout;
    const clearTimer = dependencies.clearTimer ?? clearTimeout;
    const startedAt = now();
    const deadline = Date.parse(expiresAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;

    const clear = () => {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
    };

    const timeoutIfDue = () => {
        if (Number.isFinite(deadline) && now() >= deadline) {
            stopped = true;
            handlers.onTimeout();
            return true;
        }
        return false;
    };

    const schedule = () => {
        clear();
        if (stopped || visibility?.hidden || timeoutIfDue()) return;
        timer = setTimer(check, pollingInterval(now() - startedAt));
    };

    async function check() {
        if (stopped || inFlight || visibility?.hidden) return;
        clear();
        inFlight = true;
        try {
            const result = await getOrder(orderId);
            if (stopped) return;
            handlers.onStatus(result);
            if (result.status !== "pending") {
                stopped = true;
                return;
            }
        } catch (error) {
            if (!stopped) handlers.onError(error);
        } finally {
            inFlight = false;
        }
        schedule();
    }

    const onVisibilityChange = () => {
        clear();
        // 从后台恢复时立即核对，不等待下一轮退避间隔。
        if (!visibility?.hidden) void check();
    };
    visibility?.addEventListener("visibilitychange", onVisibilityChange);
    void check();

    return {
        checkNow: () => void check(),
        stop: () => {
            stopped = true;
            clear();
            visibility?.removeEventListener("visibilitychange", onVisibilityChange);
        },
    };
}
