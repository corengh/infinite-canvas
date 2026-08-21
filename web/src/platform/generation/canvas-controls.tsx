import type { ModelCapability } from "@/platform/api/models";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { EstimateDisplay } from "./estimate";
import { ModelSelector } from "./model-selector";

export function capabilityForCanvas(mode: CanvasGenerationMode, hasImageReference: boolean): ModelCapability {
    if (mode === "image") return hasImageReference ? "image2image" : "text2image";
    if (mode === "video") return hasImageReference ? "image2video" : "text2video";
    return mode;
}

export function CanvasGenerationControls({
    node,
    mode,
    prompt,
    hasImageReference,
    onChange,
    onAvailabilityChange,
    compact = false,
}: {
    node: CanvasNodeData;
    mode: CanvasGenerationMode;
    prompt: string;
    hasImageReference: boolean;
    onChange: (patch: Partial<CanvasNodeMetadata>) => void;
    onAvailabilityChange?: (available: boolean) => void;
    compact?: boolean;
}) {
    const capability = capabilityForCanvas(mode, hasImageReference);
    const params = canvasGenerationParams(node, prompt);
    const modelCode = node.metadata?.model;
    return (
        <div className="min-w-0 flex-1">
            <ModelSelector capability={capability} value={modelCode} params={params} compact={compact} onAvailabilityChange={onAvailabilityChange} onChange={(model, nextParams) => onChange(metadataPatch(model, nextParams))} />
            {!compact ? (
                <div className="mt-2">
                    <EstimateDisplay input={modelCode && prompt.trim() ? { capability, model_code: modelCode, params } : null} />
                </div>
            ) : null}
        </div>
    );
}

export function canvasGenerationParams(node: CanvasNodeData, prompt: string): Record<string, unknown> {
    return {
        ...node.metadata?.generationParams,
        ...(node.metadata?.quality ? { quality: node.metadata.quality } : {}),
        ...(node.metadata?.size ? { size: node.metadata.size } : {}),
        ...(node.metadata?.seconds ? { seconds: Number(node.metadata.seconds) } : {}),
        ...(node.metadata?.count ? { count: node.metadata.count } : {}),
        prompt,
    };
}

function metadataPatch(model: string, params: Record<string, unknown>): Partial<CanvasNodeMetadata> {
    return {
        model,
        generationParams: params,
        ...(typeof params.quality === "string" ? { quality: params.quality } : {}),
        ...(typeof params.size === "string" ? { size: params.size } : {}),
        ...(typeof params.seconds === "number" ? { seconds: String(params.seconds) } : {}),
        ...(typeof params.count === "number" ? { count: params.count } : {}),
    };
}
