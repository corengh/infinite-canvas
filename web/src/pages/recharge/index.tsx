import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Radio, Space, Spin, Typography } from "antd";
import { ArrowLeft, History, QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { rechargeApi, type PaymentChannel } from "@/platform/api/recharge";
import { useAuthStore } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { formatCredits, formatCreditsPerYuan, formatFenAsYuan } from "@/platform/recharge/presentation";
import { rechargeKeys } from "@/platform/recharge/query-keys";

const channelOptions: Array<{ label: string; value: PaymentChannel; hint: string }> = [
    { label: "支付宝", value: "alipay", hint: "使用支付宝扫码" },
    { label: "微信支付", value: "wechat", hint: "使用微信扫码" },
];

export default function RechargePage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const userId = useAuthStore((state) => state.user?.id) ?? "anonymous";
    const owner = useAuthStore((state) => state.role) === "owner";
    const [tierId, setTierId] = useState<string>();
    const [channel, setChannel] = useState<PaymentChannel>("alipay");
    const [error, setError] = useState<string | null>(null);
    const orderAttempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
    const tiers = useQuery({ queryKey: rechargeKeys.tiers(userId), queryFn: rechargeApi.tiers, enabled: owner });
    const createOrder = useMutation({
        mutationFn: rechargeApi.createOrder,
        onSuccess: (order) => {
            orderAttempt.current = undefined;
            void queryClient.invalidateQueries({ queryKey: rechargeKeys.orders(userId) });
            navigate(`/recharge/orders/${order.order_id}`, { state: { order, ownerUserId: userId } });
        },
        onError: (cause, variables) => {
            const apiError = cause as ApiError;
            if (apiError.code === "TIER_UNAVAILABLE") {
                setTierId(undefined);
                // 先从当前缓存移除失效档位，避免刷新请求返回前又自动选中同一档位。
                queryClient.setQueryData<{ items: Array<{ id: string }> }>(rechargeKeys.tiers(userId), (current) => (current ? { items: current.items.filter((item) => item.id !== variables.tier_id) } : current));
                void queryClient.invalidateQueries({ queryKey: rechargeKeys.tiers(userId) });
                setError("该充值档位已下架，档位列表已刷新，请重新选择。");
                return;
            }
            if (apiError.code === "PAYMENT_CHANNEL_DISABLED") {
                setError("该支付方式暂不可用，请选择另一种支付方式。");
                return;
            }
            setError(apiError.message);
        },
    });

    useEffect(() => {
        if (!tierId && tiers.data?.items.length) setTierId(tiers.data.items[0].id);
    }, [tierId, tiers.data]);

    useEffect(() => {
        // 原账号尚未确认结果的下单键不能被新登录账号继续使用。
        orderAttempt.current = undefined;
    }, [userId]);

    const submitOrder = () => {
        if (!tierId) return;
        const fingerprint = `${tierId}:${channel}`;
        if (orderAttempt.current?.fingerprint !== fingerprint) orderAttempt.current = { fingerprint, key: crypto.randomUUID() };
        createOrder.mutate({ tier_id: tierId, channel, idempotency_key: orderAttempt.current.key });
    };

    if (!owner) {
        return (
            <main className="h-full overflow-y-auto p-6">
                <Card className="mx-auto max-w-2xl">
                    <Typography.Title level={2}>充值</Typography.Title>
                    <Alert showIcon type="warning" message="仅主账号可充值" description="子账号如需积分，请在钱包中向上级申请补拨。" />
                    <Button className="mt-4" type="primary" onClick={() => navigate("/wallet")}>
                        前往钱包申请补拨
                    </Button>
                </Card>
            </main>
        );
    }

    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <Typography.Title level={2} className="!mb-1">
                            积分充值
                        </Typography.Title>
                        <Typography.Text type="secondary">选择档位后使用支付宝或微信扫码支付。</Typography.Text>
                    </div>
                    <Space>
                        <Button icon={<History className="size-4" />} onClick={() => navigate("/recharge/orders")}>
                            充值记录
                        </Button>
                        <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/wallet")}>
                            返回钱包
                        </Button>
                    </Space>
                </div>
                {error ? <Alert className="mb-4" type="error" showIcon closable message={error} onClose={() => setError(null)} /> : null}
                {tiers.isLoading ? (
                    <div className="flex justify-center py-20">
                        <Spin />
                    </div>
                ) : tiers.isError ? (
                    <Alert type="error" showIcon message="充值档位加载失败" description={(tiers.error as ApiError).message} action={<Button onClick={() => void tiers.refetch()}>重试</Button>} />
                ) : tiers.data?.items.length ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {tiers.data.items.map((tier) => {
                            const selected = tier.id === tierId;
                            return (
                                <Card
                                    key={tier.id}
                                    hoverable
                                    role="radio"
                                    aria-checked={selected}
                                    tabIndex={0}
                                    className={selected ? "!border-blue-500" : undefined}
                                    onClick={() => setTierId(tier.id)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") setTierId(tier.id);
                                    }}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <Typography.Title level={4} className="!mb-0">
                                            {tier.name}
                                        </Typography.Title>
                                        <Radio checked={selected} aria-label={`选择${tier.name}`} />
                                    </div>
                                    <div className="mt-5 text-3xl font-semibold">¥ {formatFenAsYuan(tier.amount_fen)}</div>
                                    <div className="mt-4 space-y-1 text-sm">
                                        <div className="flex justify-between">
                                            <span>基础积分</span>
                                            <span>{formatCredits(tier.credits_base)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>赠送积分</span>
                                            <Typography.Text type={tier.credits_bonus ? "success" : "secondary"}>+{formatCredits(tier.credits_bonus)}</Typography.Text>
                                        </div>
                                        <div className="flex justify-between border-t pt-2 font-medium">
                                            <span>到账积分</span>
                                            <span>{formatCredits(tier.credits_total)}</span>
                                        </div>
                                    </div>
                                    <Typography.Text type="secondary" className="mt-3 block text-xs">
                                        {formatCreditsPerYuan(tier.credits_total, tier.amount_fen)}
                                    </Typography.Text>
                                </Card>
                            );
                        })}
                    </div>
                ) : (
                    <Card>
                        <Empty description="暂无可用充值档位" />
                    </Card>
                )}

                {tiers.data?.items.length ? (
                    <Card className="mt-5" title="支付方式">
                        <Radio.Group value={channel} onChange={(event) => setChannel(event.target.value as PaymentChannel)}>
                            <Space size="large" wrap>
                                {channelOptions.map((option) => (
                                    <Radio key={option.value} value={option.value}>
                                        <span className="font-medium">{option.label}</span>
                                        <Typography.Text type="secondary" className="ml-2 text-xs">
                                            {option.hint}
                                        </Typography.Text>
                                    </Radio>
                                ))}
                            </Space>
                        </Radio.Group>
                        <Alert className="mt-4" type="info" showIcon message="MVP 仅支持电脑端扫码支付，请使用手机扫描下一页二维码。" />
                        <Button className="mt-4" type="primary" size="large" icon={<QrCode className="size-5" />} disabled={!tierId} loading={createOrder.isPending} onClick={submitOrder}>
                            创建支付订单
                        </Button>
                    </Card>
                ) : null}
            </div>
        </main>
    );
}
