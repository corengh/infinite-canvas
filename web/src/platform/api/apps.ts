import { api } from "@/platform/http/client";

export type PlatformAppDTO = { code: string; name: string; icon: string | null; description: string | null; entry_path: string; sort_order: number };
export const appsApi = { list: () => api.get<{ items: PlatformAppDTO[] }>("/apps") };
