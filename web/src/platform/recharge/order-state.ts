import type { RechargeOrder } from "@/platform/api/recharge";

export type RechargeOrderRouteState = {
    order?: RechargeOrder;
    ownerUserId?: string;
};

export function orderFromRouteState(state: unknown, orderId: string, userId: string): RechargeOrder | undefined {
    if (!state || typeof state !== "object") return undefined;
    const routeState = state as RechargeOrderRouteState;
    // 浏览器历史会跨登录会话保留路由状态，必须同时核对订单号与所属用户。
    return routeState.ownerUserId === userId && routeState.order?.order_id === orderId ? routeState.order : undefined;
}
