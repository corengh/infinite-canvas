import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasToolRequest } from "./operations.js";
import { toolNames } from "./schemas.js";

test("生成流程直接创建真实目标节点且不再暴露 Config 工具", () => {
    const request = buildCanvasToolRequest("canvas_generate_image", { prompt: "电影感封面", autoRun: true }, null);
    const ops = request.input.ops as Array<Record<string, unknown>>;
    const added = ops.filter((op) => op.type === "add_node");

    assert.equal((toolNames as readonly string[]).includes("canvas_create_config_node"), false);
    assert.deepEqual(
        added.map((op) => op.nodeType),
        ["text", "image"],
    );
    assert.equal(
        ops.some((op) => op.nodeType === "config"),
        false,
    );

    const targetId = String(added[1].id);
    assert.equal(
        ops.some((op) => op.type === "connect_nodes" && op.toNodeId === targetId),
        true,
    );
    assert.equal(
        ops.some((op) => op.type === "run_generation" && op.nodeId === targetId),
        true,
    );
});
