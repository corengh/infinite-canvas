import { Alert, Button, Card, Divider, Form, Input, Typography } from "antd";
import { useState } from "react";

import { authApi } from "@/platform/auth/api";
import { retryAfterSeconds, useCountdown } from "@/platform/auth/countdown";
import { useAuthStore } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { CaptchaField, consumeCaptchaAttempt, ErrorAlert, passwordRules, useCaptcha } from "@/pages/auth/components";

export default function AccountSettingsPage() {
    const user = useAuthStore((state) => state.user)!;
    const setUser = useAuthStore((state) => state.setUser);
    const captcha = useCaptcha();
    const countdown = useCountdown();
    const [profileLoading, setProfileLoading] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [bindSending, setBindSending] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bindForm] = Form.useForm<{ phone: string; captchaCode: string; smsCode: string }>();

    const saveProfile = async (values: { displayName: string; email?: string }) => {
        setProfileLoading(true);
        setError(null);
        try {
            setUser(await authApi.updateMe({ display_name: values.displayName.trim(), email: values.email?.trim() || null }));
            setMessage("账号资料已保存");
        } catch (cause) {
            setError((cause as ApiError).message);
        } finally {
            setProfileLoading(false);
        }
    };

    const changePassword = async (values: { oldPassword: string; newPassword: string }) => {
        setPasswordLoading(true);
        setError(null);
        try {
            await authApi.changePassword(values.oldPassword, values.newPassword);
            setMessage("密码已修改，其他设备的会话已退出");
        } catch (cause) {
            setError((cause as ApiError).message);
        } finally {
            setPasswordLoading(false);
        }
    };

    const sendBindCode = async () => {
        const values = await bindForm.validateFields(["phone", "captchaCode"]).catch(() => null);
        if (!values) return;
        countdown.start(60);
        setBindSending(true);
        setError(null);
        try {
            await consumeCaptchaAttempt(
                () => authApi.bindPhoneCode(values.phone, captcha.captchaId, values.captchaCode),
                async () => {
                    bindForm.setFieldValue("captchaCode", "");
                    await captcha.refresh();
                },
            );
            setMessage("短信验证码已发送");
        } catch (cause) {
            const apiError = cause as ApiError;
            if (["SMS_RATE_LIMITED", "SMS_QUOTA_EXCEEDED", "CODE_RESEND_TOO_SOON"].includes(apiError.code)) countdown.start(retryAfterSeconds(apiError.details));
            setError(apiError.message);
        } finally {
            setBindSending(false);
        }
    };

    const bindPhone = async (values: { phone: string; smsCode: string }) => {
        setError(null);
        try {
            const result = await authApi.bindPhone(values.phone, values.smsCode);
            setUser({ ...user, phone: result.phone, phone_verified: result.phone_verified });
            setMessage("手机号已绑定，现在可以用手机号登录和自助找回密码");
        } catch (cause) {
            setError((cause as ApiError).message);
        }
    };

    return (
        <main className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
                <Typography.Title level={2}>账号设置</Typography.Title>
                <ErrorAlert message={error} />
                {message ? <Alert type="success" showIcon message={message} closable onClose={() => setMessage(null)} className="mb-4" /> : null}
                <Card title="基本资料">
                    <Form layout="vertical" initialValues={{ displayName: user.display_name, email: user.email ?? "" }} onFinish={(values) => void saveProfile(values)}>
                        <Form.Item label="显示名称" name="displayName" rules={[{ required: true, message: "请输入显示名称" }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item label="邮箱（选填）" name="email" rules={[{ type: "email", message: "请输入正确的邮箱" }]}>
                            <Input autoComplete="email" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={profileLoading}>
                            保存资料
                        </Button>
                    </Form>
                </Card>
                <Card title="修改密码" className="mt-4">
                    <Form layout="vertical" onFinish={(values) => void changePassword(values)}>
                        <Form.Item label="当前密码" name="oldPassword" rules={[{ required: true, message: "请输入当前密码" }]}>
                            <Input.Password autoComplete="current-password" />
                        </Form.Item>
                        <Form.Item label="新密码" name="newPassword" rules={passwordRules()}>
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={passwordLoading}>
                            修改密码
                        </Button>
                    </Form>
                    <Divider />
                    <Typography.Text type="secondary">{user.phone_verified ? "已绑定验证手机号，可通过登录页自助找回密码。" : "该账号未绑定验证手机号；忘记密码时请联系你的管理员重置密码。"}</Typography.Text>
                </Card>
                {user.account_type === "sub" && !user.phone_verified ? (
                    <Card title="绑定手机号" className="mt-4">
                        <Typography.Paragraph type="secondary">绑定并验证后可用手机号登录及自助找回密码。MVP 暂不支持自行换绑。</Typography.Paragraph>
                        <Form form={bindForm} layout="vertical" onFinish={(values) => void bindPhone(values)}>
                            <Form.Item label="手机号" name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
                                <Input inputMode="tel" />
                            </Form.Item>
                            <CaptchaField image={captcha.image} loading={captcha.loading} onRefresh={() => void captcha.refresh()} />
                            <Form.Item label="短信验证码" required>
                                <div className="flex gap-2">
                                    <Form.Item name="smsCode" noStyle rules={[{ required: true, message: "请输入短信验证码" }]}>
                                        <Input inputMode="numeric" />
                                    </Form.Item>
                                    <Button htmlType="button" onClick={() => void sendBindCode()} loading={bindSending} disabled={countdown.seconds > 0}>
                                        {countdown.seconds > 0 ? `${countdown.seconds} 秒` : "获取验证码"}
                                    </Button>
                                </div>
                            </Form.Item>
                            <Button type="primary" htmlType="submit">
                                确认绑定
                            </Button>
                        </Form>
                    </Card>
                ) : null}
            </div>
        </main>
    );
}
