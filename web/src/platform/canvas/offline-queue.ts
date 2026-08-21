import localforage from "localforage";

import type { Op } from "./ops";

export type OfflineBatch = {
    id: string;
    canvasId: string;
    ops: Op[];
    createdAt: string;
};

export type QueueStorage = {
    load: () => Promise<OfflineBatch[]>;
    save: (batches: OfflineBatch[]) => Promise<void>;
};

const database = localforage.createInstance({ name: "aigc-studio", storeName: "canvas_offline_ops" });
const STORAGE_KEY = "batches";

const indexedDbStorage: QueueStorage = {
    async load() {
        if (typeof window === "undefined") return [];
        return (await database.getItem<OfflineBatch[]>(STORAGE_KEY)) ?? [];
    },
    async save(batches) {
        if (typeof window !== "undefined") await database.setItem(STORAGE_KEY, batches);
    },
};

export class OfflineQueue {
    private batches: OfflineBatch[] | null = null;
    private loading: Promise<OfflineBatch[]> | null = null;

    constructor(private readonly storage: QueueStorage = indexedDbStorage) {}

    private async ready(): Promise<OfflineBatch[]> {
        if (this.batches) return this.batches;
        this.loading ??= this.storage.load().then((batches) => {
            this.batches = batches;
            this.loading = null;
            return batches;
        });
        return this.loading;
    }

    async list(canvasId?: string): Promise<OfflineBatch[]> {
        const batches = await this.ready();
        return batches.filter((batch) => !canvasId || batch.canvasId === canvasId).map((batch) => structuredClone(batch));
    }

    async push(batch: OfflineBatch): Promise<void> {
        const batches = await this.ready();
        if (!batches.some((item) => item.id === batch.id)) batches.push(structuredClone(batch));
        await this.storage.save(batches);
    }

    async ack(batchId: string): Promise<void> {
        const batches = await this.ready();
        this.batches = batches.filter((batch) => batch.id !== batchId);
        await this.storage.save(this.batches);
    }

    async count(canvasId?: string): Promise<number> {
        return (await this.list(canvasId)).reduce((total, batch) => total + batch.ops.length, 0);
    }

    async removeCanvas(canvasId: string): Promise<void> {
        const batches = await this.ready();
        this.batches = batches.filter((batch) => batch.canvasId !== canvasId);
        await this.storage.save(this.batches);
    }

    async clearForTests(): Promise<void> {
        this.batches = [];
        await this.storage.save([]);
    }
}

export const offlineQueue = new OfflineQueue();
