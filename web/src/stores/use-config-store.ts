import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ApiCallFormat = "openai" | "gemini" | "ark";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type PlatformModelCapability = "text2image" | "image2image" | "text2video" | "image2video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
export type ChannelModel = { name: string; capability: ModelCapability };
export type ModelChannel = { id: string; name: string; apiFormat: ApiCallFormat; models: ChannelModel[] };
export type WebdavSyncConfig = { url: string; username: string; password: string; directory: string; lastSyncedAt: string };
export type ConfigTabKey = "preferences";

export type AiConfig = {
    channelMode: "platform";
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    defaultModels: Partial<Record<PlatformModelCapability, string>>;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    canvasBackground: "dots" | "lines" | "blank";
    generationParams?: Record<string, unknown>;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export const defaultConfig: AiConfig = {
    channelMode: "platform",
    apiFormat: "openai",
    channels: [],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    defaultModels: {},
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720p",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "medium",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    canvasBackground: "lines",
    generationParams: {},
};
export const defaultWebdavSyncConfig: WebdavSyncConfig = { url: "", username: "", password: "", directory: "infinite-canvas", lastSyncedAt: "" };

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    setPlatformModels: (models: ChannelModel[]) => void;
    applyServerPreferences: (preferences?: Record<string, unknown>) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (open: boolean) => void;
    clearPromptContinue: () => void;
};

function safePersistedConfig(value: unknown): AiConfig {
    const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    // 只允许生成默认值进入快速缓存；旧版本遗留的渠道与凭据字段会在此被彻底丢弃。
    const text = (key: keyof AiConfig, fallback: string) => (typeof source[key] === "string" ? (source[key] as string) : fallback);
    const persistedDefaults = source.defaultModels && typeof source.defaultModels === "object" && !Array.isArray(source.defaultModels) ? (source.defaultModels as Record<string, unknown>) : {};
    const defaultModels = Object.fromEntries(Object.entries(persistedDefaults).filter(([key, value]) => ["text2image", "image2image", "text2video", "image2video", "text", "audio"].includes(key) && typeof value === "string" && value)) as Partial<
        Record<PlatformModelCapability, string>
    >;
    return {
        ...defaultConfig,
        model: text("model", ""),
        imageModel: text("imageModel", ""),
        videoModel: text("videoModel", ""),
        textModel: text("textModel", ""),
        audioModel: text("audioModel", ""),
        defaultModels,
        audioVoice: text("audioVoice", defaultConfig.audioVoice),
        audioFormat: text("audioFormat", defaultConfig.audioFormat),
        audioSpeed: text("audioSpeed", defaultConfig.audioSpeed),
        audioInstructions: text("audioInstructions", ""),
        videoSeconds: text("videoSeconds", defaultConfig.videoSeconds),
        vquality: text("vquality", defaultConfig.vquality),
        videoGenerateAudio: text("videoGenerateAudio", defaultConfig.videoGenerateAudio),
        videoWatermark: text("videoWatermark", defaultConfig.videoWatermark),
        systemPrompt: text("systemPrompt", ""),
        reasoningEffort: ["auto", "low", "medium", "high", "xhigh"].includes(String(source.reasoningEffort)) ? (source.reasoningEffort as ReasoningEffort) : "auto",
        quality: text("quality", defaultConfig.quality),
        size: text("size", defaultConfig.size),
        background: text("background", ""),
        count: text("count", defaultConfig.count),
        canvasImageCount: text("canvasImageCount", defaultConfig.canvasImageCount),
        canvasBackground: (["dots", "blank"] as const).includes(source.canvasBackground as "dots" | "blank") ? (source.canvasBackground as "dots" | "blank") : "lines",
        generationParams: source.generationParams && typeof source.generationParams === "object" ? (source.generationParams as Record<string, unknown>) : {},
    };
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "preferences",
            shouldPromptContinue: false,
            updateConfig: (key, value) => set((state) => ({ config: { ...state.config, [key]: value } })),
            setPlatformModels: (models) =>
                set((state) => {
                    const values = models.map((item) => item.name);
                    const channel = { id: "platform", name: "AIGC Studio", apiFormat: "openai" as const, models };
                    const first = (capability: ModelCapability) => models.find((item) => item.capability === capability)?.name || "";
                    // 通用 model 不再塞入目录第一项，否则它会被误判成用户显式选择并覆盖六类服务端默认值。
                    return {
                        config: {
                            ...state.config,
                            channels: [channel],
                            models: values,
                            imageModel: state.config.imageModel || state.config.defaultModels.text2image || first("image"),
                            videoModel: state.config.videoModel || state.config.defaultModels.text2video || first("video"),
                            textModel: state.config.textModel || state.config.defaultModels.text || first("text"),
                            audioModel: state.config.audioModel || state.config.defaultModels.audio || first("audio"),
                        },
                    };
                }),
            applyServerPreferences: (preferences = {}) =>
                set((state) => {
                    const source = preferences && typeof preferences === "object" ? preferences : {};
                    const defaultsValue = source.default_models && typeof source.default_models === "object" && !Array.isArray(source.default_models) ? (source.default_models as Record<string, unknown>) : {};
                    const generation = source.generation_defaults && typeof source.generation_defaults === "object" && !Array.isArray(source.generation_defaults) ? (source.generation_defaults as Record<string, unknown>) : {};
                    const ui = source.ui && typeof source.ui === "object" && !Array.isArray(source.ui) ? (source.ui as Record<string, unknown>) : {};
                    const defaultModels = Object.fromEntries(
                        Object.entries(defaultsValue).filter(([key, value]) => ["text2image", "image2image", "text2video", "image2video", "text", "audio"].includes(key) && typeof value === "string" && value),
                    ) as Partial<Record<PlatformModelCapability, string>>;
                    return {
                        config: {
                            ...defaultConfig,
                            channels: state.config.channels,
                            models: state.config.models,
                            defaultModels,
                            imageModel: defaultModels.text2image || "",
                            videoModel: defaultModels.text2video || "",
                            textModel: defaultModels.text || "",
                            audioModel: defaultModels.audio || "",
                            quality: typeof generation.quality === "string" ? generation.quality : defaultConfig.quality,
                            size: typeof generation.size === "string" ? generation.size : defaultConfig.size,
                            vquality: typeof generation.resolution === "string" ? generation.resolution : defaultConfig.vquality,
                            generationParams: { ...generation },
                            canvasBackground: ["dots", "lines", "blank"].includes(String(ui.canvasBackground)) ? (ui.canvasBackground as AiConfig["canvasBackground"]) : defaultConfig.canvasBackground,
                        },
                    };
                }),
            updateWebdavConfig: (key, value) => set((state) => ({ webdav: { ...state.webdav, [key]: value } })),
            isAiConfigReady: (_config, model) => Boolean(model.trim()),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const state = persisted as { config?: unknown } | undefined;
                return { ...current, config: safePersistedConfig(state?.config) };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => config, [config]);
}

