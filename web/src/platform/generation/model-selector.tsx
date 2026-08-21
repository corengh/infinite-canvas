import { useMutation, useQuery } from "@tanstack/react-query";
import { Empty, Input, InputNumber, Select, Skeleton, Switch, Typography } from "antd";
import { useEffect, useMemo } from "react";

import { modelsApi, type JsonSchema, type ModelCapability, type ModelDTO } from "@/platform/api/models";
import { authApi } from "@/platform/auth/api";
import { authStore, useAuthStore } from "@/platform/auth/store";
import { paramsForModel } from "./model-params";

export { paramsForModel } from "./model-params";

const HIDDEN_SCHEMA_FIELDS = new Set(["prompt", "reference_images", "reference_asset_ids"]);

export type SchemaField = {
    name: string;
    label: string;
    description?: string;
    schema: JsonSchema;
    required: boolean;
};

export function schemaFields(schema: JsonSchema): SchemaField[] {
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties ?? {})
        .filter(([name]) => !HIDDEN_SCHEMA_FIELDS.has(name))
        .map(([name, field]) => ({
            name,
            label: field.title || PARAM_LABELS[name] || name,
            description: field.description,
            schema: field,
            required: required.has(name),
        }));
}

export function shouldRenderGenerationEntry(capability: ModelCapability, modelCount: number): boolean {
    return capability !== "audio" || modelCount > 0;
}

export function historicalUnavailableModel(model: ModelDTO | undefined): ModelDTO | undefined {
    // 能查到详情但仍上架的模型只是与当前能力不匹配，应切换默认模型而不是误报下架。
    return model?.enabled === false ? model : undefined;
}

type ModelSelectorProps = {
    capability: ModelCapability;
    value?: string;
    params?: Record<string, unknown>;
    onChange: (modelCode: string, params: Record<string, unknown>) => void;
    onAvailabilityChange?: (available: boolean) => void;
    className?: string;
    compact?: boolean;
};

export function ModelSelector({ capability, value, params = {}, onChange, onAvailabilityChange, className, compact = false }: ModelSelectorProps) {
    const user = useAuthStore((state) => state.user);
    const userId = user?.id ?? "anonymous";
    const models = useQuery({
        queryKey: ["models", userId, capability],
        queryFn: () => modelsApi.list(capability),
        enabled: Boolean(user),
        staleTime: 60_000,
    });
    const items = useMemo(() => [...(models.data?.items ?? [])].sort((left, right) => right.priority - left.priority), [models.data?.items]);
    const selected = items.find((item) => item.code === value);
    const historical = useQuery({
        queryKey: ["model-detail", userId, value],
        queryFn: () => modelsApi.detail(value!),
        enabled: Boolean(user && value && !selected && !models.isLoading),
        retry: false,
    });
    // 详情存在但仍为 enabled，说明它只是不支持当前 capability，并非已经下架。
    const historicalModel = historicalUnavailableModel(historical.data);
    const preference = readPreferredModel(user?.preferences, capability);
    const savePreference = useMutation({
        mutationFn: (modelCode: string) => authApi.updatePreferences({ default_models: { [capability]: modelCode } }),
        onSuccess: (preferences) => {
            const state = authStore.getState();
            if (state.user?.id === userId) state.setUser({ ...state.user, preferences });
        },
    });

    useEffect(() => {
        onAvailabilityChange?.(items.length > 0);
    }, [items.length, onAvailabilityChange]);

    useEffect(() => {
        // 历史模型详情尚未返回时不能抢先覆盖节点，否则“已下架”模型会被静默改成默认模型。
        if (!items.length || selected || (value && !selected && (historical.isFetching || historicalModel))) return;
        const initial = items.find((item) => item.code === preference) ?? items.find((item) => item.default_for.includes(capability)) ?? items[0];
        onChange(initial.code, paramsForModel(initial, params));
    }, [capability, historical.isFetching, historicalModel, items, onChange, params, preference, selected, value]);

    if (models.isLoading) return <Skeleton.Input active size="small" block />;
    if (!items.length) return shouldRenderGenerationEntry(capability, items.length) ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用模型" /> : null;

    const shownModel = selected ?? historicalModel;
    return (
        <div className={className}>
            <Select
                className="w-full"
                value={value}
                optionLabelProp="label"
                placeholder="选择模型"
                status={historicalModel && !selected ? "error" : undefined}
                onChange={(modelCode) => {
                    const model = items.find((item) => item.code === modelCode);
                    if (!model) return;
                    onChange(modelCode, paramsForModel(model, {}));
                    savePreference.mutate(modelCode);
                }}
            >
                {historicalModel && !selected ? (
                    <Select.Option value={historicalModel.code} label={`${historicalModel.name}（已下架）`} disabled>
                        <ModelOption model={historicalModel} unavailable />
                    </Select.Option>
                ) : null}
                {items.map((model) => (
                    <Select.Option key={model.code} value={model.code} label={model.name}>
                        <ModelOption model={model} />
                    </Select.Option>
                ))}
            </Select>
            {historicalModel && !selected ? (
                <Typography.Text type="danger" className="mt-1 block text-xs">
                    该模型已下架，请选择其他模型
                </Typography.Text>
            ) : null}
            {!compact && shownModel?.enabled ? <DynamicParamsForm schema={shownModel.params_schema} value={paramsForModel(shownModel, params)} onChange={(next) => onChange(shownModel.code, next)} /> : null}
        </div>
    );
}

