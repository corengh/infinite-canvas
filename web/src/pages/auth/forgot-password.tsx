import { Button, Form, Input } from "antd";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { authApi } from "@/platform/auth/api";
import { retryAfterSeconds, useCountdown } from "@/platform/auth/countdown";
import { ApiError } from "@/platform/http/errors";
import { AuthShell, CaptchaField, ErrorAlert, useCaptcha } from "./components";

type Values = { phone: string; captchaCode: string };

export default function ForgotPasswordPage() {
    const [form] = Form.useForm<Values>();
    const navigate = useNavigate();
    const captcha = useCaptcha();
    const countdown = useCountdown();
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async ({ phone, captchaCode }: Values) => {
        countdown.start(60);
        setSending(true);
        setError(null);
        try {
            await authApi.forgotPassword(phone, captcha.captchaId, captchaCode);
            navigate("/reset-password", { state: { phone: phone.trim() } });
        } catch (cause) {
            const apiError = cause as ApiError;
            if (["SMS_RATE_LIMITED", "SMS_QUOTA_EXCEEDED", "CODE_RESEND_TOO_SOON"].includes(apiError.code)) countdown.start(retryAfterSeconds(apiError.details));
            // 服务端已一次性消费本次挑战，所有失败分支都必须展示一张新图。
            form.setFieldValue("captchaCode", "");
            await captcha.refresh();
            setError(apiError.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <AuthShell title="找回密码" description="输入已验证的手机号获取短信验证码" footer={<Link to="/login">返回登录</Link>}>
            <ErrorAlert message={error} />
            <Form<Values> form={form} layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
                <Form.Item label="手机号" name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
                    <Input inputMode="tel" autoComplete="tel" />
                </Form.Item>
                <CaptchaField image={captcha.image} loading={captcha.loading} onRefresh={() => void captcha.refresh()} />
                <Button type="primary" htmlType="submit" block loading={sending} disabled={countdown.seconds > 0}>
                    {countdown.seconds > 0 ? `${countdown.seconds} 秒后可重试` : "获取短信验证码"}
                </Button>
            </Form>
        </AuthShell>
    );
}
