import { api } from "@/platform/http/client";

export type WalletBalance = {
    balance: number;
    held: number;
    available: number;
    active_hold_count: number;
};

export type LedgerType = "recharge" | "consume" | "transfer_out" | "transfer_in" | "reclaim_out" | "reclaim_in" | "admin_adjust" | "refund_deduct";

export type LedgerItem = {
    id: string;
    ledger_no: string;
    type: LedgerType;
    delta: number;
    balance_after: number;
    model_code: string | null;
    task_id: string | null;
    transfer_id: string | null;
    order_id: string | null;
    price_snapshot: Record<string, unknown> | null;
    usage_snapshot: Record<string, unknown> | null;
    note: string | null;
    created_at: string;
};

export type CursorPage<T> = { items: T[]; next_cursor: string | null; has_more: boolean };

export type CreditRequest = {
    id: string;
    requester_id: string;
    approver_id: string | null;
    amount: number;
    reason: string | null;
    task_context: Record<string, unknown> | null;
    status: "pending" | "approved" | "rejected" | "cancelled";
    transfer_id: string | null;
    decided_at: string | null;
    created_at: string;
};

function query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") search.set(key, String(value));
    });
    const value = search.toString();
    return value ? `?${value}` : "";
}

function idempotencyOptions() {
    // 每次用户动作只生成一个键；HTTP 层的 401 重放仍复用同一个请求配置。
    return { headers: { "Idempotency-Key": crypto.randomUUID() } };
}

export const walletApi = {
    balance: () => api.get<WalletBalance>("/wallet"),
    ledger: (params: { type?: LedgerType; cursor?: string; limit?: number }) => api.get<CursorPage<LedgerItem>>(`/wallet/ledger${query(params)}`),
    transfer: (input: { to_user_id: string; amount: number; note: string }) => api.post<{ transfer_id: string; from_balance: number; to_balance: number }>("/wallet/transfer", input, idempotencyOptions()),
    reclaim: (input: { from_user_id: string; amount: number; note: string }) => api.post<{ transfer_id: string; from_balance: number; to_balance: number }>("/wallet/reclaim", input, idempotencyOptions()),
    createRequest: (input: { amount: number; reason?: string; task_context?: Record<string, unknown> }) => api.post<CreditRequest>("/wallet/requests", input),
    requests: () => api.get<{ items: CreditRequest[] }>("/wallet/requests"),
    approveRequest: (id: string) => api.post<CreditRequest>(`/wallet/requests/${encodeURIComponent(id)}/approve`),
    rejectRequest: (id: string, reason?: string) => api.post<CreditRequest>(`/wallet/requests/${encodeURIComponent(id)}/reject`, { reason: reason || null }),
};
