import { modelsApi, type JsonSchema, type ModelCapability, type ModelDTO } from "@/platform/api/models";

const MODEL_CACHE_MS = 60_000;
const modelListCache = new Map<ModelCapability, { expiresAt: number; promise: Promise<ModelDTO[]> }>();

/**
 * 只保留模型目录声明的参数，并在旧界面值不符合 schema 时回退到后端默认值。
 * 这层只负责“前端旧外壳 → 平台业务参数”，供应商字段映射仍完全留在后端 Provider。
 */
export function paramsForModel(model: ModelDTO, current: Record<string, unknown>): Record<string, unknown> {
    const properties = model.params_schema.properties ?? {};
    const merged = { ...model.defaults, ...current };
    return Object.fromEntries(
        Object.entries(properties).flatMap(([name, schema]) => {
            const value = merged[name];
            if (value !== undefined && acceptsValue(schema, value)) return [[name, value]];
            const fallback = model.defaults[name];
            return fallback !== undefined && acceptsValue(schema, fallback) ? [[name, fallback]] : [];
        }),
    );
}

/** 旧工作台选中的模型若已不在平台目录中，按后端默认模型接管，而不是继续提交旧供应商模型名。 */
export async function resolveGenerationModelParams(modelCode: string, capability: ModelCapability, current: Record<string, unknown>): Promise<{ modelCode: string; params: Record<string, unknown> }> {
    const now = Date.now();
    let cached = modelListCache.get(capability);
    if (!cached || cached.expiresAt <= now) {
        const promise = modelsApi.list(capability).then((result) => result.items);
        cached = { expiresAt: now + MODEL_CACHE_MS, promise };
        modelListCache.set(capability, cached);
        promise.catch(() => {
            if (modelListCache.get(capability) === cached) modelListCache.delete(capability);
        });
    }
    const models = [...(await cached.promise)].sort((left, right) => right.priority - left.priority);
    const model = models.find((item) => item.code === modelCode) ?? models.find((item) => item.default_for.includes(capability)) ?? models[0];
    if (!model) throw new Error("暂无支持当前生成能力的模型");
    return { modelCode: model.code, params: paramsForModel(model, current) };
}

function acceptsValue(schema: JsonSchema, value: unknown): boolean {
    if (schema.const !== undefined && value !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) return false;
    if (schema.type === "string") {
        if (typeof value !== "string") return false;
        if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    }
    if (schema.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) return false;
    if (schema.type === "number" && typeof value !== "number") return false;
    if (schema.type === "boolean" && typeof value !== "boolean") return false;
    if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
        if (schema.minimum !== undefined && value < schema.minimum) return false;
        if (schema.maximum !== undefined && value > schema.maximum) return false;
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
        if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return false;
    }
    return true;
}
