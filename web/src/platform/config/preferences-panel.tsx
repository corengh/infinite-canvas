import { useEffect, useMemo, useState } from "react";
import { App, Card, Empty, Select, Spin, Table, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { changeAppLocale, type AppLocale } from "@/i18n";
import { modelsApi, type ModelCapability, type ModelDTO } from "@/platform/api/models";
import { authApi } from "@/platform/auth/api";
import { authStore, useAuthStore } from "@/platform/auth/store";
import { useConfigStore, type ChannelModel, type ModelCapability as LegacyCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type GenerationDefaults = { size: string; resolution: string; quality: string };
type UiDefaults = { theme: "light" | "dark"; lang: AppLocale; canvasBackground: "dots" | "lines" | "blank" };
const capabilities: ModelCapability[] = ["text2image", "image2image", "text2video", "image2video", "text", "audio"];

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function text(value: unknown, fallback: string): string {
    return typeof value === "string" && value ? value : fallback;
}
function legacyCapability(capability: ModelCapability): LegacyCapability {
    if (capability === "text2image" || capability === "image2image") return "image";
    if (capability === "text2video" || capability === "image2video") return "video";
    return capability;
}

function preferenceState(preferences: unknown): {
    defaultModels: Record<string, string>;
    generation: GenerationDefaults;
    ui: UiDefaults;
} {
    const value = record(preferences);
    const generation = record(value.generation_defaults);
    const ui = record(value.ui);
    return {
        defaultModels: Object.fromEntries(Object.entries(record(value.default_models)).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
        generation: { size: text(generation.size, "1:1"), resolution: text(generation.resolution, "720p"), quality: text(generation.quality, "medium") },
        ui: {
            theme: text(ui.theme, "dark") === "light" ? "light" : "dark",
            lang: text(ui.lang, "zh-CN") === "en-US" ? "en-US" : "zh-CN",
            canvasBackground: (["dots", "blank"] as const).includes(ui.canvasBackground as "dots" | "blank") ? (ui.canvasBackground as "dots" | "blank") : "lines",
        },
    };
}

export function PlatformPreferencesPanel() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const user = useAuthStore((state) => state.user);
    const setTheme = useThemeStore((state) => state.setTheme);
    const setPlatformModels = useConfigStore((state) => state.setPlatformModels);
    const [models, setModels] = useState<ModelDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const initial = preferenceState(user?.preferences);
    const [defaultModels, setDefaultModels] = useState<Record<string, string>>(initial.defaultModels);
    const [generation, setGeneration] = useState<GenerationDefaults>(initial.generation);
    const [ui, setUi] = useState<UiDefaults>(initial.ui);

    useEffect(() => {
        // 同一浏览器切换账号时必须重建表单，不能继续显示上一位用户的偏好。
        const next = preferenceState(user?.preferences);
        setDefaultModels(next.defaultModels);
        setGeneration(next.generation);
        setUi(next.ui);
    }, [user?.id, user?.preferences]);

    useEffect(() => {
        let active = true;
        void modelsApi
            .list()
            .then((result) => {
                if (!active) return;
                setModels(result.items);
                const options = new Map<string, ChannelModel>();
                for (const model of result.items) for (const capability of model.capabilities) options.set(`${model.code}:${legacyCapability(capability)}`, { name: model.code, capability: legacyCapability(capability) });
                setPlatformModels(Array.from(options.values()));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("fe9.config.noModels")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [message, setPlatformModels, t]);

    const optionsByCapability = useMemo(() => Object.fromEntries(capabilities.map((capability) => [capability, models.filter((model) => model.capabilities.includes(capability)).map((model) => ({ value: model.code, label: model.name }))])), [models]);

    const save = async (patch: Parameters<typeof authApi.updatePreferences>[0]) => {
        if (!user) return;
        const userId = user.id;
        try {
            const next = await authApi.updatePreferences(patch);
            const state = authStore.getState();
            if (state.user?.id === userId) state.setUser({ ...state.user, preferences: next });
            message.success(t("fe9.config.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("fe9.config.saveFailed"));
        }
    };

    if (loading)
        return (
            <div className="grid h-52 place-items-center">
                <Spin />
            </div>
        );
    return (
        <div className="space-y-5">
            <Card title={t("fe9.config.models")}>
                {models.length ? (
                    <Table
                        rowKey="code"
                        pagination={false}
                        size="small"
                        dataSource={models}
                        columns={[
                            {
                                title: t("common.details"),
                                dataIndex: "name",
                                render: (name: string, model: ModelDTO) => (
                                    <div>
                                        <div className="font-medium">{name}</div>
                                        <div className="text-xs text-stone-500">{model.description}</div>
                                    </div>
                                ),
                            },
                            { title: t("fe9.config.capability"), dataIndex: "capabilities", render: (items: string[]) => items.map((item) => <Tag key={item}>{item}</Tag>) },
                            {
                                title: t("fe9.config.pricing"),
                                dataIndex: "pricing",
                                render: (pricing: ModelDTO["pricing"]) =>
                                    pricing ? (
                                        <div>
                                            <div>{pricing.base_price}</div>
                                            <div className="text-xs text-stone-500">{pricing.display}</div>
                                        </div>
                                    ) : (
                                        "—"
                                    ),
                            },
                        ]}
                    />
                ) : (
                    <Empty description={t("fe9.config.noModels")} />
                )}
            </Card>

            <Card title={t("fe9.config.defaults")}>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {capabilities.map((capability) => (
                        <label key={capability} className="grid gap-2 text-sm">
                            <span>{capability}</span>
                            <Select
                                allowClear
                                value={defaultModels[capability]}
                                options={optionsByCapability[capability]}
                                onChange={(value) => {
                                    const next = { ...defaultModels };
                                    if (value) next[capability] = value;
                                    else delete next[capability];
                                    setDefaultModels(next);
                                    // 清空时显式发送 null；undefined 会被 JSON 序列化丢弃，服务端无法删除旧偏好。
                                    void save({ default_models: { [capability]: value || null } });
                                }}
                            />
                        </label>
                    ))}
                </div>
            </Card>

            <Card title={t("fe9.config.generation")}>
                <div className="grid gap-4 md:grid-cols-3">
                    <PreferenceSelect
                        label={t("fe9.config.ratio")}
                        value={generation.size}
                        options={["1:1", "16:9", "9:16", "4:3", "3:4"]}
                        onChange={(size) => {
                            const next = { ...generation, size };
                            setGeneration(next);
                            void save({ generation_defaults: next });
                        }}
                    />
                    <PreferenceSelect
                        label={t("fe9.config.resolution")}
                        value={generation.resolution}
                        options={["480p", "720p", "1080p"]}
                        onChange={(resolution) => {
                            const next = { ...generation, resolution };
                            setGeneration(next);
                            void save({ generation_defaults: next });
                        }}
                    />
                    <PreferenceSelect
                        label={t("fe9.config.quality")}
                        value={generation.quality}
                        options={["low", "medium", "high"]}
                        onChange={(quality) => {
                            const next = { ...generation, quality };
                            setGeneration(next);
                            void save({ generation_defaults: next });
                        }}
                    />
                </div>
            </Card>

            <Card title={t("fe9.config.interface")}>
                <div className="grid gap-4 md:grid-cols-3">
                    <PreferenceSelect
                        label={t("fe9.config.theme")}
                        value={ui.theme}
                        options={["light", "dark"]}
                        labels={[t("fe9.config.light"), t("fe9.config.dark")]}
                        onChange={(theme) => {
                            const next = { ...ui, theme: theme as UiDefaults["theme"] };
                            setUi(next);
                            setTheme(next.theme);
                            void save({ ui: next });
                        }}
                    />
                    <PreferenceSelect
                        label={t("fe9.config.language")}
                        value={ui.lang}
                        options={["zh-CN", "en-US"]}
                        labels={[t("locale.zhCN"), t("locale.enUS")]}
                        onChange={(lang) => {
                            const next = { ...ui, lang: lang as AppLocale };
                            setUi(next);
                            void changeAppLocale(next.lang);
                            void save({ ui: next });
                        }}
                    />
                    <PreferenceSelect
                        label={t("fe9.config.canvasBackground")}
                        value={ui.canvasBackground}
                        options={["lines", "dots", "blank"]}
                        labels={[t("fe9.config.lines"), t("fe9.config.dots"), t("fe9.config.blank")]}
                        onChange={(canvasBackground) => {
                            const next = { ...ui, canvasBackground: canvasBackground as UiDefaults["canvasBackground"] };
                            setUi(next);
                            void save({ ui: next });
                        }}
                    />
                </div>
            </Card>
        </div>
    );
}

function PreferenceSelect({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
    return (
        <label className="grid gap-2 text-sm">
            <span>{label}</span>
            <Select value={value} options={options.map((option, index) => ({ value: option, label: labels?.[index] || option }))} onChange={onChange} />
        </label>
    );
}
