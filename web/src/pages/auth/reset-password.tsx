import { Alert, Button, Form, Input } from "antd";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { authApi } from "@/platform/auth/api";
import { ApiError } from "@/platform/http/errors";
import { AuthShell, ErrorAlert, passwordRules } from "./components";

type Values = { phone: string; smsCode: string; newPassword: string };

export default function ResetPasswordPage() {
    const location = useLocation();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const submit = async (values: Values) => {
        setLoading(true);
        setError(null);
        try {
            await authApi.resetPassword(values.phone, values.smsCode, values.newPassword);
            setDone(true);
        } catch (cause) {
            setError((cause as ApiError).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell title="设置新密码" description="短信验证码有效期为 10 分钟" footer={<Link to="/login">返回登录</Link>}>
            {done ? (
                <Alert type="success" showIcon message="密码已重置" description="全部设备已退出，请重新登录" />
            ) : (
                <>
                    <ErrorAlert message={error} />
                    <Form<Values> layout="vertical" initialValues={{ phone: (location.state as { phone?: string } | null)?.phone }} onFinish={(values) => void submit(values)} requiredMark={false}>
                        <Form.Item label="手机号" name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
                            <Input inputMode="tel" autoComplete="tel" />
                        </Form.Item>
                        <Form.Item label="短信验证码" name="smsCode" rules={[{ required: true, message: "请输入短信验证码" }]}>
                            <Input inputMode="numeric" autoComplete="one-time-code" />
                        </Form.Item>
                        <Form.Item label="新密码" name="newPassword" rules={passwordRules()}>
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block loading={loading}>
                            重置密码
                        </Button>
                    </Form>
                </>
            )}
        </AuthShell>
    );
}
