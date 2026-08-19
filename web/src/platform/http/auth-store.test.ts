import { afterEach, describe, expect, it, vi } from "vitest";

import { authStore } from "@/platform/auth/store";

function createMemoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value),
    };
}

afterEach(() => vi.unstubAllGlobals());

describe("最小认证状态", () => {
    it("从 sessionStorage 恢复当前标签页的 token", () => {
        vi.stubGlobal("sessionStorage", createMemoryStorage());
        authStore.getState().setTokens("persisted-token", 900);
        const expiresAt = authStore.getState().expiresAt;
        authStore.setState({ accessToken: null, expiresAt: null });

        authStore.getState().rehydrate();

        expect(authStore.getState()).toMatchObject({ accessToken: "persisted-token", expiresAt });
    });

    it("损坏的缓存不会阻断启动", () => {
        const storage = createMemoryStorage();
        storage.setItem("aigc-studio:auth-session", "not-json");
        vi.stubGlobal("sessionStorage", storage);

        expect(() => authStore.getState().rehydrate()).not.toThrow();
        expect(storage.length).toBe(0);
    });

    it("浏览器拒绝 Storage 操作时降级为内存会话", () => {
        const blockedStorage = createMemoryStorage();
        blockedStorage.getItem = () => {
            throw new DOMException("blocked", "SecurityError");
        };
        blockedStorage.setItem = () => {
            throw new DOMException("blocked", "SecurityError");
        };
        blockedStorage.removeItem = () => {
            throw new DOMException("blocked", "SecurityError");
        };
        vi.stubGlobal("sessionStorage", blockedStorage);

        expect(() => authStore.getState().rehydrate()).not.toThrow();
        expect(() => authStore.getState().setTokens("memory-token", 900)).not.toThrow();
        expect(authStore.getState().accessToken).toBe("memory-token");
        expect(() => authStore.getState().clear()).not.toThrow();
        expect(authStore.getState().accessToken).toBeNull();
    });
});
