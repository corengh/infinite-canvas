import { api } from "@/platform/http/client";

export type PromptVisibility = "private" | "team";
export type PromptDTO = { id: string; title: string; content: string; tags: string[]; visibility: PromptVisibility; owner: { id: string }; created_at: string; updated_at: string };
export type PromptInput = { title: string; content: string; tags: string[]; visibility: PromptVisibility };

export const promptsApi = {
    list: (params: { tag?: string; search?: string; visibility?: PromptVisibility; cursor?: string; limit?: number } = {}, signal?: AbortSignal) => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
        return api.get<{ items: PromptDTO[]; next_cursor: string | null }>(`/prompts${query.size ? `?${query}` : ""}`, { signal });
    },
    create: (input: PromptInput) => api.post<PromptDTO>("/prompts", input),
    update: (id: string, input: Partial<PromptInput>) => api.patch<PromptDTO>(`/prompts/${encodeURIComponent(id)}`, input),
    remove: (id: string) => api.delete<void>(`/prompts/${encodeURIComponent(id)}`),
};
