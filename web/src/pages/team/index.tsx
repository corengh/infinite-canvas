import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { Copy, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { teamApi, type IdleRankingItem, type TeamGroup, type TeamMember } from "@/platform/api/team";
import { walletApi, type CreditRequest } from "@/platform/api/wallet";
import { useAuthStore } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { useCopyText } from "@/hooks/use-copy-text";
import { maskedPhone, ONE_TIME_SECRET_NOTICE, reclaimErrorMessage, teamSettingsBody, transferErrorMessage } from "@/platform/wallet-team/presentation";
import { invalidateCreditState, invalidateGroupState, teamKeys, walletKeys } from "@/platform/wallet-team/query-keys";

function date(value: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN") : "从未消费";
}

function credits(value: number) {
    return value.toLocaleString("zh-CN");
}

function SecretModal({ value, onClose }: { value: { loginId: string; password: string } | null; onClose: () => void }) {
    const copy = useCopyText();
    return (
        <Modal
            title="成员凭据"
            open={Boolean(value)}
            footer={
                <Button type="primary" onClick={onClose}>
                    我已妥善保存
                </Button>
            }
            closable={false}
            maskClosable={false}
        >
            <Alert type="warning" showIcon message={ONE_TIME_SECRET_NOTICE} className="mb-4" />
            <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="完整登录账号">
                    {value?.loginId}
                    <Button type="link" icon={<Copy className="size-3" />} onClick={() => value && copy(value.loginId, "登录账号已复制")}>
                        复制
                    </Button>
                </Descriptions.Item>
                <Descriptions.Item label="初始密码">
                    {value?.password}
                    <Button type="link" icon={<Copy className="size-3" />} onClick={() => value && copy(value.password, "密码已复制")}>
                        复制
                    </Button>
                </Descriptions.Item>
            </Descriptions>
        </Modal>
    );
}

function MembersTab({ groups }: { groups: TeamGroup[] }) {
    const { modal, message } = App.useApp();
    const queryClient = useQueryClient();
    const capabilities = useAuthStore((state) => state.capabilities);
    const user = useAuthStore((state) => state.user)!;
    const [createOpen, setCreateOpen] = useState(false);
    const [createPending, setCreatePending] = useState(false);
    const [createRole, setCreateRole] = useState<"leader" | "member">("member");
    const [transferMember, setTransferMember] = useState<TeamMember | null>(null);
    const [reclaimMember, setReclaimMember] = useState<TeamMember | null>(null);
    const [secret, setSecret] = useState<{ loginId: string; password: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [createForm] = Form.useForm<{ username: string; password: string; display_name: string }>();
    const [transferForm] = Form.useForm<{ amount: number; note: string }>();
    const [reclaimForm] = Form.useForm<{ amount: number; note: string }>();
    const members = useInfiniteQuery({
        queryKey: teamKeys.members(user.team.id),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => teamApi.members({ cursor: pageParam, limit: 20 }),
        getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    });
    // 子管理员看到的集合完全信任服务端 scope，不在浏览器按 group_id 再过滤。
    const rows = members.data?.pages.flatMap((page) => page.items) ?? [];
    const refresh = async () => {
        await invalidateCreditState(queryClient, { userId: user.id, teamId: user.team.id });
    };
    const submitCreate = async () => {
        let values: { username: string; password: string; display_name: string };
        try {
            values = await createForm.validateFields();
        } catch {
            // Ant Design 已在字段旁展示校验错误，不再把校验拒绝变成未处理 Promise。
            return;
        }
        setCreatePending(true);
        setError(null);
        try {
            // 密码只存在于本次函数调用和一次性弹窗，不进入 React Query Mutation Cache。
            const member = await teamApi.createMember({
                ...values,
                username: values.username.trim().toLowerCase(),
                display_name: values.display_name.trim(),
                role: createRole,
                group_id: user.role === "leader" ? user.group?.id : null,
            });
            setSecret({ loginId: member.login_id, password: values.password });
            setCreateOpen(false);
            createForm.resetFields();
            await refresh();
        } catch (cause) {
            setError((cause as ApiError).message);
        } finally {
            setCreatePending(false);
        }
    };
    const transfer = useMutation({
        mutationFn: walletApi.transfer,
        onSuccess: async () => {
            setTransferMember(null);
            transferForm.resetFields();
            message.success("划拨成功");
            await refresh();
        },
        onError: (cause) => setError(transferErrorMessage(cause as ApiError)),
    });
    const reclaim = useMutation({
        mutationFn: walletApi.reclaim,
        onSuccess: async () => {
            setReclaimMember(null);
            reclaimForm.resetFields();
            message.success("回收成功");
            await refresh();
        },
        onError: (cause) => setError(reclaimErrorMessage(cause as ApiError)),
    });
    const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Parameters<typeof teamApi.updateMember>[1] }) => teamApi.updateMember(id, body), onSuccess: refresh, onError: (cause) => setError((cause as ApiError).message) });
    const remove = useMutation({ mutationFn: teamApi.deleteMember, onSuccess: refresh, onError: (cause) => setError((cause as ApiError).message) });

    const resetPassword = (member: TeamMember) =>
        modal.confirm({
            title: `重置 ${member.display_name} 的密码？`,
            content: "该成员全部登录会话将被强制退出。新密码明文只展示这一次。",
            okText: "确认重置",
            okButtonProps: { danger: true },
            onOk: async () => {
                const result = await teamApi.resetPassword(member.id);
                setSecret({ loginId: result.login_id, password: result.password });
            },
        });
    const openMoney = (kind: "transfer" | "reclaim", member: TeamMember) => {
        kind === "transfer" ? transferForm.resetFields() : reclaimForm.resetFields();
        kind === "transfer" ? setTransferMember(member) : setReclaimMember(member);
    };
    const submitReclaim = async () => {
        const values = await reclaimForm.validateFields();
        modal.confirm({
            title: `确认从 ${reclaimMember?.display_name} 回收 ${credits(values.amount)} 积分？`,
            content: "回收会真实转移该成员的可用积分，不会触碰进行中任务的冻结积分。",
            okText: "确认回收",
            okButtonProps: { danger: true },
            onOk: () => reclaimMember && reclaim.mutateAsync({ from_user_id: reclaimMember.id, amount: values.amount, note: values.note?.trim() || "" }),
        });
    };
    const columns = [
        {
            title: "成员",
            key: "member",
            render: (_: unknown, row: TeamMember) => (
                <div>
                    <div className="font-medium">{row.display_name}</div>
                    <Typography.Text type="secondary" copyable>
                        {row.login_id}
                    </Typography.Text>
                    {row.phone ? <div className="text-xs text-stone-500">{maskedPhone(row.phone)}</div> : null}
                </div>
            ),
        },
        { title: "角色", dataIndex: "role", width: 100, render: (value: string) => ({ owner: "主账号", leader: "子管理员", member: "成员" })[value] },
        { title: "组", dataIndex: "group", width: 120, render: (value: TeamMember["group"]) => (value ? (groups.find((group) => group.id === value.id)?.name ?? value.name ?? "未命名组") : "未分组") },
        { title: "余额 / 冻结", key: "wallet", width: 150, render: (_: unknown, row: TeamMember) => `${credits(row.wallet.balance)} / ${credits(row.wallet.held)}` },
        { title: "最后消费", dataIndex: "last_consume_at", width: 180, render: date },
        { title: "状态", dataIndex: "status", width: 110, render: (value: string) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "正常" : value === "disabled_pending_settlement" ? "停用待结算" : "已停用"}</Tag> },
        {
            title: "操作",
            key: "actions",
            width: 300,
            fixed: "right" as const,
            render: (_: unknown, row: TeamMember) =>
                row.role === "owner" || row.id === user.id ? null : (
                    <Space size={4} wrap>
                        {capabilities.has("credit.transfer") ? (
                            <Button type="link" onClick={() => openMoney("transfer", row)}>
                                划拨
                            </Button>
                        ) : null}
                        {capabilities.has("credit.reclaim") ? (
                            <Button type="link" onClick={() => openMoney("reclaim", row)}>
                                回收
                            </Button>
                        ) : null}
                        {capabilities.has("member.reset_password") ? (
                            <Button type="link" onClick={() => resetPassword(row)}>
                                重置密码
                            </Button>
                        ) : null}
                        {row.status === "active" ? (
                            <Popconfirm title="停用后将自动回收可用积分，是否继续？" onConfirm={() => update.mutate({ id: row.id, body: { status: "disabled" } })}>
                                <Button type="link" danger>
                                    停用
                                </Button>
                            </Popconfirm>
                        ) : (
                            <Button type="link" onClick={() => update.mutate({ id: row.id, body: { status: "active" } })}>
                                启用
                            </Button>
                        )}
                        <Popconfirm title="删除会停用账号并回收可用积分，是否继续？" onConfirm={() => remove.mutate(row.id)}>
                            <Button type="link" danger>
                                删除
                            </Button>
                        </Popconfirm>
                        <Select
                            aria-label={`修改 ${row.display_name} 的分组`}
                            placeholder="改组"
                            size="small"
                            className="w-24"
                            allowClear
                            value={row.group?.id}
                            options={groups.map((group) => ({ value: group.id, label: group.name }))}
                            onChange={(group_id) => update.mutate({ id: row.id, body: { group_id: group_id ?? null } })}
                        />
                    </Space>
                ),
        },
    ];

    return (
        <>
            {error ? <Alert className="mb-3" type="error" showIcon closable message={error} onClose={() => setError(null)} /> : null}
            <div className="mb-3 flex justify-end gap-2">
                {capabilities.has("member.create_admin") ? (
                    <Button
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setCreateRole("leader");
                            setCreateOpen(true);
                        }}
                    >
                        创建子管理员
                    </Button>
                ) : null}
                {capabilities.has("member.create_user") ? (
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setCreateRole("member");
                            setCreateOpen(true);
                        }}
                    >
                        创建成员
                    </Button>
                ) : null}
            </div>
            <Table<TeamMember> rowKey="id" columns={columns} dataSource={rows} loading={members.isLoading} pagination={false} scroll={{ x: 1150 }} locale={{ emptyText: <Empty description="暂无成员" /> }} />
            {members.hasNextPage ? (
                <Button className="mt-3" block loading={members.isFetchingNextPage} onClick={() => void members.fetchNextPage()}>
                    加载更多
                </Button>
            ) : null}
            <Modal
                title={createRole === "leader" ? "创建子管理员" : "创建成员"}
                open={createOpen}
                confirmLoading={createPending}
                onCancel={() => setCreateOpen(false)}
                onOk={() => void submitCreate()}
                okText="创建"
            >
                <Form form={createForm} layout="vertical">
                    <Form.Item label="用户名" name="username" extra={`完整账号将是 用户名@${user.team.slug}`} rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input autoComplete="off" />
                    </Form.Item>
                    <Form.Item label="初始密码" name="password" rules={[{ required: true, min: 8, message: "请输入至少 8 位初始密码" }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item label="显示名" name="display_name" rules={[{ required: true, message: "请输入显示名" }]}>
                        <Input />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal
                title={`向 ${transferMember?.display_name ?? "成员"} 划拨`}
                open={Boolean(transferMember)}
                confirmLoading={transfer.isPending}
                onCancel={() => setTransferMember(null)}
                onOk={() => void transferForm.validateFields().then((values) => transferMember && transfer.mutate({ to_user_id: transferMember.id, amount: values.amount, note: values.note?.trim() || "" }))}
            >
                <div className="mb-4">
                    <Typography.Text>成员</Typography.Text>
                    <Select
                        className="mt-1 w-full"
                        value={transferMember?.id}
                        options={rows.filter((row) => row.role !== "owner" && row.id !== user.id).map((row) => ({ value: row.id, label: `${row.display_name}（${row.login_id}）` }))}
                        onChange={(id) => setTransferMember(rows.find((row) => row.id === id) ?? null)}
                    />
                </div>
                <MoneyForm form={transferForm} max={undefined} />
            </Modal>
            <Modal title={`从 ${reclaimMember?.display_name ?? "成员"} 回收`} open={Boolean(reclaimMember)} confirmLoading={reclaim.isPending} onCancel={() => setReclaimMember(null)} onOk={() => void submitReclaim()}>
                <div className="mb-4">
                    <Typography.Text>成员</Typography.Text>
                    <Select
                        className="mt-1 w-full"
                        value={reclaimMember?.id}
                        options={rows.filter((row) => row.role !== "owner" && row.id !== user.id).map((row) => ({ value: row.id, label: `${row.display_name}（可用 ${credits(row.wallet.available)}）` }))}
                        onChange={(id) => setReclaimMember(rows.find((row) => row.id === id) ?? null)}
                    />
                </div>
                <MoneyForm form={reclaimForm} max={reclaimMember?.wallet.available} />
            </Modal>
            <SecretModal value={secret} onClose={() => setSecret(null)} />
        </>
    );
}

