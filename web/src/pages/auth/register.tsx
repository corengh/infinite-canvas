import { Alert, Button, Form, Input, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { authApi, type SlugAvailability } from "@/platform/auth/api";
import { retryAfterSeconds, useCountdown } from "@/platform/auth/countdown";
import { useAuthStore } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { AuthShell, CaptchaField, consumeCaptchaAttempt, ErrorAlert, passwordRules, useCaptcha } from "./components";

type RegisterValues = { phone: string; password: string; smsCode: string; captchaCode: string; teamSlug?: string };

const slugReasons: Record<NonNullable<SlugAvailability["reason"]>, string> = { exists: "该标识已被占用", reserved: "该标识为系统保留字", format: "需以小写字母开头，长度 3～32 位" };
const registerErrors: Record<string, string> = {
    PHONE_ALREADY_REGISTERED: "该手机号已注册，请直接登录",
    PHONE_BLOCKED: "暂不支持该号段",
    SMS_CODE_INVALID: "短信验证码错误",
    SMS_CODE_EXPIRED: "短信验证码已过期，请重新获取",
    TEAM_SLUG_FORMAT_INVALID: "团队标识格式不正确",
    TEAM_SLUG_RESERVED: "该团队标识为系统保留字",
    TEAM_SLUG_ALREADY_EXISTS: "该团队标识已被占用",
};

export default function RegisterPage() {
    const [form] = Form.useForm<RegisterValues>();
    const navigate = useNavigate();
    const captcha = useCaptcha();
    const countdown = useCountdown();
    const authenticate = useAuthStore((state) => state.authenticate);
    const setUser = useAuthStore((state) => state.setUser);
    const teamSlug = Form.useWatch("teamSlug", form)?.trim().toLowerCase() ?? "";
    const [slugState, setSlugState] = useState<SlugAvailability | null>(null);
    const [codeSent, setCodeSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setSlugState(null);
        if (!teamSlug) return;
        const timer = window.setTimeout(
            () =>
                void authApi
                    .slugAvailable(teamSlug)
                    .then(setSlugState)
                    .catch(() => setSlugState(null)),
            400,
        );
        return () => window.clearTimeout(timer);
    }, [teamSlug]);

    const sendCode = async () => {
        const values = await form.validateFields(["phone", "captchaCode"]).catch(() => null);
        if (!values) return;
        const { phone, captchaCode } = values;
        countdown.start(60); // 必须先禁用按钮，不能等待网络响应后再防连点。
        setSending(true);
        setError(null);
        try {
            await consumeCaptchaAttempt(
                () => authApi.registerCode(phone, captcha.captchaId, captchaCode),
                async () => {
                    form.setFieldValue("captchaCode", "");
                    await captcha.refresh();
                },
            );
            setCodeSent(true);
        } catch (cause) {
            const apiError = cause as ApiError;
            if (["SMS_RATE_LIMITED", "SMS_QUOTA_EXCEEDED", "CODE_RESEND_TOO_SOON"].includes(apiError.code)) countdown.start(retryAfterSeconds(apiError.details));
            setError(apiError.message);
        } finally {
            setSending(false);
        }
    };

    const submit = async (values: RegisterValues) => {
        setLoading(true);
        setError(null);
        try {
            const result = await authApi.register({
                phone: values.phone,
                password: values.password,
                smsCode: values.smsCode,
                captchaId: captcha.captchaId,
                captchaCode: values.captchaCode,
                teamSlug: values.teamSlug,
            });
            authenticate(result, values.phone.trim());
            void authApi
                .me()
                .then(setUser)
                .catch(() => undefined);
            navigate("/", { replace: true });
        } catch (cause) {
            const apiError = cause as ApiError;
            // 注册接口同样先消费验证码；任何业务错误后继续显示旧图都会让下一次提交必然失败。
            form.setFieldValue("captchaCode", "");
            await captcha.refresh();
            setError(registerErrors[apiError.code] ?? apiError.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell
            title="注册主账号"
            description="注册将创建一个新的团队；成员账号由团队管理员创建"
            footer={
                <>
                    已有账号？ <Link to="/login">去登录</Link>
                </>
            }
        >
            <ErrorAlert message={error} />
            {codeSent ? <Alert type="success" showIcon message="短信验证码已发送，请完成下方新图形验证码后提交注册" className="mb-4" /> : null}
            <Form<RegisterValues> form={form} layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
                <Form.Item label="手机号" name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
                    <Input inputMode="tel" autoComplete="tel" />
                </Form.Item>
                <Form.Item label="密码" name="password" rules={passwordRules()}>
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                    label="团队标识（选填）"
                    name="teamSlug"
                    validateStatus={slugState ? (slugState.available ? "success" : "error") : undefined}
                    help={slugState ? (slugState.available ? "可用" : slugReasons[slugState.reason ?? "format"]) : undefined}
                >
                    <Input placeholder="xiaoyunque" onChange={(event) => form.setFieldValue("teamSlug", event.target.value.toLowerCase())} />
                </Form.Item>
                <Typography.Paragraph type="secondary" className="!-mt-3 !mb-4 text-xs">
                    成员将用「用户名@{teamSlug || "团队标识"}」登录。注册后不可自行修改；留空则自动生成。
                </Typography.Paragraph>
                <CaptchaField image={captcha.image} loading={captcha.loading} onRefresh={() => void captcha.refresh()} />
                <Form.Item label="短信验证码" required>
                    <div className="flex gap-2">
                        <Form.Item name="smsCode" noStyle rules={[{ required: true, message: "请输入短信验证码" }]}>
                            <Input inputMode="numeric" autoComplete="one-time-code" />
                        </Form.Item>
                        <Button htmlType="button" onClick={() => void sendCode()} loading={sending} disabled={countdown.seconds > 0}>
                            {countdown.seconds > 0 ? `${countdown.seconds} 秒` : "获取验证码"}
                        </Button>
                    </div>
                </Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading} disabled={!codeSent || slugState?.available === false}>
                    注册
                </Button>
            </Form>
        </AuthShell>
    );
}
