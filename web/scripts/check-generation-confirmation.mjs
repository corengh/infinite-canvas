import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "src");
// legacy-adapter 是三个基座 service 的唯一提交接缝，内部强制经 runConfirmedGeneration。
const allowed = new Set(["platform/api/generation.ts", "platform/generation/confirmed-submit.ts", "platform/generation/legacy-adapter.ts"]);
const failures = [];

function visit(directory) {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (/\.[cm]?[jt]sx?$/.test(name)) {
            const local = relative(root, path).replaceAll("\\", "/");
            if (!local.endsWith(".test.ts") && !local.endsWith(".test.tsx") && !allowed.has(local) && /\bsubmitGeneration\s*\(/.test(readFileSync(path, "utf8"))) failures.push(local);
        }
    }
}

visit(root);
if (failures.length) {
    console.error(`以下文件绕过了 confirmGeneration：\n${failures.join("\n")}`);
    process.exit(1);
}
