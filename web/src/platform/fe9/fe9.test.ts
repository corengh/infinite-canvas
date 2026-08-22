import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appsApi } from "@/platform/api/apps";
import { assetsApi, uploadAsset, type AssetDTO } from "@/platform/api/assets";
import { authApi } from "@/platform/auth/api";
import { authStore, type AuthResult } from "@/platform/auth/store";
import { platformModelCode } from "@/platform/generation/legacy-adapter";
import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import { applyServerPreferences } from "@/platform/initialize";
import { assetFromDto, useAssetStore } from "@/stores/use-asset-store";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

const dto = (id: string, expiresAt = "2026-08-22T01:10:00Z"): AssetDTO => ({
    id,
    kind: "image",
    filename: `${id}.png`,
    mime_type: "image/png",
    bytes: 8,
    width: 1,
    height: 1,
    duration_ms: null,
    visibility: "private",
    owner: { id: "user-1" },
    source: "uploaded",
    task_id: null,
    status: "ready",
    url: `https://assets.test/${id}`,
    url_expires_at: expiresAt,
    created_at: "2026-08-22T01:00:00Z",
});

describe("FE-9 资产、配置与首页契约", () => {
    beforeEach(() => {
        authStore.getState().authenticate(authResultFixture as AuthResult);
        useAssetStore.setState({ assets: [], nextCursor: null, loading: false });
        useConfigStore.setState({ config: { ...defaultConfig, defaultModels: {} } });
    });

    it("资产列表把游标和三类筛选交给服务端", async () => {
        server.use(
            http.get("http://localhost/api/assets", ({ request }) => {
                const query = new URL(request.url).searchParams;
                expect(Object.fromEntries(query)).toEqual({ kind: "image", visibility: "team", owner: "user-1", cursor: "cursor-1", limit: "40" });
                return HttpResponse.json({ data: { items: [dto("asset-1")], next_cursor: "cursor-2" } });
            }),
        );
        await expect(assetsApi.list({ kind: "image", visibility: "team", owner: "user-1", cursor: "cursor-1", limit: 40 })).resolves.toMatchObject({ next_cursor: "cursor-2" });
    });

    it("一屏多张资产只发一次批量续签请求", async () => {
        vi.setSystemTime("2026-08-22T01:08:00Z");
        let requests = 0;
        server.use(
            http.post("http://localhost/api/assets/urls", async ({ request }) => {
                requests += 1;
                expect(await request.json()).toEqual({ asset_ids: ["asset-1", "asset-2"] });
                return HttpResponse.json({ data: { urls: { "asset-1": { url: "https://assets.test/new-1", expires_at: "2026-08-22T01:23:00Z" }, "asset-2": { url: "https://assets.test/new-2", expires_at: "2026-08-22T01:23:00Z" } } } });
            }),
        );
        useAssetStore.setState({ assets: [assetFromDto(dto("asset-1")), assetFromDto(dto("asset-2"))] });
        await useAssetStore.getState().refreshExpiringUrls();
        expect(requests).toBe(1);
        expect(useAssetStore.getState().assets.map((item) => item.coverUrl)).toEqual(["https://assets.test/new-1", "https://assets.test/new-2"]);
        vi.useRealTimers();
    });

    it("资产进入画布时携带服务端 UUID，签名地址过期后仍可重新取回", () => {
        const asset = assetFromDto(dto("asset-stable"));
        expect(asset.kind).toBe("image");
        if (asset.kind !== "image") throw new Error("测试资产类型错误");
        expect(asset.data.storageKey).toBe("asset-stable");
    });

    it("服务端删除失败时保留本地资产，避免界面谎报删除成功", async () => {
        const asset = assetFromDto(dto("asset-1"));
        useAssetStore.setState({ assets: [asset] });
        server.use(http.delete("http://localhost/api/assets/asset-1", () => HttpResponse.json({ error: { code: "temporary_failure", message: "暂时失败" } }, { status: 503 })));

        await expect(useAssetStore.getState().removeAsset("asset-1")).rejects.toThrow();
        expect(useAssetStore.getState().assets).toEqual([asset]);
    });

    it("直传严格执行签发、对象存储 PUT、确认三步并上报进度", async () => {
        const progress = vi.fn();
        const headers: Record<string, string> = {};
        class FakeXhr {
            status = 200;
            upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void } = {};
            onload?: () => void;
            open(_method: string, _url: string) {}
            setRequestHeader(name: string, value: string) {
                headers[name] = value;
            }
            send(blob: Blob) {
                this.upload.onprogress?.({ loaded: blob.size, total: blob.size, lengthComputable: true });
                this.onload?.();
            }
            abort() {}
        }
        vi.stubGlobal("XMLHttpRequest", FakeXhr);
        server.use(
            http.post("http://localhost/api/assets/upload-url", () =>
                HttpResponse.json({ data: { ticket_id: "ticket-1", asset_id: "asset-1", upload_url: "https://objects.test/put", upload_headers: { "Content-Type": "image/png", "x-checksum": "bound" }, expires_in: 600 } }),
            ),
            http.post("http://localhost/api/assets/confirm", async ({ request }) => {
                expect(await request.json()).toMatchObject({ ticket_id: "ticket-1", checksum: expect.stringMatching(/^sha256:/) });
                return HttpResponse.json({ data: dto("asset-1") });
            }),
        );
        await expect(uploadAsset(new Blob(["png-data"], { type: "image/png" }), "ref.png", { onProgress: progress })).resolves.toMatchObject({ id: "asset-1" });
        expect(headers).toEqual({ "Content-Type": "image/png", "x-checksum": "bound" });
        expect(progress).toHaveBeenLastCalledWith({ loaded: 8, total: 8, percent: 100 });
        vi.unstubAllGlobals();
    });

    it("取消共享后已有快照引用仍能取得签名地址", async () => {
        server.use(
            http.patch("http://localhost/api/assets/asset-1", () => HttpResponse.json({ data: { ...dto("asset-1"), visibility: "private" } })),
            http.get("http://localhost/api/assets/asset-1/url", () => HttpResponse.json({ data: { url: "https://assets.test/snapshot", expires_at: "2026-08-22T01:20:00Z" } })),
        );
        await assetsApi.setVisibility("asset-1", "private");
        await expect((await import("@/platform/api/assets")).getAssetUrl("asset-1")).resolves.toMatchObject({ url: "https://assets.test/snapshot" });
    });

    it("偏好写入服务端后重新拉取仍一致", async () => {
        let preferences: Record<string, unknown> = {};
        server.use(
            http.patch("http://localhost/api/me/preferences", async ({ request }) => {
                preferences = { ...preferences, ...((await request.json()) as Record<string, unknown>) };
                return HttpResponse.json({ data: preferences });
            }),
            http.get("http://localhost/api/me", () => HttpResponse.json({ data: { ...authResultFixture.user, preferences } })),
        );
        await authApi.updatePreferences({ generation_defaults: { size: "9:16", quality: "high" }, ui: { theme: "dark", lang: "zh-CN" } });
        await expect(authApi.me()).resolves.toMatchObject({ preferences: { generation_defaults: { size: "9:16", quality: "high" }, ui: { theme: "dark", lang: "zh-CN" } } });
    });

    it("六类默认模型按真实生成能力生效，切换账号不会沿用旧偏好", () => {
        applyServerPreferences({
            default_models: {
                text2image: "t2i-model",
                image2image: "i2i-model",
                text2video: "t2v-model",
                image2video: "i2v-model",
                text: "text-model",
                audio: "audio-model",
            },
            generation_defaults: { size: "9:16", resolution: "1080p", quality: "high" },
            ui: { canvasBackground: "dots" },
        });
        const first = useConfigStore.getState().config;
        expect(platformModelCode({ ...first, model: first.imageModel }, "image2image")).toBe("i2i-model");
        expect(platformModelCode({ ...first, model: first.videoModel }, "image2video")).toBe("i2v-model");
        expect(first).toMatchObject({ size: "9:16", vquality: "1080p", quality: "high", canvasBackground: "dots" });

        applyServerPreferences({ default_models: { text: "second-text" } });
        const second = useConfigStore.getState().config;
        expect(second.defaultModels).toEqual({ text: "second-text" });
        expect(second.imageModel).toBe("");
        expect(second.size).toBe(defaultConfig.size);
        expect(second.canvasBackground).toBe(defaultConfig.canvasBackground);
    });

    it("首页完全按接口返回数量渲染数据源", async () => {
        server.use(
            http.get("http://localhost/api/apps", () =>
                HttpResponse.json({
                    data: {
                        items: [
                            { code: "a", name: "A", icon: null, description: null, entry_path: "/a", sort_order: 0 },
                            { code: "b", name: "B", icon: null, description: null, entry_path: "/b", sort_order: 1 },
                        ],
                    },
                }),
            ),
        );
        await expect(appsApi.list()).resolves.toMatchObject({ items: [{ code: "a" }, { code: "b" }] });
    });

    it("配置页面源码不包含任何浏览器渠道凭据字段", () => {
        const source = readFileSync(fileURLToPath(new URL("../../pages/config/index.tsx", import.meta.url)), "utf8");
        expect(source).not.toMatch(/apiKey|baseUrl/);
    });
});
