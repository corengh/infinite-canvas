import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasOpType = "node.create" | "node.update" | "node.delete" | "conn.create" | "conn.delete" | "meta.update";

type NodeCreatePayload = { node: CanvasNodeData };
type NodeUpdatePayload = { patch: Partial<CanvasNodeData>; replace_metadata?: boolean };
type ConnectionCreatePayload = Pick<CanvasConnection, "fromNodeId" | "toNodeId">;
type MetaUpdatePayload = {
    title?: string;
    background_mode?: string;
    show_image_info?: boolean;
    viewport?: ViewportTransform;
};

export type OpPayload = NodeCreatePayload | NodeUpdatePayload | ConnectionCreatePayload | MetaUpdatePayload | Record<string, never>;

/** diff 阶段不分配 op_id；只有折叠完成、批次即将持久化时才生成。 */
export type DraftOp = {
    type: CanvasOpType;
    targetId: string | null;
    payload: OpPayload;
};

export type Op = DraftOp & { op_id: string };

export type WireOp = {
    op_id: string;
    type: CanvasOpType;
    target_id: string | null;
    payload: OpPayload;
};

export function opKey(op: DraftOp): string {
    return op.type === "meta.update" ? "meta" : `${op.type.split(".")[0]}:${op.targetId}`;
}

export function toWireOp(op: Op): WireOp {
    return { op_id: op.op_id, type: op.type, target_id: op.targetId, payload: op.payload };
}

function mergeNodeCreate(create: DraftOp, update: DraftOp): DraftOp {
    const node = (create.payload as NodeCreatePayload).node;
    const patch = (update.payload as NodeUpdatePayload).patch;
    return { ...create, payload: { node: { ...node, ...patch } } };
}

/** 返回 null 表示两条操作净效果为零，应从 pending 中删除。 */
export function mergeOps(previous: DraftOp, next: DraftOp): DraftOp | null {
    if (previous.type === "node.create" && next.type === "node.update") return mergeNodeCreate(previous, next);
    if (previous.type === "node.create" && next.type === "node.delete") return null;
    if (previous.type === "node.update" && next.type === "node.update") {
        const before = previous.payload as NodeUpdatePayload;
        const after = next.payload as NodeUpdatePayload;
        return {
            ...next,
            payload: {
                patch: { ...before.patch, ...after.patch },
                replace_metadata: before.replace_metadata || after.replace_metadata || undefined,
            },
        };
    }
    if (previous.type === "node.update" && next.type === "node.delete") return next;
    if (previous.type === "conn.create" && next.type === "conn.delete") return null;
    if (previous.type === "meta.update" && next.type === "meta.update") return { ...next, payload: { ...previous.payload, ...next.payload } };
    return next;
}
