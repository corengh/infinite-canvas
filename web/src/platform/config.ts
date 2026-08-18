// 平台默认值只在此处维护，避免业务模块各自定义环境相关常量。
export const PLATFORM_DEFAULT_CONFIG = {
    apiBaseUrl: "/api",
    sseEnabled: true,
    appName: "AIGC Studio",
    icpNumber: "",
    analyticsGa4Id: "",
    analyticsBaiduId: "",
} as const;

// 安全相关开关采用不可变常量，禁止通过运行时配置重新开启远程插件能力。
export const PLATFORM_FEATURES = Object.freeze({
    remotePluginLoading: false,
    pluginStoreServerSync: false,
});
