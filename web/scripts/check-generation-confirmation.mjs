import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "src");
const allowed = new Set(["platform/api/generation.ts", "platform/generation/confirmed-submit.ts"]);
const failures = [];

function visit(directory) {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (/\.[cm]?[jt]sx?$/.test(name)) {
            const local = relative(root, path).replaceAll("\\", "/");
            if (!allowed.has(local) && /\bsubmitGeneration\s*\(/.test(readFileSync(path, "utf8"))) failures.push(local);
        }
    }
}

visit(root);
if (failures.length) {
    console.error(`以下文件绕过了 confirmGeneration：\n${failures.join("\n")}`);
    process.exit(1);
}
