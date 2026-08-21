import { api } from "@/platform/http/client";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

import type { Op, WireOp } from "@/platform/canvas/ops";

export type CanvasLockState = {
    mode: "edit" | "readonly";
    holder: { user_id: string; display_name: string | null } | null;
    expires_at: string | null;
};

export type CanvasSummary = {
    id: string;
    title: string;
    version: number;
    node_count: number;
    updated_at: string;
    lock: { locked: boolean; holder: CanvasLockState["holder"]; expires_at: string | null };
};

export type CanvasDocument = {
    canvas: {
        id: string;
        title: string;
        version: number;
        background_mode: string;
        show_image_info: boolean;
        viewport: ViewportTransform;
    };
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    version: number;
    lock: CanvasLockState;
    partial: boolean;
};

export type CanvasRemoteOp = WireOp & { version?: number };
export type ApplyOpsResult = { conflict: false; server_version: number; applied: string[]; skipped: string[] } | { conflict: true; server_version: number; missed_ops: CanvasRemoteOp[]; has_more: boolean; next_since: number | null };

export const canvasApi = {
    list(cursor?: string): Promise<{ items: CanvasSummary[]; next_cursor: string | null; has_more: boolean }> {
        return api.get(`/canvas${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    },
    create(title: string): Promise<{ id: string; title: string; version: number }> {
        return api.post("/canvas", { title });
    },
    update(id: string, title: string): Promise<{ id: string; title: string; version: number }> {
        return api.patch(`/canvas/${encodeURIComponent(id)}`, { title });
    },
    delete(id: string): Promise<void> {
        return api.delete(`/canvas/${encodeURIComponent(id)}`);
    },
    load(id: string, sessionId?: string, signal?: AbortSignal): Promise<CanvasDocument> {
        const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
        return api.get(`/canvas/${encodeURIComponent(id)}${query}`, { signal });
    },
    acquireLock(id: string, sessionId: string, signal?: AbortSignal): Promise<CanvasLockState> {
        return api.post(`/canvas/${encodeURIComponent(id)}/lock`, { session_id: sessionId }, { signal });
    },
    applyOps(id: string, sessionId: string, baseVersion: number, ops: Op[]): Promise<ApplyOpsResult> {
        return api.post(`/canvas/${encodeURIComponent(id)}/ops`, {
            session_id: sessionId,
            base_version: baseVersion,
            ops: ops.map(({ targetId, ...item }) => ({ ...item, target_id: targetId })),
        });
    },
    pullOps(id: string, since: number): Promise<{ server_version: number; ops: CanvasRemoteOp[]; has_more: boolean; next_since: number | null }> {
        return api.get(`/canvas/${encodeURIComponent(id)}/ops?since=${since}`);
    },
    putDocument(id: string, body: unknown): Promise<ApplyOpsResult> {
        return api.request(`/canvas/${encodeURIComponent(id)}/document`, { method: "PUT", body });
    },
};
