import { useCallback, useEffect, useState } from "react";

export function retryAfterSeconds(details: Record<string, unknown> | undefined, fallback = 60): number {
    const retryAfter = details?.retry_after;
    return typeof retryAfter === "number" && Number.isFinite(retryAfter) ? Math.max(1, Math.ceil(retryAfter)) : fallback;
}

export function useCountdown() {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        if (seconds <= 0) return;
        const timer = window.setTimeout(() => setSeconds((current) => Math.max(0, current - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [seconds]);
    return { seconds, start: useCallback((value = 60) => setSeconds(Math.max(1, Math.ceil(value))), []) };
}
