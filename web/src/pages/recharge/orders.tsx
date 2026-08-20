import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Table, Tag, Typography } from "antd";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { rechargeApi, type OrderStatus, type RechargeOrder } from "@/platform/api/recharge";
import { useAuthStore } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { formatCredits, formatFenAsYuan } from "@/platform/recharge/presentation";
import { rechargeKeys } from "@/platform/recharge/query-keys";

const statusLabels: Record<OrderStatus, { label: string; color: string }> = {
    pending: { label: "待支付", color: "processing" },
    paid: { label: "已支付", color: "success" },
    closed: { label: "已关闭", color: "default" },
    refunded: { label: "已退款", color: "warning" },
    amount_mismatch: { label: "金额异常", color: "error" },
};
const channelLabels = { alipay: "支付宝", wechat: "微信支付" } as const;

export default function RechargeOrdersPage() {
    const navigate = useNavigate();
    const userId = useAuthStore((state) => state.user?.id) ?? "anonymous";
    const owner = useAuthStore((state) => state.role) === "owner";
    const orders = useQuery({ queryKey: rechargeKeys.orders(userId), queryFn: rechargeApi.orders, enabled: owner });

    if (!owner)
        return (
            <main className="h-full overflow-y-auto p-6">
                <Alert type="warning" showIcon message="仅主账号可查看充值订单" />
            </main>
        );

    const columns = [
        { title: "创建时间", dataIndex: "created_at", width: 180, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
        { title: "状态", dataIndex: "status", width: 100, render: (value: OrderStatus) => <Tag color={statusLabels[value].color}>{statusLabels[value].label}</Tag> },
        { title: "渠道", dataIndex: "channel", width: 100, render: (value: RechargeOrder["channel"]) => channelLabels[value] },
        { title: "金额", dataIndex: "amount_fen", width: 120, render: (value: number) => `¥ ${formatFenAsYuan(value)}` },
        { title: "积分", dataIndex: "credits_total", width: 120, render: formatCredits },
        { title: "渠道流水号", dataIndex: "channel_trade_no", width: 220, ellipsis: true, render: (value: string | null) => value || "—" },
        { title: "商户订单号", dataIndex: "out_trade_no", width: 220, ellipsis: true },
        {
            title: "操作",
            key: "action",
            fixed: "right" as const,
            width: 110,
            render: (_: unknown, row: RechargeOrder) =>
                row.status === "pending" ? (
                    <Button type="link" onClick={() => navigate(`/recharge/orders/${row.order_id}`, { state: { order: row, ownerUserId: userId } })}>
                        继续支付
                    </Button>
                ) : null,
        },
    ];

    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                        <Typography.Title level={2} className="!mb-1">
                            充值记录
                        </Typography.Title>
                        <Typography.Text type="secondary">查看自己的支付订单与渠道凭证。</Typography.Text>
                    </div>
                    <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/recharge")}>
                        返回充值
                    </Button>
                </div>
                {orders.isError ? <Alert className="mb-4" type="error" showIcon message="订单加载失败" description={(orders.error as ApiError).message} /> : null}
                <Card>
                    <Table<RechargeOrder> rowKey="order_id" columns={columns} dataSource={orders.data?.items ?? []} loading={orders.isLoading} pagination={false} locale={{ emptyText: <Empty description="暂无充值订单" /> }} scroll={{ x: 1180 }} />
                </Card>
            </div>
        </main>
    );
}
