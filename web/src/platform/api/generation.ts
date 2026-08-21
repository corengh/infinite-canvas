import { api } from "@/platform/http/client";
import type { ModelCapability } from "./models";

export type GenerationEstimateInput = {
    capability: ModelCapability;
    model_code: string;
    params: Record<string, unknown>;
};

export type GenerationEstimate = {
    credits: number;
    available: number;
    after: number;
    sufficient: boolean;
    requires_confirmation: boolean;
    pricing_version_id: string;
    breakdown: {
        base: string;
        units: string;
        quality: string;
        resolution: string;
        duration: string;
        discount: string;
    };
};

export const estimateGeneration = (input: GenerationEstimateInput) => api.post<GenerationEstimate>("/generation/estimate", input);
