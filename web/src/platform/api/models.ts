import { api } from "@/platform/http/client";

export type ModelCapability = "text2image" | "image2image" | "text2video" | "image2video" | "text" | "audio";

export type JsonSchema = {
    type?: "object" | "string" | "number" | "integer" | "boolean";
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
    const?: unknown;
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    minLength?: number;
    maxLength?: number;
    properties?: Record<string, JsonSchema>;
    required?: string[];
};

export type ModelPricing = {
    mode: "per_call" | "per_second" | "per_megapixel" | "per_token";
    display: string;
    base_price: string;
};

export type ModelDTO = {
    code: string;
    name: string;
    description: string | null;
    capabilities: ModelCapability[];
    pricing: ModelPricing | null;
    params_schema: JsonSchema;
    defaults: Record<string, unknown>;
    priority: number;
    enabled: boolean;
    is_default: boolean;
    default_for: ModelCapability[];
};

export const modelsApi = {
    list: (capability?: ModelCapability) => api.get<{ items: ModelDTO[] }>(`/models${capability ? `?capability=${encodeURIComponent(capability)}` : ""}`),
    detail: (code: string) => api.get<ModelDTO>(`/models/${encodeURIComponent(code)}`),
};
