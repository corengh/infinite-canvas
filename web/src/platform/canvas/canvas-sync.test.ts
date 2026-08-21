import { performance } from "node:perf_hooks";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canvasApi } from "@/platform/api/canvas";
import { authStore, type AuthResult } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";

import { diffProject } from "./diff";
import { canvasEvents } from "./events";
import { OfflineQueue, type OfflineBatch, type QueueStorage } from "./offline-queue";
import type { Op } from "./ops";
import { SyncEngine } from "./sync-engine";

function node(id: string, x = 0): CanvasNodeData {
    return { id, type: "image", title: id, position: { x, y: 0 }, width: 320, height: 240, metadata: { prompt: "测试", images: [] } };
}

function project(patch: Partial<CanvasProject> = {}): CanvasProject {
    return {
        id: "01911111-1111-7111-8111-111111111111",
        title: "画布",
        createdAt: "2026-08-21T00:00:00Z",
        updatedAt: "2026-08-21T00:00:00Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        ...patch,
    };
}

function memoryQueue(initial: OfflineBatch[] = []) {
    let batches = structuredClone(initial);
    const storage: QueueStorage = {
        load: async () => structuredClone(batches),
        save: async (next) => {
            batches = structuredClone(next);
        },
    };
    return new OfflineQueue(storage);
}

function engineHarness(options: { apply?: (base: number, ops: Op[]) => Promise<any>; queue?: OfflineQueue } = {}) {
    const calls: Array<{ base: number; ops: Op[] }> = [];
    const queue = options.queue ?? memoryQueue();
    const engine = new SyncEngine({
        queue,
        applyOps: async (_id, _session, base, ops) => {
            calls.push({ base, ops });
            return options.apply ? options.apply(base, ops) : { conflict: false, server_version: base + ops.length, applied: ops.map((op) => op.op_id), skipped: [] };
        },
        pullOps: async () => ({ server_version: 0, ops: [], has_more: false, next_since: null }),
        putDocument: async () => ({ conflict: false, server_version: 1, applied: [], skipped: [] }),
    });
    engine.attach(project().id, 0);
    return { engine, calls, queue };
}

afterEach(() => {
    vi.useRealTimers();
    useCanvasStore.setState({ projects: [] });
});

beforeEach(() => authStore.getState().authenticate(authResultFixture as AuthResult));

it("画布 CRUD 与 op 批次严格使用冻结的服务端契约", async () => {
    const id = project().id;
    server.use(
        http.post("http://localhost/api/canvas", async ({ request }) => {
            expect(await request.json()).toEqual({ title: "新画布" });
            return HttpResponse.json({ data: { id, title: "新画布", version: 0 } }, { status: 201 });
        }),
        http.patch("http://localhost/api/canvas/:id", async ({ request }) => {
            expect(await request.json()).toEqual({ title: "重命名" });
            return HttpResponse.json({ data: { id, title: "重命名", version: 0 } });
        }),
        http.delete("http://localhost/api/canvas/:id", () => new HttpResponse(null, { status: 204 })),
        http.post("http://localhost/api/canvas/:id/ops", async ({ request }) => {
            const body = (await request.json()) as any;
            expect(body).toMatchObject({ session_id: expect.any(String), base_version: 3, ops: [{ target_id: "n", type: "node.delete" }] });
            expect(body.ops[0]).not.toHaveProperty("targetId");
            return HttpResponse.json({ data: { conflict: false, server_version: 4, applied: [body.ops[0].op_id], skipped: [] } });
        }),
    );
    await expect(canvasApi.create("新画布")).resolves.toMatchObject({ id, version: 0 });
    await expect(canvasApi.update(id, "重命名")).resolves.toMatchObject({ title: "重命名" });
    await canvasApi.delete(id);
    await expect(canvasApi.applyOps(id, "01911111-1111-7111-8111-111111111112", 3, [{ op_id: "01911111-1111-7111-8111-111111111113", type: "node.delete", targetId: "n", payload: {} }])).resolves.toMatchObject({ server_version: 4 });
});

it("离线队列刷新重建后仍保持批次顺序", async () => {
    let stored: OfflineBatch[] = [];
    const storage: QueueStorage = {
        load: async () => structuredClone(stored),
        save: async (next) => {
            stored = structuredClone(next);
        },
    };
    const first = new OfflineQueue(storage);
    const makeBatch = (id: string): OfflineBatch => ({ id, canvasId: project().id, createdAt: id, ops: [{ op_id: id, type: "node.delete", targetId: id, payload: {} }] });
    await first.push(makeBatch("a"));
    await first.push(makeBatch("b"));
    const reloaded = new OfflineQueue(storage);
    expect((await reloaded.list()).map((batch) => batch.id)).toEqual(["a", "b"]);
    await reloaded.ack("a");
    expect((await reloaded.list()).map((batch) => batch.id)).toEqual(["b"]);
});

