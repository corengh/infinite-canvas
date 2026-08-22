import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
if (existsSync(join(sourceRoot, "services/app-sync.ts")) || existsSync(join(sourceRoot, "services/webdav-sync.ts"))) violations.push("WebDAV 同步服务仍然存在");
if (pluginStoreImports.length) violations.push(`插件 store 仍被运行时代码加载：${pluginStoreImports.join(", ")}`);

const router = readFileSync(join(sourceRoot, "router.tsx"), "utf8");
if (/path\s*:\s*["']\/(?:image|video)["']/.test(router)) violations.push("图片或视频工作台路由仍然可达");

const configStore = readFileSync(join(sourceRoot, "stores/use-config-store.ts"), "utf8");
if (configStore.includes("WebdavSyncConfig") || configStore.includes("updateWebdavConfig")) violations.push("WebDAV 凭据状态仍然存在");

const userLayout = readFileSync(join(sourceRoot, "layouts/user-layout.tsx"), "utf8");
const appTopNav = readFileSync(join(sourceRoot, "components/layout/app-top-nav.tsx"), "utf8");
const canvasTopBar = readFileSync(join(sourceRoot, "components/canvas/canvas-top-bar.tsx"), "utf8");
if (userLayout.includes("AgentPanel") || appTopNav.includes("useAgentStore") || canvasTopBar.includes("onToggleAgent")) violations.push("本地 Canvas Agent 入口或连接挂载仍然可达");

const canvasNode = readFileSync(join(sourceRoot, "components/canvas/canvas-node.tsx"), "utf8");
const canvasNodeHoverToolbar = readFileSync(join(sourceRoot, "components/canvas/canvas-node-hover-toolbar.tsx"), "utf8");
const canvasProject = readFileSync(join(sourceRoot, "pages/canvas/project.tsx"), "utf8");
if (
    !canvasNode.includes("接缝 #18") ||
    !canvasNode.includes("data.type !== CanvasNodeType.Audio") ||
    !canvasNode.includes("props.node.type === CanvasNodeType.Audio ? undefined : props.onRetry") ||
    !canvasNodeHoverToolbar.includes('const canRetry = !isAudio && node.metadata?.status === "error"') ||
    !canvasProject.includes("if (node.type === CanvasNodeType.Audio) return")
)
    violations.push("Audio 生成或重试入口未按 D-17 完整隐藏");

const seamCount = countPlatformMarkers(sourceRoot);
if (seamCount !== 18) violations.push(`[PLATFORM] 接缝标记应为 18 处，当前为 ${seamCount} 处`);

const pluginLoader = readFileSync(join(sourceRoot, "lib/canvas/plugin-loader.ts"), "utf8");
if (!pluginLoader.includes("[PLATFORM] 远程插件加载已按 proposal §9.4 移除")) violations.push("plugin-loader 缺少安全标记注释");
if (!pluginLoader.includes("export function activatePlugin") || !pluginLoader.includes("export function deactivatePlugin")) violations.push("静态插件注册能力未完整保留");

const platformCanvas = readFileSync(join(sourceRoot, "platform/canvas/index.ts"), "utf8");
if (!platformCanvas.includes("插件 store 明确不进入同步范围")) violations.push("画布同步骨架未明确排除插件 store");

if (violations.length) {
    console.error(violations.join("\n"));
    process.exit(1);
}

warnLargeBaseDiff();
console.log("FE-0 工程守卫通过");

function countPlatformMarkers(directory) {
    let count = 0;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) count += countPlatformMarkers(path);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) count += readFileSync(path, "utf8").split("[PLATFORM]").length - 1;
    }
    return count;
}

function warnLargeBaseDiff() {
    const base = process.env.FOUNDATION_DIFF_BASE?.trim();
    if (!base || /^0+$/.test(base)) return;
    try {
        const output = execFileSync("git", ["diff", "--numstat", base, "HEAD", "--", "src"], { cwd: webRoot, encoding: "utf8" });
        const changedLines = output
            .trim()
            .split("\n")
            .filter(Boolean)
            .reduce((total, line) => {
                const [added, removed, path] = line.split("\t");
                // Git 即使从 web/ 目录执行也可能返回 web/src/...，先统一为相对 web/ 的路径再分类。
                const normalizedPath = path.replace(/^web\//, "");
                if (normalizedPath === "src/platform" || normalizedPath.startsWith("src/platform/")) return total;
                return total + (Number(added) || 0) + (Number(removed) || 0);
            }, 0);
        if (changedLines > 500) console.warn(`::warning::web/src 非 platform 目录改动 ${changedLines} 行，超过 D-16 的 500 行提醒阈值`);
    } catch (error) {
        console.warn(`::warning::无法统计 D-16 改动行数：${error instanceof Error ? error.message : String(error)}`);
    }
}
