import { Alert, Button, Form, Input, Modal, Typography } from "antd";
import { useEffect, useState } from "react";

import { ApiError } from "@/platform/http/errors";
import { authApi } from "./api";
import { canvasSyncControl } from "./canvas-sync-control";
import { authEvents } from "./events";
import { authStore, useAuthStore } from "./store";

export async function reloginCurrentSession(loginId: string, password: string): Promise<void> {
    authStore.getState().authenticate(await authApi.login(loginId, password), loginId);
    void authApi
        .me()
        .then((user) => authStore.getState().setUser(user))
        .catch(() => undefined);
    // 登录失败会在上方直接抛出，暂停门闩只能在新会话建立后恢复。
    await canvasSyncControl.resume();
}

export function ReloginOverlay() {
    const loginId = useAuthStore((state) => state.loginId);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(
        () =>
            authEvents.on("session-expired", () => {
                // 只覆盖当前页面并暂停提交，绝不操作路由或卸载画布 DOM。
                canvasSyncControl.pause();
                setOpen(true);
            }),
        [],
    );

    const submit = async ({ account, password }: { account?: string; password: string }) => {
        const effectiveLoginId = loginId ?? account?.trim().toLowerCase();
        if (!effectiveLoginId) return;
        setLoading(true);
        setError(null);
        try {
            await reloginCurrentSession(effectiveLoginId, password);
            setOpen(false);
        } catch (cause) {
            setError((cause as ApiError).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal open={open} closable={false} maskClosable={false} keyboard={false} footer={null} title="登录已过期" width={420}>
            <Typography.Paragraph type="secondary">当前页面和未提交的画布操作已保留。完成账号验证后会继续同步。</Typography.Paragraph>
            {error ? <Alert type="error" showIcon message={error} className="mb-4" /> : null}
            <Form layout="vertical" onFinish={(values) => void submit(values)}>
                {loginId ? (
                    <Form.Item label="账号">
                        <Input value={loginId} disabled />
                    </Form.Item>
                ) : (
                    <>
                        <Alert type="warning" showIcon message="当前标签页没有保存登录账号，请补充账号后继续验证。" className="mb-4" />
                        <Form.Item label="账号" name="account" rules={[{ required: true, message: "请输入账号" }]}>
                            <Input autoFocus autoComplete="username" placeholder="13800138000 或 zhangsan@xiaoyunque" />
                        </Form.Item>
                    </>
                )}
                <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                    <Input.Password autoFocus={Boolean(loginId)} autoComplete="current-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                    重新登录
                </Button>
            </Form>
        </Modal>
    );
}
