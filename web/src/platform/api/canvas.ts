import { api } from "@/platform/http/client";
import { authStore } from "@/platform/auth/store";
import { resolveApiUrl } from "@/platform/http/transport";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

import type { Op, WireOp } from "@/platform/canvas/ops";

export type CanvasLockState = {
    mode: "edit" | "readonly";
    holder: { user_id: string; display_name: string | null } | null;
    holder_since?: string | null;
    expires_at: string | null;
    takeover_request?: { by: { user_id: string; display_name: string | null } | null; requested_at: string } | null;
    lock_lost?: boolean;
    pending?: boolean;
    wait_seconds?: number;
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
    heartbeatLock(id: string, sessionId: string): Promise<CanvasLockState> {
        return api.post(`/canvas/${encodeURIComponent(id)}/lock/heartbeat`, { session_id: sessionId });
    },
    releaseLock(id: string, sessionId: string): Promise<void> {
        return api.request(`/canvas/${encodeURIComponent(id)}/lock`, { method: "DELETE", body: { session_id: sessionId } });
    },
    requestTakeover(id: string, sessionId: string): Promise<CanvasLockState> {
        return api.post(`/canvas/${encodeURIComponent(id)}/lock/takeover`, { session_id: sessionId });
    },
    respondTakeover(id: string, sessionId: string): Promise<CanvasLockState> {
        return api.post(`/canvas/${encodeURIComponent(id)}/lock/takeover/respond`, { session_id: sessionId, action: "continue" });
    },
    releaseLockKeepalive(id: string, sessionId: string): boolean {
        const token = authStore.getState().accessToken;
        if (!token || typeof fetch === "undefined") return false;
        // 页面退出时不能等待刷新 token；使用当前 Bearer token 与 keepalive 让小请求在卸载后继续发送。
        void fetch(resolveApiUrl(`/canvas/${encodeURIComponent(id)}/lock/release`), {
            method: "POST",
            credentials: "include",
            keepalive: true,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
        }).catch(() => undefined);
        return true;
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
