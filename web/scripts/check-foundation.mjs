import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = join(webRoot, "src");
const forbidden = ["evaluate" + "PluginSource", "install" + "PluginFromUrl", "PLUGIN" + "_REGISTRY_URL"];
const violations = [];
const pluginStoreImports = [];

// 递归扫描源码，确保上游合并时不会悄悄恢复远程下载与执行入口。
function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
            const content = readFileSync(path, "utf8");
            for (const token of forbidden) if (content.includes(token)) violations.push(`${relative(webRoot, path)}: ${token}`);
            if (!path.endsWith("use-plugin-store.ts") && content.includes("use-plugin-store")) pluginStoreImports.push(relative(webRoot, path));
        }
    }
}

walk(sourceRoot);

const requiredPaths = [
    "src/platform/http/index.ts",
    "src/platform/auth/index.ts",
    "src/platform/api/index.ts",
    "src/platform/canvas/index.ts",
    "src/platform/generation/index.ts",
    "src/platform/components/index.ts",
    "src/platform/config.ts",
    "src/platform/runtime.ts",
];

for (const path of requiredPaths) if (!existsSync(join(webRoot, path))) violations.push(`缺少平台骨架：${path}`);
if (existsSync(join(sourceRoot, "components/canvas/canvas-plugin-manager-modal.tsx"))) violations.push("插件管理弹窗仍然存在");
if (pluginStoreImports.length) violations.push(`插件 store 仍被运行时代码加载：${pluginStoreImports.join(", ")}`);

const pluginLoader = readFileSync(join(sourceRoot, "lib/canvas/plugin-loader.ts"), "utf8");
if (!pluginLoader.includes("[PLATFORM] 远程插件加载已按 proposal §9.4 移除")) violations.push("plugin-loader 缺少安全标记注释");
if (!pluginLoader.includes("export function activatePlugin") || !pluginLoader.includes("export function deactivatePlugin")) violations.push("静态插件注册能力未完整保留");

const platformCanvas = readFileSync(join(sourceRoot, "platform/canvas/index.ts"), "utf8");
if (!platformCanvas.includes("插件 store 明确不进入同步范围")) violations.push("画布同步骨架未明确排除插件 store");

if (violations.length) {
    console.error(violations.join("\n"));
    process.exit(1);
}

console.log("FE-0 M0 工程守卫通过");