it("刷新加载服务端文档时会重放 IndexedDB 中的乐观修改", async () => {
    const canvasId = project().id;
    const queued: OfflineBatch = {
        id: "batch-refresh",
        canvasId,
        createdAt: "2026-08-21T00:00:00Z",
        ops: [{ op_id: "op-refresh", type: "node.create", targetId: "offline-node", payload: { node: node("offline-node", 88) } }],
    };
    const engine = new SyncEngine({
        queue: memoryQueue([queued]),
        applyOps: async () => ({ conflict: false, server_version: 1, applied: [], skipped: [] }),
        pullOps: async () => ({ server_version: 0, ops: [], has_more: false, next_since: null }),
        putDocument: async () => ({ conflict: false, server_version: 1, applied: [], skipped: [] }),
    });

    const restored = await engine.restoreOptimisticProject(canvasId, project());

    expect(restored.nodes).toEqual([node("offline-node", 88)]);
});

describe("画布 diff", () => {
    it("首次服务端灌入不产生操作", () => {
        expect(diffProject(null, project({ nodes: [node("n1")] }))).toEqual([]);
    });

    it("产生六类操作并只发送变化字段与绝对坐标", () => {
        const before = project({
            nodes: [node("move", 1), node("remove")],
            connections: [{ id: "old", fromNodeId: "move", toNodeId: "remove" }],
        });
        const moved = { ...node("move", 99), metadata: before.nodes[0].metadata };
        const after = project({
            title: "新标题",
            nodes: [moved, node("create")],
            connections: [{ id: "new", fromNodeId: "move", toNodeId: "create" }],
            viewport: { x: 10, y: 20, k: 2 },
        });
        const operations = diffProject(before, after);
        expect(operations.map((op) => op.type)).toEqual(["node.update", "node.create", "node.delete", "conn.create", "conn.delete", "meta.update"]);
        expect(operations[0]).toMatchObject({ targetId: "move", payload: { patch: { position: { x: 99, y: 0 } } } });
        expect(Object.keys((operations[0].payload as { patch: object }).patch)).toEqual(["position"]);
    });

    it("metadata 只做一层浅比较，images 数组按 id 比较", () => {
        const image = { id: "asset-1", status: "success" as const, content: "old", storageKey: "asset-1", naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: "image/png" };
        const before = project({ nodes: [{ ...node("n"), metadata: { prompt: "p", images: [image] } }] });
        const sameIds = project({ nodes: [{ ...node("n"), metadata: { prompt: "p", images: [{ ...image, content: "new" }] } }] });
        const changedIds = project({ nodes: [{ ...node("n"), metadata: { prompt: "p", images: [{ ...image, id: "asset-2" }] } }] });
        expect(diffProject(before, sameIds)).toEqual([]);
        expect(diffProject(before, changedIds)[0].type).toBe("node.update");
    });
});

