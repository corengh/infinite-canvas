import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tooltip, Typography } from "antd";
import { CircleDollarSign, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { walletApi, type LedgerItem, type LedgerType } from "@/platform/api/wallet";
import { useAuthStore } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { balanceValues } from "@/platform/wallet-team/presentation";
import { walletKeys } from "@/platform/wallet-team/query-keys";

const ledgerLabels: Record<LedgerType, string> = {
    recharge: "充值",
    consume: "消耗",
    transfer_out: "划拨出账",
    transfer_in: "划拨入账",
    reclaim_out: "回收出账",
    reclaim_in: "回收入账",
    admin_adjust: "调账",
    refund_deduct: "退款扣回",
};

function credits(value: number) {
    return value.toLocaleString("zh-CN");
}

export default function WalletPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const role = useAuthStore((state) => state.role);
    const userId = useAuthStore((state) => state.user?.id) ?? "anonymous";
    const canRequest = useAuthStore((state) => state.capabilities.has("credit.request"));
    const [ledgerType, setLedgerType] = useState<LedgerType | undefined>();
    const [requestOpen, setRequestOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [requestForm] = Form.useForm<{ amount: number; reason: string }>();
    const balance = useQuery({ queryKey: walletKeys.balance(userId), queryFn: walletApi.balance });
    const ledger = useInfiniteQuery({
        queryKey: walletKeys.ledger(userId, ledgerType ?? "all"),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => walletApi.ledger({ type: ledgerType, cursor: pageParam, limit: 20 }),
        getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    });
    const createRequest = useMutation({
        mutationFn: walletApi.createRequest,
        onSuccess: async () => {
            setRequestOpen(false);
            requestForm.resetFields();
            await queryClient.invalidateQueries({ queryKey: walletKeys.requests(userId) });
        },
        onError: (cause) => setError((cause as ApiError).message),
    });

    const snapshot = balance.data ? balanceValues(balance.data) : null;
    const rows = ledger.data?.pages.flatMap((page) => page.items) ?? [];
    const columns = [
        { title: "时间", dataIndex: "created_at", width: 180, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
        { title: "类型", dataIndex: "type", width: 110, render: (value: LedgerType) => ledgerLabels[value] },
        {
            title: "变动",
            dataIndex: "delta",
            width: 120,
            render: (value: number) => (
                <Typography.Text type={value < 0 ? "danger" : "success"}>
                    {value > 0 ? "+" : ""}
                    {credits(value)}
                </Typography.Text>
            ),
        },
        { title: "变动后余额", dataIndex: "balance_after", width: 130, render: credits },
        { title: "备注", dataIndex: "note", ellipsis: true, render: (value: string | null, row: LedgerItem) => value || row.model_code || "—" },
    ];

    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <Typography.Title level={2} className="!mb-1">
                            钱包
                        </Typography.Title>
                        <Typography.Text type="secondary">查看可用积分、冻结占用与完整流水。</Typography.Text>
                    </div>
                    <Space>
                        {role === "owner" ? (
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => navigate("/recharge")}>
                                充值
                            </Button>
                        ) : null}
                        {canRequest ? (
                            <Button type="primary" icon={<CircleDollarSign className="size-4" />} onClick={() => setRequestOpen(true)}>
                                申请补拨
                            </Button>
                        ) : null}
                    </Space>
                </div>
                {error ? <Alert className="mb-4" type="error" showIcon closable message={error} onClose={() => setError(null)} /> : null}
                <Card loading={balance.isLoading}>
                    {snapshot ? (
                        <div>
                            <Typography.Text type="secondary">可用余额</Typography.Text>
                            <div className="mt-1 text-4xl font-semibold tracking-tight">✦ {credits(snapshot.available)}</div>
                            <div className="mt-3 text-sm text-stone-500 dark:text-stone-400">
                                账面 {credits(snapshot.balance)} ·{" "}
                                <Tooltip title={`${balance.data?.active_hold_count ?? 0} 个进行中任务占用`}>
                                    <span className="cursor-help border-b border-dotted">冻结 {credits(snapshot.held)}</span>
                                </Tooltip>
                            </div>
                        </div>
                    ) : balance.isError ? (
                        <Alert type="error" message="余额加载失败" />
                    ) : null}
                </Card>
                <Card className="mt-4" title="积分流水" extra={<Select allowClear placeholder="全部类型" className="w-36" value={ledgerType} onChange={setLedgerType} options={Object.entries(ledgerLabels).map(([value, label]) => ({ value, label }))} />}>
                    <Table<LedgerItem> rowKey="id" columns={columns} dataSource={rows} loading={ledger.isLoading} pagination={false} locale={{ emptyText: <Empty description="暂无流水" /> }} scroll={{ x: 760 }} />
                    {ledger.hasNextPage ? (
                        <Button className="mt-4" block loading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
                            加载更多
                        </Button>
                    ) : null}
                </Card>
            </div>
            <Modal
                title="申请补拨积分"
                open={requestOpen}
                okText="提交申请"
                cancelText="取消"
                confirmLoading={createRequest.isPending}
                onCancel={() => setRequestOpen(false)}
                onOk={() => void requestForm.validateFields().then((values) => createRequest.mutate({ amount: values.amount, reason: values.reason.trim() }))}
            >
                <Form form={requestForm} layout="vertical">
                    <Form.Item label="申请积分" name="amount" rules={[{ required: true, message: "请输入申请积分" }]}>
                        <InputNumber min={1} precision={0} className="w-full" />
                    </Form.Item>
                    <Form.Item label="申请原因" name="reason" rules={[{ required: true, message: "请输入申请原因" }]}>
                        <Input.TextArea maxLength={500} showCount rows={3} />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