function MoneyForm({ form, max }: { form: ReturnType<typeof Form.useForm<{ amount: number; note: string }>>[0]; max?: number }) {
    return (
        <Form form={form} layout="vertical">
            <Form.Item label="积分" name="amount" extra={max === undefined ? undefined : `当前可回收 ${credits(max)}`} rules={[{ required: true, message: "请输入积分" }]}>
                <InputNumber min={1} precision={0} className="w-full" />
            </Form.Item>
            <Form.Item label="备注" name="note">
                <Input.TextArea maxLength={500} rows={2} />
            </Form.Item>
        </Form>
    );
}

function IdleTab({ onReclaim }: { onReclaim: (item: IdleRankingItem) => void }) {
    const canReclaim = useAuthStore((state) => state.capabilities.has("credit.reclaim"));
    const teamId = useAuthStore((state) => state.team?.id) ?? "anonymous";
    const [days, setDays] = useState<7 | 15 | 30>(7);
    const ranking = useQuery({ queryKey: teamKeys.idle(teamId, days), queryFn: () => teamApi.idleRanking(days) });
    return (
        <>
            <Select className="mb-3 w-36" value={days} onChange={setDays} options={[7, 15, 30].map((value) => ({ value, label: `${value} 天未消费` }))} />
            <Table<IdleRankingItem>
                rowKey="user_id"
                loading={ranking.isLoading}
                dataSource={ranking.data?.items ?? []}
                pagination={false}
                columns={[
                    { title: "成员", dataIndex: "display_name" },
                    { title: "余额", dataIndex: "balance", render: credits },
                    { title: "冻结", dataIndex: "held", render: credits },
                    { title: "可用", dataIndex: "available", render: credits },
                    { title: "最后消费", dataIndex: "last_consume_at", render: date },
                    { title: "闲置天数", dataIndex: "idle_days", render: (value: number) => `${value} 天` },
                    {
                        title: "操作",
                        render: (_: unknown, row: IdleRankingItem) =>
                            canReclaim ? (
                                <Button type="link" onClick={() => onReclaim(row)}>
                                    回收
                                </Button>
                            ) : null,
                    },
                ]}
            />
        </>
    );
}

