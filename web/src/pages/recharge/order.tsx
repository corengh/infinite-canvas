import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, QRCode, Result, Space, Spin, Typography } from "antd";
import { ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { rechargeApi, type OrderStatus, type RechargeOrder } from "@/platform/api/recharge";
import { useAuthStore } from "@/platform/auth/store";
import { creditBadgeEvents } from "@/platform/components/credit-badge";
import { ApiError } from "@/platform/http/errors";
import { formatCountdown, formatCredits, formatFenAsYuan, PAYMENT_PENDING_TIMEOUT_MESSAGE } from "@/platform/recharge/presentation";
import { watchOrder, type OrderPoller } from "@/platform/recharge/polling";
import { rechargeKeys } from "@/platform/recharge/query-keys";
import { orderFromRouteState } from "@/platform/recharge/order-state";
import { walletKeys } from "@/platform/wallet-team/query-keys";

function useRemainingTime(expiresAt?: string) {
    const [remaining, setRemaining] = useState(() => Math.max(0, Date.parse(expiresAt ?? "") - Date.now()));
    useEffect(() => {
        if (!expiresAt) return;
        const update = () => setRemaining(Math.max(0, Date.parse(expiresAt) - Date.now()));
        update();
        const timer = window.setInterval(update, 1_000);
        return () => window.clearInterval(timer);
    }, [expiresAt]);
    return remaining;
}

export default function RechargeOrderPage() {
    const { orderId = "" } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const userId = useAuthStore((state) => state.user?.id) ?? "anonymous";
    const owner = useAuthStore((state) => state.role) === "owner";
    const stateOrder: RechargeOrder | undefined = orderFromRouteState(location.state, orderId, userId);
    const orders = useQuery({
        queryKey: rechargeKeys.orders(userId),
        queryFn: rechargeApi.orders,
        enabled: owner && stateOrder?.order_id !== orderId,
    });
    // 路由 state 让刚下单时立即展示；刷新页面后则从自己的订单列表恢复二维码与过期时间。
    const order = stateOrder?.order_id === orderId ? stateOrder : orders.data?.items.find((item) => item.order_id === orderId);
    const orderKey = order ? `${userId}:${order.order_id}` : undefined;
    const [liveOrder, setLiveOrder] = useState<{ key: string; status: OrderStatus; creditsTotal: number } | undefined>(undefined);
    const currentLiveOrder = liveOrder?.key === orderKey ? liveOrder : undefined;
    const status = currentLiveOrder?.status ?? order?.status;
    const creditsTotal = currentLiveOrder?.creditsTotal ?? order?.credits_total ?? 0;
    const [timedOutOrderKey, setTimedOutOrderKey] = useState<string | null>(null);
    const timedOut = Boolean(orderKey && timedOutOrderKey === orderKey);
    const [pollError, setPollError] = useState<string | null>(null);
    const poller = useRef<OrderPoller | null>(null);
    const creditedOrder = useRef<string | null>(null);
    const remaining = useRemainingTime(order?.expires_at);

    useEffect(() => {
        setTimedOutOrderKey(null);
        setPollError(null);
        setLiveOrder(order && orderKey ? { key: orderKey, status: order.status, creditsTotal: order.credits_total } : undefined);
    }, [order, orderKey]);

    useEffect(() => {
        if (!order || !orderKey || status !== "pending") return;
        setTimedOutOrderKey(null);
        poller.current = watchOrder(order.order_id, order.expires_at, {
            onStatus: (result) => {
                setLiveOrder({ key: orderKey, status: result.status, creditsTotal: result.credits_total });
                setPollError(null);
            },
            onTimeout: () => setTimedOutOrderKey(orderKey),
            onError: (cause) => setPollError((cause as ApiError).message),
        });
        return () => {
            poller.current?.stop();
            poller.current = null;
        };
    }, [order?.order_id, order?.expires_at, orderKey, status, userId]);

    useEffect(() => {
        const creditKey = order ? `${userId}:${order.order_id}` : null;
        if (status !== "paid" || !creditKey || creditedOrder.current === creditKey) return;
        creditedOrder.current = creditKey;
        // 到账后同时刷新钱包页面缓存和顶栏徽标，避免仍展示支付前余额。
        void queryClient.invalidateQueries({ queryKey: walletKeys.root(userId) });
        void queryClient.invalidateQueries({ queryKey: rechargeKeys.orders(userId) });
        creditBadgeEvents.refresh();
    }, [order, queryClient, status, userId]);

    const refreshStatus = async () => {
        if (!timedOut) {
            poller.current?.checkNow();
            return;
        }
        // 自动轮询到期后仍允许手动核对，覆盖渠道回调或后端补偿稍晚到账的场景。
        try {
            const result = await rechargeApi.order(orderId);
            if (orderKey) setLiveOrder({ key: orderKey, status: result.status, creditsTotal: result.credits_total });
            setPollError(null);
        } catch (cause) {
            setPollError((cause as ApiError).message);
        }
    };

    if (!owner)
        return (
            <main className="h-full overflow-y-auto p-6">
                <Alert type="warning" showIcon message="仅主账号可查看支付订单" />
            </main>
        );
    if (!order && orders.isLoading)
        return (
            <main className="flex h-full items-center justify-center">
                <Spin />
            </main>
        );
    if (!order) {
        return (
            <main className="h-full overflow-y-auto p-6">
                <Result status="warning" title="无法读取该订单" subTitle={orders.isError ? (orders.error as ApiError).message : "订单不存在或不属于当前账号。"} extra={<Button onClick={() => navigate("/recharge/orders")}>返回充值记录</Button>} />
            </main>
        );
    }
    if (status === "paid") {
        return (
            <main className="h-full overflow-y-auto p-6">
                <Result
                    status="success"
                    title="支付成功"
                    subTitle={`已到账 ${formatCredits(creditsTotal)} 积分`}
                    extra={[
                        <Button key="wallet" type="primary" onClick={() => navigate("/wallet")}>
                            查看钱包
                        </Button>,
                        <Button key="orders" onClick={() => navigate("/recharge/orders")}>
                            查看充值记录
                        </Button>,
                    ]}
                />
            </main>
        );
    }
    if (status === "closed") {
        return (
            <main className="h-full overflow-y-auto p-6">
                <Result
                    status="warning"
                    title="订单已过期"
                    subTitle="该订单已关闭，未完成付款。你可以返回档位页重新下单。"
                    extra={
                        <Button type="primary" onClick={() => navigate("/recharge")}>
                            重新下单
                        </Button>
                    }
                />
            </main>
        );
    }
    if (status === "refunded") {
        return (
            <main className="h-full overflow-y-auto p-6">
                <Result status="info" title="订单已退款" subTitle="该笔订单已完成退款处理。" extra={<Button onClick={() => navigate("/recharge/orders")}>返回充值记录</Button>} />
            </main>
        );
    }
    if (status === "amount_mismatch") {
        return (
            <main className="h-full overflow-y-auto p-6">
                <Result status="error" title="订单金额异常" subTitle="支付信息需要人工核对，请勿重复付款，并联系客服处理。" extra={<Button onClick={() => navigate("/recharge/orders")}>返回充值记录</Button>} />
            </main>
        );
    }

    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-3xl">
                <Button className="mb-4" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/recharge/orders")}>
                    返回充值记录
                </Button>
                <Card>
                    <div className="grid items-center gap-8 md:grid-cols-[280px_1fr]">
                        <div className="flex justify-center">{order.qr_code_url ? <QRCode value={order.qr_code_url} size={260} bordered /> : <Alert type="error" showIcon message="支付二维码不可用" />}</div>
                        <div>
                            <Typography.Title level={3}>请使用手机扫码支付</Typography.Title>
                            <div className="mb-4 text-3xl font-semibold">¥ {formatFenAsYuan(order.amount_fen)}</div>
                            <Typography.Paragraph>
                                到账积分：<strong>{formatCredits(order.credits_total)}</strong>
                            </Typography.Paragraph>
                            <Typography.Paragraph>
                                支付剩余时间：
                                <Typography.Text type={remaining < 5 * 60_000 ? "danger" : undefined} strong>
                                    {formatCountdown(remaining)}
                                </Typography.Text>
                            </Typography.Paragraph>
                            <Space wrap>
                                <Button type="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => void refreshStatus()}>
                                    已完成支付
                                </Button>
                                <Button icon={<RefreshCw className="size-4" />} onClick={() => void refreshStatus()}>
                                    刷新状态
                                </Button>
                            </Space>
                        </div>
                    </div>
                    {pollError ? <Alert className="mt-5" type="warning" showIcon message="暂时无法查询订单状态" description={pollError} /> : null}
                    {timedOut ? <Alert className="mt-5" type="info" showIcon message={PAYMENT_PENDING_TIMEOUT_MESSAGE} description="回调可能稍有延迟，请勿重复付款。订单确认后，重新打开钱包页即可看到到账积分。" /> : null}
                    {!timedOut ? <Alert className="mt-5" type="info" showIcon message="关闭页面不会影响订单" description="系统会继续核对支付结果；确认到账后，重新打开钱包页即可看到积分。" /> : null}
                </Card>
            </div>
        </main>
    );
}
