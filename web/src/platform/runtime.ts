import { PLATFORM_DEFAULT_CONFIG } from "@/platform/config";

export type RuntimeConfig = {
    apiBaseUrl: string;
    sseEnabled: boolean;
    appName: string;
    icpNumber: string;
    analyticsGa4Id: string;
    analyticsBaiduId: string;
};

type LegacyRuntimeConfig = {
    ANALYTICS_GA4_ID?: string;
    ANALYTICS_BAIDU_ID?: string;
};

declare global {
    interface Window {
        __APP_CONFIG__?: Partial<RuntimeConfig>;
        __RUNTIME_CONFIG__?: LegacyRuntimeConfig;
    }
}

const injected = typeof window === "undefined" ? {} : window.__APP_CONFIG__ || {};
const legacy = typeof window === "undefined" ? {} : window.__RUNTIME_CONFIG__ || {};

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        if (value.toLowerCase() === "true") return true;
        if (value.toLowerCase() === "false") return false;
    }
    return fallback;
}

// 所有部署环境均从同一份运行时对象读取配置，镜像无需按环境重新构建。
export const runtime: Readonly<RuntimeConfig> = Object.freeze({
    apiBaseUrl: readString(injected.apiBaseUrl, PLATFORM_DEFAULT_CONFIG.apiBaseUrl),
    sseEnabled: readBoolean(injected.sseEnabled, PLATFORM_DEFAULT_CONFIG.sseEnabled),
    appName: readString(injected.appName, PLATFORM_DEFAULT_CONFIG.appName),
    icpNumber: readString(injected.icpNumber, PLATFORM_DEFAULT_CONFIG.icpNumber),
    analyticsGa4Id: readString(injected.analyticsGa4Id ?? legacy.ANALYTICS_GA4_ID, import.meta.env.VITE_ANALYTICS_GA4_ID || PLATFORM_DEFAULT_CONFIG.analyticsGa4Id),
    analyticsBaiduId: readString(injected.analyticsBaiduId ?? legacy.ANALYTICS_BAIDU_ID, import.meta.env.VITE_ANALYTICS_BAIDU_ID || PLATFORM_DEFAULT_CONFIG.analyticsBaiduId),
});