function RequestsTab() {
    const { modal, message } = App.useApp();
    const queryClient = useQueryClient();
    const user = useAuthStore((state) => state.user)!;
    const canApprove = user.capabilities.includes("credit.transfer");
    const requests = useQuery({ queryKey: walletKeys.requests(user.id), queryFn: walletApi.requests });
    const decide = useMutation({
        mutationFn: ({ id, approved, reason }: { id: string; approved: boolean; reason?: string }) => (approved ? walletApi.approveRequest(id) : walletApi.rejectRequest(id, reason)),
        onSuccess: async () => {
            message.success("申请已处理");
            await invalidateCreditState(queryClient, { userId: user.id, teamId: user.team.id });
        },
    });
    const reject = (row: CreditRequest) => {
        let reason = "";
        modal.confirm({
            title: "拒绝补拨申请",
            content: (
                <Input.TextArea
                    placeholder="请输入拒绝原因"
                    onChange={(event) => {
                        reason = event.target.value;
                    }}
                />
            ),
            okText: "确认拒绝",
            okButtonProps: { danger: true },
            onOk: () => {
                if (!reason.trim()) {
                    message.error("请输入拒绝原因");
                    return Promise.reject(new Error("拒绝原因不能为空"));
                }
                return decide.mutateAsync({ id: row.id, approved: false, reason: reason.trim() });
            },
        });
    };
    return (
        <Table<CreditRequest>
            rowKey="id"
            loading={requests.isLoading}
            dataSource={requests.data?.items ?? []}
            pagination={false}
            columns={[
                { title: "申请人", dataIndex: "requester_id", ellipsis: true },
                { title: "积分", dataIndex: "amount", render: credits },
                { title: "原因", dataIndex: "reason", render: (value: string | null) => value || "—" },
                { title: "时间", dataIndex: "created_at", render: date },
                { title: "状态", dataIndex: "status" },
                {
                    title: "操作",
                    render: (_: unknown, row: CreditRequest) =>
                        canApprove && row.status === "pending" ? (
                            <Space>
                                <Popconfirm title="批准后将从你的钱包划拨积分，是否继续？" onConfirm={() => decide.mutate({ id: row.id, approved: true })}>
                                    <Button type="link">批准</Button>
                                </Popconfirm>
                                <Button type="link" danger onClick={() => reject(row)}>
                                    拒绝
                                </Button>
                            </Space>
                        ) : null,
                },
            ]}
        />
    );
}

