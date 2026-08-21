import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

import type { DraftOp } from "./ops";

function samePosition(left: CanvasNodeData["position"], right: CanvasNodeData["position"]): boolean {
    return left.x === right.x && left.y === right.y;
}

function sameImages(left: CanvasNodeMetadata["images"], right: CanvasNodeMetadata["images"]): boolean {
    if (left === right) return true;
    if (!left || !right || left.length !== right.length) return false;
    return left.every((image, index) => image.id === right[index]?.id);
}

function shallowEqualMetadata(left?: CanvasNodeMetadata, right?: CanvasNodeMetadata): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (key === "images") {
            if (!sameImages(left.images, right.images)) return false;
        } else if (left[key as keyof CanvasNodeMetadata] !== right[key as keyof CanvasNodeMetadata]) return false;
    }
    return true;
}

export function shallowEqualNode(left: CanvasNodeData, right: CanvasNodeData): boolean {
    return left.type === right.type && left.title === right.title && samePosition(left.position, right.position) && left.width === right.width && left.height === right.height && shallowEqualMetadata(left.metadata, right.metadata);
}

export function nodeDelta(previous: CanvasNodeData, next: CanvasNodeData): Partial<CanvasNodeData> {
    const patch: Partial<CanvasNodeData> = {};
    if (previous.type !== next.type) patch.type = next.type;
    if (previous.title !== next.title) patch.title = next.title;
    // 坐标始终发送 next 的绝对值，禁止把拖拽位移量写进 op-log。
    if (!samePosition(previous.position, next.position)) patch.position = next.position;
    if (previous.width !== next.width) patch.width = next.width;
    if (previous.height !== next.height) patch.height = next.height;
    if (!shallowEqualMetadata(previous.metadata, next.metadata)) patch.metadata = next.metadata ?? {};
    return patch;
}

export function diffProject(previous: CanvasProject | null, next: CanvasProject): DraftOp[] {
    if (!previous) return [];
    const result: DraftOp[] = [];
    const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
    for (const node of next.nodes) {
        const before = previousNodes.get(node.id);
        if (!before) result.push({ type: "node.create", targetId: node.id, payload: { node } });
        else if (!shallowEqualNode(before, node)) {
            const patch = nodeDelta(before, node);
            result.push({ type: "node.update", targetId: node.id, payload: { patch, replace_metadata: "metadata" in patch || undefined } });
        }
    }
    previous.nodes.forEach((node) => {
        if (!nextNodes.has(node.id)) result.push({ type: "node.delete", targetId: node.id, payload: {} });
    });

    const previousConnections = new Map(previous.connections.map((connection) => [connection.id, connection]));
    const nextConnections = new Map(next.connections.map((connection) => [connection.id, connection]));
    for (const connection of next.connections) {
        const before = previousConnections.get(connection.id);
        if (before && before.fromNodeId === connection.fromNodeId && before.toNodeId === connection.toNodeId) continue;
        if (before) result.push({ type: "conn.delete", targetId: connection.id, payload: {} });
        result.push({ type: "conn.create", targetId: connection.id, payload: { fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId } });
    }
    previous.connections.forEach((connection) => {
        if (!nextConnections.has(connection.id)) result.push({ type: "conn.delete", targetId: connection.id, payload: {} });
    });

    const meta: Record<string, unknown> = {};
    if (previous.title !== next.title) meta.title = next.title;
    if (previous.backgroundMode !== next.backgroundMode) meta.background_mode = next.backgroundMode;
    if (previous.showImageInfo !== next.showImageInfo) meta.show_image_info = next.showImageInfo;
    if (previous.viewport.x !== next.viewport.x || previous.viewport.y !== next.viewport.y || previous.viewport.k !== next.viewport.k) meta.viewport = next.viewport;
    if (Object.keys(meta).length) result.push({ type: "meta.update", targetId: null, payload: meta });
    return result;
}