describe("SyncEngine", () => {
    it("拖拽 100 帧折叠为一条 node.update，且入批次后才生成 UUIDv7", async () => {
        vi.useFakeTimers();
        const { engine, calls } = engineHarness();
        let before = project({ nodes: [node("n")] });
        for (let frame = 1; frame <= 100; frame += 1) {
            const next = project({ nodes: [node("n", frame)] });
            engine.onProjectPatched(next.id, before, next);
            before = next;
        }
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].ops).toHaveLength(1);
        expect(calls[0].ops[0]).toMatchObject({ type: "node.update", payload: { patch: { position: { x: 100, y: 0 } } } });
        expect(calls[0].ops[0].op_id[14]).toBe("7");
    });

    it("create 后 delete 在同一合帧内完全抵消", async () => {
        vi.useFakeTimers();
        const { engine, calls } = engineHarness();
        const empty = project();
        const created = project({ nodes: [node("temporary")] });
        engine.onProjectPatched(empty.id, empty, created);
        engine.onProjectPatched(empty.id, created, empty);
        await vi.advanceTimersByTimeAsync(500);
        expect(calls).toEqual([]);
    });

    it("切换画布会先停放旧画布 pending，绝不提交到新画布", async () => {
        vi.useFakeTimers();
        const { engine, calls, queue } = engineHarness();
        const first = project({ nodes: [node("old")] });
        engine.onProjectPatched(first.id, project(), first);
        const secondId = "01922222-2222-7222-8222-222222222222";
        engine.attach(secondId, 0);
        await vi.advanceTimersByTimeAsync(500);
        await vi.waitFor(async () => expect(await queue.count(first.id)).toBe(1));
        expect(calls).toEqual([]);
    });

    it("网络失败保留批次，恢复后按原 op_id 补交且不重复", async () => {
        vi.useFakeTimers();
        let offline = true;
        const seen: string[][] = [];
        const { engine, calls, queue } = engineHarness({
            apply: async (base, ops) => {
                seen.push(ops.map((op) => op.op_id));
                if (offline) throw new ApiError("NETWORK_ERROR", 0, "断网");
                return { conflict: false, server_version: base + ops.length, applied: ops.map((op) => op.op_id), skipped: [] };
            },
        });
        const before = project({ nodes: [node("n")] });
        const after = project({ nodes: [node("n", 5)] });
        engine.onProjectPatched(after.id, before, after);
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(async () => expect(await queue.count(after.id)).toBe(1));
        offline = false;
        await engine.resumeSubmissions();
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(async () => expect(await queue.count(after.id)).toBe(0));
        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual(seen[0]);
    });

    it("401 暂停且保留队列，重登恢复后继续提交", async () => {
        vi.useFakeTimers();
        let unauthorized = true;
        const { engine, calls, queue } = engineHarness({
            apply: async (base, ops) => {
                if (unauthorized) throw new ApiError("UNAUTHORIZED", 401, "登录过期");
                return { conflict: false, server_version: base + 1, applied: [ops[0].op_id], skipped: [] };
            },
        });
        const before = project({ nodes: [node("n")] });
        const after = project({ nodes: [node("n", 2)] });
        engine.onProjectPatched(after.id, before, after);
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(() => expect(engine.getStatus().paused).toBe(true));
        expect(await queue.count(after.id)).toBe(1);
        engine.notifyOnline();
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls).toHaveLength(1);
        unauthorized = false;
        await engine.resumeSubmissions();
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(async () => expect(await queue.count(after.id)).toBe(0));
    });

    it("服务端灌入期间不产生回环操作", async () => {
        vi.useFakeTimers();
        const { engine, calls } = engineHarness();
        engine.setApplyingRemote(true);
        engine.onProjectPatched(project().id, project(), project({ nodes: [node("remote")] }));
        engine.setApplyingRemote(false);
        await vi.advanceTimersByTimeAsync(500);
        expect(calls).toEqual([]);
    });

    it("skipped 重放仍采用服务端版本继续下一批", async () => {
        vi.useFakeTimers();
        let count = 0;
        const { engine, calls } = engineHarness({
            apply: async (base, ops) => {
                count += 1;
                return count === 1 ? { conflict: false, server_version: 9, applied: [], skipped: ops.map((op) => op.op_id) } : { conflict: false, server_version: base + 1, applied: ops.map((op) => op.op_id), skipped: [] };
            },
        });
        const first = project({ nodes: [node("n")] });
        const second = project({ nodes: [node("n", 1)] });
        engine.onProjectPatched(first.id, first, second);
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        const third = project({ nodes: [node("n", 2)] });
        engine.onProjectPatched(first.id, second, third);
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        expect(calls[1].base).toBe(9);
    });

    it("版本冲突时先应用 missed_ops，再覆盖本地乐观修改并按新版本重试", async () => {
        vi.useFakeTimers();
        let count = 0;
        const localBefore = project({ nodes: [node("n", 0)] });
        const localAfter = project({ nodes: [node("n", 8)] });
        useCanvasStore.setState({ projects: [localAfter] });
        let emittedProject: CanvasProject | undefined;
        const unsubscribe = canvasEvents.on("remote-project-applied", (details) => {
            emittedProject = details?.project as CanvasProject | undefined;
        });
        const { engine, calls } = engineHarness({
            apply: async (base, ops) => {
                count += 1;
                if (count === 1) {
                    return {
                        conflict: true,
                        server_version: 6,
                        missed_ops: [{ op_id: "remote", type: "node.update", target_id: "n", payload: { patch: { position: { x: 4, y: 0 } } }, version: 6 }],
                        has_more: false,
                        next_since: null,
                    };
                }
                return { conflict: false, server_version: base + 1, applied: [ops[0].op_id], skipped: [] };
            },
        });
        engine.onProjectPatched(localAfter.id, localBefore, localAfter);
        await vi.advanceTimersByTimeAsync(120);
        await vi.runAllTimersAsync();
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        expect(calls[1].base).toBe(6);
        expect(useCanvasStore.getState().openProject(localAfter.id)?.nodes[0].position.x).toBe(8);
        expect(emittedProject?.nodes[0].position.x).toBe(8);
        unsubscribe();
    });

    it("失去锁后转只读并保留可导出的未保存操作", async () => {
        vi.useFakeTimers();
        const { engine, queue } = engineHarness({
            apply: async () => {
                throw new ApiError("CANVAS_LOCK_NOT_HELD", 409, "锁已失效", { holder: "其他用户" });
            },
        });
        const before = project({ nodes: [node("n")] });
        const after = project({ nodes: [node("n", 7)] });
        engine.onProjectPatched(after.id, before, after);
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(() => expect(engine.getStatus().readonly).toBe(true));
        expect(await queue.count(after.id)).toBe(1);
        expect(await (await engine.exportUnsaved()).text()).toContain("node.update");
    });

    it("画布已删除时停止重试并保留未保存操作", async () => {
        vi.useFakeTimers();
        const { engine, calls, queue } = engineHarness({
            apply: async () => {
                throw new ApiError("CANVAS_NOT_FOUND", 404, "画布不存在");
            },
        });
        const before = project({ nodes: [node("n")] });
        const after = project({ nodes: [node("n", 12)] });
        engine.onProjectPatched(after.id, before, after);
        await vi.advanceTimersByTimeAsync(120);
        await vi.waitFor(() => expect(engine.getStatus().deleted).toBe(true));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls).toHaveLength(1);
        expect(await queue.count(after.id)).toBe(1);
        expect(engine.getStatus().readonly).toBe(true);
    });

    it("切换画布后仍汇总提示旧画布的待同步操作", async () => {
        const firstId = project().id;
        const secondId = "01922222-2222-7222-8222-222222222222";
        const queue = memoryQueue([
            {
                id: "parked",
                canvasId: firstId,
                createdAt: "2026-08-21T00:00:00Z",
                ops: [{ op_id: "parked-op", type: "node.delete", targetId: "n", payload: {} }],
            },
        ]);
        const engine = new SyncEngine({
            queue,
            applyOps: async () => ({ conflict: false, server_version: 1, applied: [], skipped: [] }),
            pullOps: async () => ({ server_version: 0, ops: [], has_more: false, next_since: null }),
            putDocument: async () => ({ conflict: false, server_version: 1, applied: [], skipped: [] }),
        });

        engine.attach(secondId, 0);

        await vi.waitFor(() => expect(engine.getStatus().otherCanvasPendingCount).toBe(1));
        expect(engine.getStatus().pendingCount).toBe(1);
        expect(engine.getStatus().otherCanvasIds).toEqual([firstId]);
        expect(await (await engine.exportUnsaved()).text()).toContain("parked-op");
    });
});

