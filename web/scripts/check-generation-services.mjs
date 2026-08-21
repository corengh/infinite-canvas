import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "src/services/api");
const expected = {
    "image.ts": ["AiTextMessage", "requestGeneration", "requestEdit", "requestImageQuestion", "fetchImageModels", "fetchChannelModels"],
    "video.ts": ["VideoGenerationResult", "VideoGenerationTask", "VideoGenerationTaskState", "requestVideoGeneration", "createVideoGenerationTask", "pollVideoGenerationTask", "storeGeneratedVideo"],
    "audio.ts": ["requestAudioGeneration", "storeGeneratedAudio"],
};
const forbidden = [/\baxios\b/, /runModelPlugin/, /buildApiUrl/, /\.apiKey\b/, /Authorization\s*:/];
const failures = [];

for (const [file, names] of Object.entries(expected)) {
    const source = readFileSync(resolve(root, file), "utf8");
    const exports = [...source.matchAll(/export\s+(?:async\s+function|function|const|type|interface|class)\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    if (JSON.stringify(exports.sort()) !== JSON.stringify([...names].sort())) failures.push(`${file} 导出签名不一致：${exports.join(", ")}`);
    forbidden.forEach((pattern) => {
        if (pattern.test(source)) failures.push(`${file} 仍包含供应商直连路径：${pattern}`);
    });
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
