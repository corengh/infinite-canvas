import { api } from "@/platform/http/client";
import type { CursorPage, WalletBalance } from "./wallet";

export type TeamRole = "owner" | "leader" | "member";
export type MemberStatus = "active" | "disabled" | "disabled_pending_settlement";
export type TeamGroup = { id: string; name: string; leader_id: string | null };

export type TeamMember = {
    id: string;
    username: string | null;
    login_id: string;
    display_name: string;
    phone: string | null;
    phone_verified: boolean;
    role: TeamRole;
    group: { id: string; name?: string } | null;
    wallet: WalletBalance;
    status: MemberStatus;
    last_consume_at: string | null;
    created_at: string;
};

export type CreatedMember = {
    id: string;
    username: string;
    login_id: string;
    display_name: string;
    phone: string | null;
    phone_verified: boolean;
    role: TeamRole;
    group: { id: string } | null;
    status: MemberStatus;
    created_at: string;
};
export type OneTimePassword = { login_id: string; password: string };
export type TeamConsumptionItem = {
    id: string;
    user_id: string;
    display_name?: string;
    model_code: string;
    credits: number;
    created_at: string;
};
export type IdleRankingItem = {
    user_id: string;
    phone: string | null;
    display_name: string;
    balance: number;
    held: number;
    available: number;
    last_consume_at: string | null;
    idle_days: number;
};

function query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") search.set(key, String(value));
    });
    const value = search.toString();
    return value ? `?${value}` : "";
}

export const teamApi = {
    members: (params: { role?: TeamRole; group_id?: string; status?: string; cursor?: string; limit?: number } = {}) => api.get<CursorPage<TeamMember>>(`/team/members${query(params)}`),
    createMember: (input: { username: string; password: string; display_name: string; role: Exclude<TeamRole, "owner">; group_id?: string | null }) => api.post<CreatedMember>("/team/members", input),
    resetPassword: (id: string, newPassword?: string) => api.post<OneTimePassword>(`/team/members/${encodeURIComponent(id)}/reset-password`, { new_password: newPassword || null }),
    updateMember: (id: string, input: { status?: "active" | "disabled"; role?: Exclude<TeamRole, "owner">; group_id?: string | null }) =>
        api.patch<TeamMember & { reclaimed_credits?: number; remaining_held?: number }>(`/team/members/${encodeURIComponent(id)}`, input),
    deleteMember: (id: string) => api.delete<{ status: MemberStatus; reclaimed_credits: number; remaining_held: number }>(`/team/members/${encodeURIComponent(id)}`),
    groups: () => api.get<{ items: TeamGroup[] }>("/team/groups"),
    idleRanking: (days: 7 | 15 | 30) => api.get<{ items: IdleRankingItem[] }>(`/team/idle-ranking?days=${days}`),
    createGroup: (input: { name: string; leader_id?: string | null }) => api.post<TeamGroup>("/team/groups", input),
    updateGroup: (id: string, input: { name?: string; leader_id?: string | null }) => api.patch<TeamGroup>(`/team/groups/${encodeURIComponent(id)}`, input),
    updateSettings: (input: { name: string }) => api.patch<{ id: string; name: string; slug: string }>("/team/settings", { name: input.name }),
    consumption: (params: { from?: string; to?: string; user_id?: string; model_code?: string; cursor?: string; limit?: number } = {}) => api.get<CursorPage<TeamConsumptionItem>>(`/team/consumption${query(params)}`),
};
