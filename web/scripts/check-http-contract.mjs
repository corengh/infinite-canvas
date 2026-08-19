import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

const root = new URL("../src/platform/", import.meta.url).pathname;
const sourceFiles = [];

function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path);
        else if ([".ts", ".tsx"].includes(extname(path)) && !path.endsWith(".test.ts")) sourceFiles.push(path);
    }
}

function containsMessageAccess(node) {
    // `typeof envelope.message === "string"` 只是契约解析；仅禁止拿文案值决定业务分支。
    if (ts.isPropertyAccessExpression(node) && node.name.text === "message") return !ts.isTypeOfExpression(node.parent);
    return node.getChildren().some(containsMessageAccess);
}

function checkNode(node, sourceFile, failures) {
    const condition = ts.isIfStatement(node)
        ? node.expression
        : ts.isSwitchStatement(node)
          ? node.expression
          : ts.isConditionalExpression(node)
            ? node.condition
            : ts.isWhileStatement(node) || ts.isDoStatement(node)
              ? node.expression
              : ts.isForStatement(node)
                ? node.condition
                : undefined;
    if (condition && containsMessageAccess(condition)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(condition.getStart(sourceFile));
        failures.push(`${sourceFile.fileName}:${line + 1}`);
    }
    ts.forEachChild(node, (child) => checkNode(child, sourceFile, failures));
}

collect(root);
const failures = [];
for (const path of sourceFiles) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    checkNode(source, source, failures);
}

if (failures.length) {
    console.error(`禁止按 API message 做条件分支，请改用稳定 code：\n${failures.join("\n")}`);
    process.exit(1);
}
console.log(`HTTP 契约守卫通过：检查 ${sourceFiles.length} 个 platform 源文件，未发现 message 分支。`);