function GroupsTab({ groups, members }: { groups: TeamGroup[]; members: TeamMember[] }) {
    const queryClient = useQueryClient();
    const teamId = useAuthStore((state) => state.team?.id) ?? "anonymous";
    const [form] = Form.useForm<{ name: string; leader_id?: string }>();
    const create = useMutation({
        mutationFn: teamApi.createGroup,
        onSuccess: async () => {
            form.resetFields();
            await invalidateGroupState(queryClient, teamId);
        },
    });
    const update = useMutation({ mutationFn: ({ id, leader_id }: { id: string; leader_id: string | null }) => teamApi.updateGroup(id, { leader_id }), onSuccess: () => invalidateGroupState(queryClient, teamId) });
    const leaders = members.filter((member) => member.role === "leader").map((member) => ({ value: member.id, label: member.display_name }));
    return (
        <>
            <Form form={form} layout="inline" onFinish={(values) => create.mutate({ name: values.name.trim(), leader_id: values.leader_id || null })}>
                <Form.Item name="name" rules={[{ required: true, message: "请输入组名" }]}>
                    <Input placeholder="新组名称" />
                </Form.Item>
                <Form.Item name="leader_id">
                    <Select allowClear className="w-40" placeholder="指定组长（选填）" options={leaders} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={create.isPending}>
                    创建组
                </Button>
            </Form>
            <Table<TeamGroup>
                className="mt-4"
                rowKey="id"
                dataSource={groups}
                pagination={false}
                columns={[
                    { title: "组名", dataIndex: "name" },
                    {
                        title: "组长",
                        dataIndex: "leader_id",
                        render: (value: string | null, row: TeamGroup) => (
                            <Select allowClear className="w-44" placeholder="未指定" value={value ?? undefined} options={leaders} onChange={(leader_id) => update.mutate({ id: row.id, leader_id: leader_id ?? null })} />
                        ),
                    },
                ]}
            />
        </>
    );
}

