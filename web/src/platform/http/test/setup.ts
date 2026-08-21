import { afterAll, afterEach, beforeAll } from "vitest";

import { authStore } from "@/platform/auth/store";
import { resetRefreshQueueForTests } from "@/platform/http/refresh-queue";

import { server } from "./server";

function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, value),
    };
}

// Vitest 使用 node 环境；画布 store 与每标签页 session 需要最小 Web Storage 契约。
Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), configurable: true });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
    server.resetHandlers();
    resetRefreshQueueForTests();
    authStore.setState({
        user: null,
        team: null,
        role: null,
        capabilities: new Set(),
        accessToken: null,
        expiresAt: null,
        status: "unknown",
        rehydrateError: null,
        loginId: null,
        sessionEpoch: 0,
        expiredSessionEpoch: null,
    });
});
afterAll(() => server.close());