it("批量删除部分失败时立即移除已在服务端删除的画布", async () => {
    const firstId = "01911111-1111-7111-8111-111111111121";
    const failedId = "01911111-1111-7111-8111-111111111122";
    const thirdId = "01911111-1111-7111-8111-111111111123";
    useCanvasStore.setState({ projects: [project({ id: firstId }), project({ id: failedId }), project({ id: thirdId })] });
    server.use(
        http.delete(`http://localhost/api/canvas/${firstId}`, () => new HttpResponse(null, { status: 204 })),
        http.delete(`http://localhost/api/canvas/${failedId}`, () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "暂时失败" } }, { status: 500 })),
        http.delete(`http://localhost/api/canvas/${thirdId}`, () => new HttpResponse(null, { status: 204 })),
    );

    await expect(useCanvasStore.getState().deleteProjects([firstId, failedId, thirdId])).rejects.toThrow("2 个已删除，1 个删除失败");

    expect(useCanvasStore.getState().projects.map((item) => item.id)).toEqual([failedId]);
});

it("500 节点拖拽 diff 的 P95 小于 8ms", () => {
    const before = project({ nodes: Array.from({ length: 500 }, (_, index) => node(`n-${index}`, index)) });
    const after = project({ nodes: before.nodes.map((item, index) => (index === 250 ? { ...item, position: { x: 999, y: 888 } } : item)) });
    const durations = Array.from({ length: 50 }, () => {
        const started = performance.now();
        diffProject(before, after);
        return performance.now() - started;
    }).sort((left, right) => left - right);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(8);
});
