import { Button, Card, Empty, List, Popconfirm, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { authApi, type SessionDTO } from "@/platform/auth/api";
import { ApiError } from "@/platform/http/errors";
import { ErrorAlert } from "@/pages/auth/components";

export default function SessionsPage() {
    const [items, setItems] = useState<SessionDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            setItems(await authApi.sessions());
        } catch (cause) {
            setError((cause as ApiError).message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => void load(), []);

    const revoke = async (id: string) => {
        try {
            await authApi.revokeSession(id);
            setItems((current) => current.filter((item) => item.id !== id));
        } catch (cause) {
            setError((cause as ApiError).message);
        }
    };

    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-3xl">
                <Typography.Title level={2}>登录设备</Typography.Title>
                <Typography.Paragraph type="secondary">查看并远程退出不再使用的设备。</Typography.Paragraph>
                <ErrorAlert message={error} />
                <Card loading={loading}>
                    <List
                        dataSource={items}
                        locale={{ emptyText: <Empty description="暂无登录设备" /> }}
                        renderItem={(item) => (
                            <List.Item
                                actions={[
                                    <Popconfirm key="revoke" title="确定退出这个设备吗？" onConfirm={() => void revoke(item.id)}>
                                        <Button danger type="link">
                                            远程登出
                                        </Button>
                                    </Popconfirm>,
                                ]}
                            >
                                <List.Item.Meta title={item.device_name || "未知设备"} description={`${item.ip} · 最近活动 ${dayjs(item.last_seen_at).format("YYYY-MM-DD HH:mm")}`} />
                            </List.Item>
                        )}
                    />
                </Card>
            </div>
        </main>
    );
}
