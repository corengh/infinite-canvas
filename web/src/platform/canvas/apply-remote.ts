import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

import type { CanvasRemoteOp } from "@/platform/api/canvas";

export function applyRemoteOps(project: CanvasProject, operations: CanvasRemoteOp[]): CanvasProject {
    return operations.reduce<CanvasProject>((current, operation) => {
        if (operation.type === "node.create") {
            const node = (operation.payload as { node: CanvasProject["nodes"][number] }).node;
            return { ...current, nodes: [...current.nodes.filter((item) => item.id !== node.id), node] };
        }
        if (operation.type === "node.update") {
            const payload = operation.payload as { patch: Partial<CanvasProject["nodes"][number]>; replace_metadata?: boolean };
            return {
                ...current,
                nodes: current.nodes.map((node) => {
                    if (node.id !== operation.target_id) return node;
                    const metadata = payload.patch.metadata ? (payload.replace_metadata ? payload.patch.metadata : { ...node.metadata, ...payload.patch.metadata }) : node.metadata;
                    return { ...node, ...payload.patch, metadata };
                }),
            };
        }
        if (operation.type === "node.delete") {
            return {
                ...current,
                nodes: current.nodes.filter((node) => node.id !== operation.target_id),
                connections: current.connections.filter((connection) => connection.fromNodeId !== operation.target_id && connection.toNodeId !== operation.target_id),
            };
        }
        if (operation.type === "conn.create") {
            const endpoints = operation.payload as { fromNodeId: string; toNodeId: string };
            return { ...current, connections: [...current.connections.filter((item) => item.id !== operation.target_id), { id: operation.target_id!, ...endpoints }] };
        }
        if (operation.type === "conn.delete") return { ...current, connections: current.connections.filter((item) => item.id !== operation.target_id) };
        const meta = operation.payload as { title?: string; background_mode?: CanvasProject["backgroundMode"]; show_image_info?: boolean; viewport?: CanvasProject["viewport"] };
        return {
            ...current,
            title: meta.title ?? current.title,
            backgroundMode: meta.background_mode ?? current.backgroundMode,
            showImageInfo: meta.show_image_info ?? current.showImageInfo,
            viewport: meta.viewport ?? current.viewport,
        };
    }, project);
}
