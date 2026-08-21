import { generationErrorText, type GenerationTask, type TrackTaskProgress } from "@/platform/api/generation";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";

export function applyCanvasTaskProgress(node: CanvasNodeData, progress: TrackTaskProgress): CanvasNodeData {
    return {
        ...node,
        metadata: {
            ...node.metadata,
            status: "loading",
            generationStatus: progress.status,
            queuePosition: progress.queue_position,
            generationProgress: progress.progress,
            generationStage: progress.stage,
        },
    };
}

/** 任务进入终态后只移除当前活动 ID，避免后续取消或刷新再次处理历史任务。 */
export function finishCanvasTaskTracking(node: CanvasNodeData, task: GenerationTask): CanvasNodeData {
    const taskIds = (node.metadata?.taskIds ?? []).filter((taskId) => taskId !== task.id);
    const generationTaskSlots = { ...node.metadata?.generationTaskSlots };
    delete generationTaskSlots[task.id];
    return {
        ...node,
        metadata: {
            ...node.metadata,
            taskId: taskIds.at(-1),
            taskIds,
            generationTaskSlots,
            generationStatus: taskIds.length ? node.metadata?.generationStatus : task.status,
        },
    };
}

export function applyCanvasTaskTerminal(node: CanvasNodeData, task: GenerationTask, slotId?: string): CanvasNodeData {
    if (task.status !== "succeeded") {
        const errorDetails = `${generationErrorText(task.error_kind)}，积分已退还`;
        const images = node.metadata?.images?.map((image) => (image.status === "loading" && (!slotId || image.id === slotId) ? { ...image, status: "error" as const, errorDetails } : image));
        const hasPendingImage = images?.some((image) => image.status === "loading") ?? false;
        const hasSuccessfulImage = images?.some((image) => image.status === "success") ?? false;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: hasPendingImage ? "loading" : hasSuccessfulImage ? "success" : "error",
                generationStatus: hasPendingImage ? node.metadata?.generationStatus : task.status,
                errorDetails,
                creditsRefunded: task.credits_refunded ?? task.estimated_credits,
                images,
            },
        };
    }
    const outputs = task.outputs?.filter((output) => output.url) ?? [];
    if (!outputs.length) return node;
    if (node.type === CanvasNodeType.Image) {
        const images: CanvasNodeImage[] = outputs.map((output, index) => ({
            id: output.asset_id,
            status: "success",
            content: output.url!,
            storageKey: output.asset_id,
            naturalWidth: output.width ?? node.width,
            naturalHeight: output.height ?? node.height,
            bytes: 0,
            mimeType: output.mime_type || "image/png",
        }));
        const primary = images[0];
        if (slotId) {
            const nextImages = node.metadata?.images?.map((image) => (image.id === slotId ? { ...primary, id: slotId } : image)) ?? [{ ...primary, id: slotId }];
            const hasPendingImage = nextImages.some((image) => image.status === "loading");
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    status: hasPendingImage ? "loading" : "success",
                    generationStatus: hasPendingImage ? node.metadata?.generationStatus : "succeeded",
                    generationProgress: hasPendingImage ? node.metadata?.generationProgress : 1,
                    content: node.metadata?.content || primary.content,
                    storageKey: node.metadata?.storageKey || primary.storageKey,
                    naturalWidth: node.metadata?.naturalWidth || primary.naturalWidth,
                    naturalHeight: node.metadata?.naturalHeight || primary.naturalHeight,
                    mimeType: node.metadata?.mimeType || primary.mimeType,
                    images: nextImages,
                    primaryImageId: node.metadata?.primaryImageId || slotId,
                    errorDetails: undefined,
                },
            };
        }
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "success",
                generationStatus: "succeeded",
                generationProgress: 1,
                content: primary.content,
                storageKey: primary.storageKey,
                naturalWidth: primary.naturalWidth,
                naturalHeight: primary.naturalHeight,
                mimeType: primary.mimeType,
                images: [...(node.metadata?.images?.filter((image) => image.status === "success") ?? []), ...images],
                primaryImageId: primary.id,
                errorDetails: undefined,
            },
        };
    }
    const output = outputs[0];
    return {
        ...node,
        metadata: {
            ...node.metadata,
            status: "success",
            generationStatus: "succeeded",
            generationProgress: 1,
            content: output.url!,
            storageKey: output.asset_id,
            mimeType: output.mime_type || (node.type === CanvasNodeType.Video ? "video/mp4" : "application/octet-stream"),
            naturalWidth: output.width ?? node.metadata?.naturalWidth,
            naturalHeight: output.height ?? node.metadata?.naturalHeight,
            durationMs: output.duration_ms ?? node.metadata?.durationMs,
            errorDetails: undefined,
        },
    };
}