function SettingsTab() {
    const team = useAuthStore((state) => state.team)!;
    const setUser = useAuthStore((state) => state.setUser);
    const user = useAuthStore((state) => state.user)!;
    const [form] = Form.useForm<{ name: string }>();
    const save = useMutation({
        mutationFn: (values: { name: string }) => teamApi.updateSettings(teamSettingsBody(values.name)),
        onSuccess: (updated) => {
            setUser({ ...user, team: { ...team, name: updated.name } });
        },
    });
    return (
        <Form form={form} layout="vertical" initialValues={{ name: team.name }} className="max-w-xl" onFinish={(values) => save.mutate(values)}>
            <Form.Item label="团队名称" name="name" rules={[{ required: true, message: "请输入团队名称" }]}>
                <Input />
            </Form.Item>
            <Form.Item label="团队标识" extra={<>成员登录账号后缀，如 zhangsan@{team.slug}。如需修改请联系平台客服。</>}>
                <Input value={team.slug} readOnly />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
                保存设置
            </Button>
        </Form>
    );
}

function ConsumptionTab() {
    const teamId = useAuthStore((state) => state.team?.id) ?? "anonymous";
    const consumption = useInfiniteQuery({
        queryKey: teamKeys.consumption(teamId),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => teamApi.consumption({ cursor: pageParam, limit: 20 }),
        getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    });
    const rows = consumption.data?.pages.flatMap((page) => page.items) ?? [];
    return (
        <>
            <Table
                rowKey="id"
                loading={consumption.isLoading}
                dataSource={rows}
                pagination={false}
                locale={{ emptyText: <Empty description="暂无团队消耗记录" /> }}
                columns={[
                    { title: "成员", dataIndex: "display_name", render: (value: string | undefined, row: { user_id: string }) => value || row.user_id },
                    { title: "模型", dataIndex: "model_code" },
                    { title: "消耗积分", dataIndex: "credits", render: credits },
                    { title: "时间", dataIndex: "created_at", render: date },
                ]}
            />
            {consumption.hasNextPage ? (
                <Button className="mt-3" block onClick={() => void consumption.fetchNextPage()}>
                    加载更多
                </Button>
            ) : null}
        </>
    );
}