export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (/(video|sora|veo|seedance|kling)/.test(value)) return "video";
    if (/(audio|tts|speech|voice)/.test(value)) return "audio";
    if (/(image|dall|imagen|flux|seedream)/.test(value)) return "image";
    return "text";
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => model.name));
}
export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    return !capability || selectableModelsByCapability(config, capability).includes(modelOptionName(value));
}
export function resolveModelForCapability(config: AiConfig, current: string | undefined, capability: ModelCapability) {
    const preferred = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    return [current, preferred, ...selectableModelsByCapability(config, capability)].find((item) => Boolean(item) && modelMatchesCapability(config, item!, capability)) || "";
}
export const resolveModelScript = () => "";
export const encodeChannelModel = (_channelId: string, model: string) => model;
export const decodeChannelModel = (value: string) => (value.includes("::") ? { channelId: value.split("::")[0], model: value.split("::").slice(1).join("::") } : null);
export const modelOptionName = (value: string) => decodeChannelModel(value)?.model || value;
export const modelOptionLabel = (_config: AiConfig, value: string) => modelOptionName(value);
export const modelOptionsFromChannels = (channels: ModelChannel[]) => Array.from(new Set(channels.flatMap((channel) => channel.models.map((model) => model.name))));
export const normalizeModelOptionValue = (value: string | undefined, _channels?: ModelChannel[]) => modelOptionName(value || "");
export const normalizeChannelModels = (models: Array<string | ChannelModel> | undefined) => (models || []).map((model) => (typeof model === "string" ? { name: model, capability: guessCapability(model) } : model));
export const createModelChannel = (channel: Partial<ModelChannel> = {}): ModelChannel => ({ id: channel.id || "platform", name: channel.name || "AIGC Studio", apiFormat: channel.apiFormat || "openai", models: normalizeChannelModels(channel.models) });
export const resolveModelChannel = (config: AiConfig, value: string) => config.channels.find((channel) => channel.models.some((model) => model.name === modelOptionName(value))) || config.channels[0] || createModelChannel();
export const resolveModelRequestConfig = (config: AiConfig, value: string): AiConfig => ({ ...config, model: modelOptionName(value || config.model), apiFormat: resolveModelChannel(config, value).apiFormat });
