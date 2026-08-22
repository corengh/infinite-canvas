import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localeFiles = {
    "zh-CN": resolve(webRoot, "src/i18n/locales/zh-CN.ts"),
    "en-US": resolve(webRoot, "src/i18n/locales/en-US.ts"),
};

// 只比较对象叶子路径，不比较译文；这样新增嵌套命名空间时也不会漏掉任一语言。
function localeKeys(path) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const assignment = source.statements.find(ts.isExportAssignment);
    if (!assignment || !ts.isObjectLiteralExpression(assignment.expression)) throw new Error(`${path} 必须默认导出对象字面量`);

    const keys = new Set();
    visitObject(assignment.expression, "", keys, path);
    return keys;
}

function visitObject(object, prefix, keys, path) {
    for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error(`${path} 仅允许可静态检查的翻译属性`);
        const name = propertyName(property.name, path);
        const key = prefix ? `${prefix}.${name}` : name;
        if (ts.isObjectLiteralExpression(property.initializer)) visitObject(property.initializer, key, keys, path);
        else keys.add(key);
    }
}

function propertyName(name, path) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    throw new Error(`${path} 包含无法静态检查的翻译 key`);
}

const zhKeys = localeKeys(localeFiles["zh-CN"]);
const enKeys = localeKeys(localeFiles["en-US"]);
const onlyZh = [...zhKeys].filter((key) => !enKeys.has(key)).sort();
const onlyEn = [...enKeys].filter((key) => !zhKeys.has(key)).sort();
const requiredPlatformKeys = ["platform.foundation.runtimeConfig", "platform.foundation.remotePluginsDisabled"];
const missingPlatformKeys = requiredPlatformKeys.filter((key) => !zhKeys.has(key) || !enKeys.has(key));

if (onlyZh.length || onlyEn.length || missingPlatformKeys.length) {
    if (onlyZh.length) console.error(`仅 zh-CN 存在：\n${onlyZh.join("\n")}`);
    if (onlyEn.length) console.error(`仅 en-US 存在：\n${onlyEn.join("\n")}`);
    if (missingPlatformKeys.length) console.error(`缺少 platform 命名空间 key：\n${missingPlatformKeys.join("\n")}`);
    process.exit(1);
}

console.log(`i18n key 集合一致（${zhKeys.size} 个叶子 key）`);