export default function TeamPage() {
    const queryClient = useQueryClient();
    const role = useAuthStore((state) => state.role);
    const capabilities = useAuthStore((state) => state.capabilities);
    const userId = useAuthStore((state) => state.user?.id) ?? "anonymous";
    const teamId = useAuthStore((state) => state.team?.id) ?? "anonymous";
    const groupsQuery = useQuery({ queryKey: teamKeys.groups(teamId), queryFn: teamApi.groups, enabled: role !== "member" });
    const membersQuery = useQuery({ queryKey: teamKeys.memberOptions(teamId), queryFn: () => teamApi.members({ limit: 200 }), enabled: role !== "member" });
    const [idleTarget, setIdleTarget] = useState<IdleRankingItem | null>(null);
    const [idleForm] = Form.useForm<{ amount: number; note: string }>();
    const { modal, message } = App.useApp();
    const groups = groupsQuery.data?.items ?? [];
    const members = membersQuery.data?.items ?? [];
    const tabs = useMemo(() => {
        const items = [{ key: "members", label: "成员", children: <MembersTab groups={groups} /> }];
        if (capabilities.has("ledger.view_team"))
            items.push({ key: "idle", label: "闲置排行", children: <IdleTab onReclaim={setIdleTarget} /> }, { key: "requests", label: "补拨审批", children: <RequestsTab /> }, { key: "consumption", label: "团队消耗", children: <ConsumptionTab /> });
        if (capabilities.has("member.create_admin")) items.push({ key: "groups", label: "组管理", children: <GroupsTab groups={groups} members={members} /> });
        if (capabilities.has("team.settings_manage")) items.push({ key: "settings", label: "团队设置", children: <SettingsTab /> });
        return items;
    }, [capabilities, groups, members]);
    if (role === "member")
        return (
            <main className="p-6">
                <Alert type="warning" showIcon message="当前账号无团队管理权限" />
            </main>
        );
    const reclaimIdle = async () => {
        const values = await idleForm.validateFields();
        modal.confirm({
            title: `确认从 ${idleTarget?.display_name} 回收 ${credits(values.amount)} 积分？`,
            content: "这是手动回收操作，只会转移可用积分。",
            okButtonProps: { danger: true },
            onOk: async () => {
                if (!idleTarget) return;
                try {
                    await walletApi.reclaim({ from_user_id: idleTarget.user_id, amount: values.amount, note: values.note || "回收闲置" });
                    if (userId !== "anonymous" && teamId !== "anonymous") {
                        await invalidateCreditState(queryClient, { userId, teamId });
                    }
                    setIdleTarget(null);
                    message.success("回收成功");
                } catch (cause) {
                    message.error(reclaimErrorMessage(cause as ApiError));
                }
            },
        });
    };
    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-7xl">
                <Typography.Title level={2} className="!mb-1">
                    团队管理
                </Typography.Title>
                <Typography.Paragraph type="secondary">管理成员、积分分配、闲置余额与团队设置。</Typography.Paragraph>
                <Card>
                    <Tabs items={tabs} />
                </Card>
            </div>
            <Modal title={`回收 ${idleTarget?.display_name ?? "成员"} 的闲置积分`} open={Boolean(idleTarget)} onCancel={() => setIdleTarget(null)} onOk={() => void reclaimIdle()}>
                <MoneyForm form={idleForm} max={idleTarget?.available} />
            </Modal>
        </main>
    );
}
