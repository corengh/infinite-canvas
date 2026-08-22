import { changeAppLocale } from "@/i18n";
import { authStore, type UserDTO } from "@/platform/auth/store";
import { api } from "@/platform/http/client";
import { runtime } from "@/platform/runtime";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

let initialized = false;

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function applyServerPreferences(preferences: Record<string, unknown> | undefined): void {
    const value = record(preferences);
    const ui = record(value.ui);
    const configStore = useConfigStore.getState();

    // 每次会话切换都从安全默认值重建，缺失键不能沿用上一个账号的本地缓存。
    configStore.applyServerPreferences(value);
    useThemeStore.getState().setTheme(ui.theme === "light" ? "light" : "dark");
    void changeAppLocale(ui.lang === "en-US" ? "en-US" : "zh-CN");
}

export function initializePlatform(): void {
    if (initialized) return;
    initialized = true;
    // 模块导入先固化运行时配置与 HTTP 客户端，再恢复仅存在于当前标签页的 access token。
    void runtime.apiBaseUrl;
    void api;
    authStore.subscribe((state, previous) => {
        if (state.user !== previous.user) applyServerPreferences(state.user?.preferences);
    });
    void authStore.getState().rehydrate(async () => {
        return api.get<UserDTO>("/me");
    });
}
