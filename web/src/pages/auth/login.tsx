import { Button, Form, Input } from "antd";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "@/platform/http/errors";
import { authApi } from "@/platform/auth/api";
import { retryAfterSeconds, useCountdown } from "@/platform/auth/countdown";
import { useAuthStore } from "@/platform/auth/store";
import { AuthShell, ErrorAlert } from "./components";

type LoginValues = { loginId: string; password: string };

export function loginRedirectTarget(state: unknown): string {
    const from = (state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
    return from ? `${from.pathname ?? "/"}${from.search ?? ""}${from.hash ?? ""}` : "/";
}

export default function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const authenticate = useAuthStore((state) => state.authenticate);
    const setUser = useAuthStore((state) => state.setUser);
    const status = useAuthStore((state) => state.status);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const lock = useCountdown();

    useEffect(() => {
        if (status === "authed") navigate("/", { replace: true });
    }, [navigate, status]);

    const submit = async ({ loginId, password }: LoginValues) => {
        const normalized = loginId.trim().toLowerCase();
        setLoading(true);
        setError(null);
        try {
            authenticate(await authApi.login(normalized, password), normalized);
            void authApi
                .me()
                .then(setUser)
                .catch(() => undefined);
            navigate(loginRedirectTarget(location.state), { replace: true });
        } catch (cause) {
            const apiError = cause as ApiError;
            if (apiError.code === "ACCOUNT_LOCKED") lock.start(retryAfterSeconds(apiError.details, 15 * 60));
            setError(apiError.code === "ACCOUNT_LOCKED" ? `登录尝试过多，请在 ${retryAfterSeconds(apiError.details, 15 * 60)} 秒后重试` : apiError.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell
            title="登录"
            description="使用主账号手机号，或成员账号登录"
            footer={
                <>
                    还没有账号？ <Link to="/register">注册主账号</Link>
                </>
            }
        >
            <ErrorAlert message={error} />
            <Form<LoginValues> layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
                <Form.Item label="账号" name="loginId" rules={[{ required: true, message: "请输入账号" }]}>
                    {/* 不做格式校验或分流，避免泄露账号是否存在。 */}
                    <Input autoComplete="username" placeholder="13800138000 或 zhangsan@xiaoyunque" />
                </Form.Item>
                <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                    <Input.Password autoComplete="current-password" />
                </Form.Item>
                <div className="mb-4 text-right text-sm">
                    <Link to="/forgot-password">忘记密码？</Link>
                </div>
                <Button type="primary" htmlType="submit" block loading={loading} disabled={lock.seconds > 0}>
                    {lock.seconds > 0 ? `${lock.seconds} 秒后重试` : "登录"}
                </Button>
            </Form>
        </AuthShell>
    );
}
