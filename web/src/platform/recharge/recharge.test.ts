import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rechargeApi, type OrderStatusResult, type RechargeOrder } from "@/platform/api/recharge";
import { authStore, type AuthResult } from "@/platform/auth/store";
import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import { formatCreditsPerYuan, formatFenAsYuan, PAYMENT_PENDING_TIMEOUT_MESSAGE } from "./presentation";
import { FAST_POLL_INTERVAL_MS, pollingInterval, SLOW_POLL_INTERVAL_MS, watchOrder } from "./polling";
import { rechargeKeys } from "./query-keys";
import { orderFromRouteState } from "./order-state";

const pending: OrderStatusResult = { status: "pending", paid_at: null, credits_total: 11_000, channel_trade_no: null };

describe("FE-4 充值与支付契约", () => {
    beforeEach(() => authStore.getState().authenticate(authResultFixture as AuthResult));

    it("下单请求体只有 tier_id 与 channel，金额不会回传", async () => {
        server.use(
            http.post("http://localhost/api/orders", async ({ request }) => {
                expect(await request.json()).toEqual({ tier_id: "tier-1", channel: "wechat" });
                expect(request.headers.get("Idempotency-Key")).toBe("stable-order-key");
                return HttpResponse.json({ data: { order_id: "order-1", status: "pending" } });
            }),
        );
        await rechargeApi.createOrder({ tier_id: "tier-1", channel: "wechat", idempotency_key: "stable-order-key" });
    });

    it("MSW 可模拟 pending 到 paid，到账结果保留积分和渠道流水号", async () => {
        let calls = 0;
        server.use(
            http.get("http://localhost/api/orders/order-1", () => {
                calls += 1;
                return HttpResponse.json({ data: calls === 1 ? pending : { ...pending, status: "paid", paid_at: "2026-08-20T00:00:00Z", channel_trade_no: "WX-1" } });
            }),
        );
        await expect(rechargeApi.order("order-1")).resolves.toMatchObject({ status: "pending" });
        await expect(rechargeApi.order("order-1")).resolves.toMatchObject({ status: "paid", credits_total: 11_000, channel_trade_no: "WX-1" });
    });

    it("MSW 可模拟 pending 到 closed", async () => {
        server.use(http.get("http://localhost/api/orders/order-2", () => HttpResponse.json({ data: { ...pending, status: "closed" } })));
        await expect(rechargeApi.order("order-2")).resolves.toMatchObject({ status: "closed" });
    });

    it("金额异常是公开终态，不会被误认为 pending", async () => {
        server.use(http.get("http://localhost/api/orders/order-mismatch", () => HttpResponse.json({ data: { ...pending, status: "amount_mismatch" } })));
        await expect(rechargeApi.order("order-mismatch")).resolves.toMatchObject({ status: "amount_mismatch" });
    });

    it("前两分钟每两秒轮询，之后退避到每五秒", () => {
        expect(pollingInterval(0)).toBe(FAST_POLL_INTERVAL_MS);
        expect(pollingInterval(119_999)).toBe(FAST_POLL_INTERVAL_MS);
        expect(pollingInterval(120_000)).toBe(SLOW_POLL_INTERVAL_MS);
    });

    it("长时间 pending 到期后停止，并使用非失败文案", async () => {
        let now = Date.parse("2026-08-20T00:00:00Z");
        let scheduled: (() => void) | undefined;
        const onTimeout = vi.fn();
        const poller = watchOrder(
            "order-3",
            "2026-08-20T00:00:02Z",
            { onStatus: vi.fn(), onTimeout, onError: vi.fn() },
            {
                getOrder: async () => pending,
                now: () => now,
                setTimer: ((callback: () => void) => {
                    scheduled = callback;
                    return 1 as unknown as ReturnType<typeof setTimeout>;
                }) as typeof setTimeout,
                clearTimer: vi.fn() as unknown as typeof clearTimeout,
            },
        );
        await vi.waitFor(() => expect(scheduled).toBeTypeOf("function"));
        now += 2_000;
        scheduled?.();
        await vi.waitFor(() => expect(onTimeout).toHaveBeenCalledOnce());
        expect(PAYMENT_PENDING_TIMEOUT_MESSAGE).not.toContain("失败");
        poller.stop();
    });

    it("页面隐藏暂停轮询，恢复可见时立即查询", async () => {
        const listeners = new Set<() => void>();
        const visibility = {
            hidden: true,
            addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
            removeEventListener: (_type: "visibilitychange", listener: () => void) => listeners.delete(listener),
        };
        const getOrder = vi.fn(async () => pending);
        const poller = watchOrder("order-4", "2026-08-20T01:00:00Z", { onStatus: vi.fn(), onTimeout: vi.fn(), onError: vi.fn() }, { getOrder, now: () => Date.parse("2026-08-20T00:00:00Z"), visibility });
        expect(getOrder).not.toHaveBeenCalled();
        visibility.hidden = false;
        listeners.forEach((listener) => listener());
        await vi.waitFor(() => expect(getOrder).toHaveBeenCalledOnce());
        poller.stop();
    });

    it("金额分转元与折算比例使用整数路径", () => {
        expect(formatFenAsYuan(1)).toBe("0.01");
        expect(formatFenAsYuan(9_900)).toBe("99.00");
        expect(formatFenAsYuan(Number.MAX_SAFE_INTEGER)).toMatch(/\.91$/);
        expect(formatCreditsPerYuan(11_000, 9_900)).toBe("111.11 积分/元");
    });

    it("订单缓存键包含用户身份", () => {
        expect(rechargeKeys.orders("user-a")).not.toEqual(rechargeKeys.orders("user-b"));
    });

    it("浏览器历史中的订单只允许原所属用户恢复", () => {
        const order: RechargeOrder = {
            order_id: "order-a",
            out_trade_no: "merchant-a",
            amount_fen: 9_900,
            credits_total: 11_000,
            channel: "wechat",
            qr_code_url: "https://qr.test/order-a",
            status: "pending",
            expires_at: "2026-08-20T01:00:00Z",
            created_at: "2026-08-20T00:30:00Z",
            paid_at: null,
            channel_trade_no: null,
        };
        const state = { order, ownerUserId: "user-a" };

        expect(orderFromRouteState(state, "order-a", "user-a")).toBe(order);
        expect(orderFromRouteState(state, "order-a", "user-b")).toBeUndefined();
    });
});
