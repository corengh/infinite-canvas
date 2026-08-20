import { api } from "@/platform/http/client";

export type PaymentChannel = "alipay" | "wechat";
export type OrderStatus = "pending" | "paid" | "closed" | "refunded" | "amount_mismatch";

export type RechargeTier = {
    id: string;
    name: string;
    amount_fen: number;
    credits_base: number;
    credits_bonus: number;
    credits_total: number;
    sort_order: number;
};

export type OrderStatusResult = {
    order_id?: string;
    status: OrderStatus;
    credits_total: number;
    paid_at: string | null;
    channel_trade_no: string | null;
};

export type RechargeOrder = OrderStatusResult & {
    order_id: string;
    out_trade_no: string;
    amount_fen: number;
    channel: PaymentChannel;
    qr_code_url: string | null;
    expires_at: string;
    created_at: string;
};

export type CreateRechargeOrderInput = {
    tier_id: string;
    channel: PaymentChannel;
    idempotency_key?: string;
};

function idempotencyOptions(key: string = crypto.randomUUID()) {
    // 调用方可传入稳定键，让网络结果不明确后的人工重试仍能回放原订单。
    return { headers: { "Idempotency-Key": key } };
}

export const rechargeApi = {
    tiers: () => api.get<{ items: RechargeTier[] }>("/tiers"),
    createOrder: (input: CreateRechargeOrderInput) =>
        // 请求体在类型和构造处都只保留档位与渠道，金额始终由服务端档位快照决定。
        api.post<RechargeOrder>("/orders", { tier_id: input.tier_id, channel: input.channel }, idempotencyOptions(input.idempotency_key)),
    order: (id: string) => api.get<OrderStatusResult>(`/orders/${encodeURIComponent(id)}`),
    orders: () => api.get<{ items: RechargeOrder[] }>("/orders"),
};
