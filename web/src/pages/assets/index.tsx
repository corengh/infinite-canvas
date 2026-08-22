import { FileAudio, FileQuestion, Film, ImageIcon, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Empty, Modal, Progress, Select, Spin, Switch, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { assetsApi, uploadAsset, type AssetKind, type AssetVisibility } from "@/platform/api/assets";
import { useAuthStore } from "@/platform/auth/store";
import { assetFromDto, useAssetStore, type Asset } from "@/stores/use-asset-store";

const kindOptions: Array<{ value: AssetKind | "all"; labelKey: string }> = [
    { value: "all", labelKey: "fe9.assets.allKinds" },
    { value: "image", labelKey: "assets.kinds.image" },
    { value: "video", labelKey: "assets.kinds.video" },
    { value: "audio", labelKey: "assets.kinds.audio" },
    { value: "file", labelKey: "assets.kinds.file" },
];

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const userId = useAuthStore((state) => state.user?.id);
    const assets = useAssetStore((state) => state.assets);
    const loading = useAssetStore((state) => state.loading);
    const nextCursor = useAssetStore((state) => state.nextCursor);
    const loadAssets = useAssetStore((state) => state.loadAssets);
    const reloadAssetUrl = useAssetStore((state) => state.reloadAssetUrl);
    const [kind, setKind] = useState<AssetKind | "all">("all");
    const [visibility, setVisibility] = useState<AssetVisibility | "all">("all");
    const [owner, setOwner] = useState<"all" | "mine">("all");
    const [uploading, setUploading] = useState<Record<string, number>>({});
    const [deleting, setDeleting] = useState<Asset | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const filters = useMemo(() => ({ kind: kind === "all" ? undefined : kind, visibility: visibility === "all" ? undefined : visibility, owner: owner === "mine" ? userId : undefined, limit: 40 }), [kind, owner, userId, visibility]);

    useEffect(() => {
        void loadAssets(filters).catch((error) => message.error(error instanceof Error ? error.message : t("fe9.assets.loadFailed")));
    }, [filters, loadAssets, message, t]);

    const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        for (const file of files) {
            setUploading((current) => ({ ...current, [file.name]: 0 }));
            try {
                const dto = await uploadAsset(file, file.name, { onProgress: ({ percent }) => setUploading((current) => ({ ...current, [file.name]: percent })) });
                useAssetStore.setState((state) => ({ assets: [assetFromDto(dto), ...state.assets] }));
                message.success(t("fe9.assets.uploadDone"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("fe9.assets.uploadFailed"));
            } finally {
                setUploading((current) => {
                    const next = { ...current };
                    delete next[file.name];
                    return next;
                });
            }
        }
    };

    const changeVisibility = async (asset: Asset, checked: boolean) => {
        try {
            const updated = assetFromDto(await assetsApi.setVisibility(asset.id, checked ? "team" : "private"));
            useAssetStore.setState((state) => ({ assets: state.assets.map((item) => (item.id === asset.id ? updated : item)) }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("fe9.assets.loadFailed"));
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        try {
            await assetsApi.remove(deleting.id);
            useAssetStore.setState((state) => ({ assets: state.assets.filter((item) => item.id !== deleting.id) }));
            message.success(t("fe9.assets.deleteDone"));
            setDeleting(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("fe9.assets.loadFailed"));
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-background px-5 py-7">
            <div className="mx-auto max-w-7xl">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("fe9.assets.title")}</h1>
                        <p className="mt-1 text-sm text-stone-500">{t("fe9.assets.description")}</p>
                    </div>
                    <Button type="primary" icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
                        {t("fe9.assets.upload")}
                    </Button>
                    <input ref={inputRef} className="hidden" type="file" multiple accept="image/*,video/mp4,video/webm,audio/*" onChange={(event) => void uploadFiles(event)} />
                </header>

                <div className="mt-6 flex flex-wrap gap-3">
                    <Select value={kind} className="w-40" options={kindOptions.map((item) => ({ value: item.value, label: t(item.labelKey) }))} onChange={setKind} />
                    <Select
                        value={visibility}
                        className="w-40"
                        options={[
                            { value: "all", label: t("fe9.assets.allVisibility") },
                            { value: "private", label: t("fe9.assets.private") },
                            { value: "team", label: t("fe9.assets.team") },
                        ]}
                        onChange={setVisibility}
                    />
                    <Select
                        value={owner}
                        className="w-40"
                        options={[
                            { value: "all", label: t("fe9.assets.allOwners") },
                            { value: "mine", label: t("fe9.assets.mine") },
                        ]}
                        onChange={setOwner}
                    />
                </div>

                {Object.entries(uploading).map(([name, percent]) => (
                    <div key={name} className="mt-4 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="mb-2 truncate text-sm">{name}</div>
                        <Progress percent={percent} size="small" />
                    </div>
                ))}

                {loading && !assets.length ? (
                    <div className="grid h-64 place-items-center">
                        <Spin />
                    </div>
                ) : (
                    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {assets.map((asset) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                owned={asset.ownerId === userId}
                                onVisibility={changeVisibility}
                                onDelete={setDeleting}
                                onUrlError={async () => {
                                    message.loading(t("fe9.assets.retryUrl"), 1);
                                    await reloadAssetUrl(asset.id);
                                }}
                            />
                        ))}
                    </div>
                )}
                {!loading && !assets.length ? <Empty className="py-20" description={t("fe9.assets.empty")} /> : null}
                {nextCursor ? (
                    <div className="mt-8 text-center">
                        <Button loading={loading} onClick={() => void loadAssets(filters, true)}>
                            {t("fe9.assets.loadMore")}
                        </Button>
                    </div>
                ) : null}
            </div>

            <Modal title={t("common.delete")} open={Boolean(deleting)} okText={t("common.delete")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onCancel={() => setDeleting(null)} onOk={() => void confirmDelete()}>
                {t("fe9.assets.deleteConfirm", { name: deleting?.title })}
            </Modal>
        </main>
    );
}

function AssetCard({ asset, owned, onVisibility, onDelete, onUrlError }: { asset: Asset; owned: boolean; onVisibility: (asset: Asset, checked: boolean) => Promise<void>; onDelete: (asset: Asset) => void; onUrlError: () => Promise<void> }) {
    const { t } = useTranslation();
    const mediaUrl = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "text" ? "" : asset.data.url;
    const drag = (event: DragEvent) => {
        if (asset.kind === "text" || asset.kind === "file") return;
        // 画布只接收最小引用数据，服务端引用记录由落点生成真实 node_id 后再写入。
        event.dataTransfer.setData(
            "application/x-aigc-asset",
            JSON.stringify({ assetId: asset.id, kind: asset.kind, title: asset.title, url: mediaUrl, width: "width" in asset.data ? asset.data.width : undefined, height: "height" in asset.data ? asset.data.height : undefined }),
        );
        event.dataTransfer.effectAllowed = "copy";
    };
    return (
        <Card
            className="overflow-hidden"
            styles={{ body: { padding: 14 } }}
            cover={
                <div className="grid aspect-[4/3] place-items-center overflow-hidden bg-stone-100 dark:bg-stone-900" draggable={asset.kind !== "text" && asset.kind !== "file"} onDragStart={drag} title={t("fe9.assets.dragHint")}>
                    {asset.kind === "image" ? <img src={mediaUrl} alt={asset.title} className="h-full w-full object-cover" loading="lazy" onError={() => void onUrlError()} /> : null}
                    {asset.kind === "video" ? <video src={mediaUrl} className="h-full w-full object-cover" controls preload="metadata" onError={() => void onUrlError()} /> : null}
                    {asset.kind === "audio" ? (
                        <div className="w-full px-5 text-center">
                            <FileAudio className="mx-auto mb-4 size-10 text-stone-400" />
                            <audio src={mediaUrl} className="w-full" controls preload="metadata" onError={() => void onUrlError()} />
                        </div>
                    ) : null}
                    {asset.kind === "file" ? <FileQuestion className="size-12 text-stone-400" /> : null}
                    {asset.kind === "text" ? <ImageIcon className="size-12 text-stone-400" /> : null}
                </div>
            }
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium">{asset.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                        <Tag>{t(asset.source === "generated" ? "fe9.assets.generated" : "fe9.assets.uploaded")}</Tag>
                    </div>
                </div>
                {owned ? <Button type="text" danger size="small" icon={<Trash2 className="size-4" />} onClick={() => onDelete(asset)} /> : null}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-xs dark:border-stone-800">
                <span className="text-stone-500">{owned ? t(asset.visibility === "team" ? "fe9.assets.team" : "fe9.assets.private") : t("fe9.assets.sharedReadonly")}</span>
                {owned ? <Switch size="small" checked={asset.visibility === "team"} onChange={(checked) => void onVisibility(asset, checked)} /> : null}
            </div>
        </Card>
    );
}
