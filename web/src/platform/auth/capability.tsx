import type { ReactNode } from "react";
import { useAuthStore } from "./store";

export function canAccess(capabilities: Set<string>, capability: string): boolean {
    // 这里只改善按钮体验，服务端仍必须对每次请求独立鉴权。
    return capabilities.has(capability);
}

export function Can({ capability, children }: { capability: string; children: ReactNode }) {
    const capabilities = useAuthStore((state) => state.capabilities);
    return canAccess(capabilities, capability) ? children : null;
}
