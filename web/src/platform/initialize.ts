import { authStore } from "@/platform/auth/store";
import { api } from "@/platform/http/client";
import { runtime } from "@/platform/runtime";

let initialized = false;

export function initializePlatform(): void {
    if (initialized) return;
    initialized = true;
    // 模块导入先固化运行时配置与 HTTP 客户端，再恢复仅存在于当前标签页的 access token。
    void runtime.apiBaseUrl;
    void api;
    authStore.getState().rehydrate();
}