function ModelOption({ model, unavailable = false }: { model: ModelDTO; unavailable?: boolean }) {
    return (
        <div className="py-1">
            <div className="font-medium">
                {model.name}
                {unavailable ? "（已下架）" : ""}
            </div>
            <div className="text-xs opacity-65">{model.pricing?.display ?? "价格暂不可用"}</div>
        </div>
    );
}

export function DynamicParamsForm({ schema, value, onChange }: { schema: JsonSchema; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
    const fields = schemaFields(schema);
    if (!fields.length) return null;
    const update = (name: string, next: unknown) => onChange({ ...value, [name]: next });
    return (
        <div className="mt-2 grid grid-cols-2 gap-2">
            {fields.map((field) => (
                <label key={field.name} className="min-w-0 text-xs" title={field.description}>
                    <span className="mb-1 block opacity-65">
                        {field.label}
                        {field.required ? " *" : ""}
                    </span>
                    <SchemaInput field={field} value={value[field.name]} onChange={(next) => update(field.name, next)} />
                </label>
            ))}
        </div>
    );
}

function SchemaInput({ field, value, onChange }: { field: SchemaField; value: unknown; onChange: (value: unknown) => void }) {
    const schema = field.schema;
    if (schema.const !== undefined) return <Input size="small" disabled value={String(schema.const)} />;
    if (schema.enum) return <Select size="small" className="w-full" value={value} options={schema.enum.map((item) => ({ value: item as string | number, label: String(item) }))} onChange={onChange} />;
    if (schema.type === "boolean") return <Switch size="small" checked={Boolean(value)} onChange={onChange} />;
    if (schema.type === "number" || schema.type === "integer") {
        return (
            <InputNumber
                size="small"
                className="w-full"
                value={typeof value === "number" ? value : undefined}
                min={schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + (schema.type === "integer" ? 1 : Number.EPSILON) : undefined)}
                max={schema.maximum ?? (schema.exclusiveMaximum !== undefined ? schema.exclusiveMaximum - (schema.type === "integer" ? 1 : Number.EPSILON) : undefined)}
                precision={schema.type === "integer" ? 0 : undefined}
                onChange={(next) => onChange(next ?? undefined)}
            />
        );
    }
    return <Input size="small" value={typeof value === "string" ? value : ""} minLength={schema.minLength} maxLength={schema.maxLength} onChange={(event) => onChange(event.target.value)} />;
}

function readPreferredModel(preferences: Record<string, unknown> | undefined, capability: ModelCapability): string | undefined {
    const defaults = preferences?.default_models;
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return undefined;
    const value = (defaults as Record<string, unknown>)[capability];
    return typeof value === "string" ? value : undefined;
}

const PARAM_LABELS: Record<string, string> = {
    quality: "质量",
    size: "分辨率",
    seconds: "时长（秒）",
    count: "数量",
    seed: "随机种子",
    max_tokens: "最大输出长度",
};
