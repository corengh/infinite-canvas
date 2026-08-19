import type { ReactNode } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { authApi } from "@/platform/auth/api";

export function AuthShell({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
    return (
        <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-10 dark:bg-stone-950">
            <Card className="w-full max-w-md">
                <Link to="/" className="mb-7 flex items-center gap-2 text-stone-900 dark:text-stone-100">
                    <span className="size-6 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    <span className="font-medium">AIGC Studio</span>
                </Link>
                <Typography.Title level={2} className="!mb-1">
                    {title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" className="!mb-6">
                    {description}
                </Typography.Paragraph>
                {children}
                {footer ? <div className="mt-6 text-center text-sm text-stone-500">{footer}</div> : null}
            </Card>
        </main>
    );
}

export function ErrorAlert({ message }: { message: string | null }) {
    return message ? <Alert type="error" showIcon message={message} className="mb-4" /> : null;
}

export async function consumeCaptchaAttempt<T>(request: () => Promise<T>, renew: () => Promise<void>): Promise<T> {
    try {
        return await request();
    } finally {
        // 服务端以 GETDEL 消费挑战，即使后续业务校验失败也不能再显示旧验证码。
        await renew();
    }
}

export function useCaptcha() {
    const [captchaId, setCaptchaId] = useState("");
    const [image, setImage] = useState("");
    const [loading, setLoading] = useState(false);
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const result = await authApi.captcha();
            setCaptchaId(result.captcha_id);
            setImage(result.image_base64);
        } catch {
            // 加载失败时保留刷新入口，不让初始化 Promise 变成未处理异常。
            setCaptchaId("");
            setImage("");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => void refresh(), [refresh]);
    return { captchaId, image, loading, refresh };
}

export function CaptchaField({ image, loading, onRefresh }: { image: string; loading: boolean; onRefresh: () => void }) {
    const src = image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
    return (
        <Form.Item label="图形验证码" required>
            <div className="flex gap-2">
                <Form.Item name="captchaCode" noStyle rules={[{ required: true, message: "请输入图形验证码" }]}>
                    <Input autoComplete="off" placeholder="请输入图片中的字符" />
                </Form.Item>
                <Button htmlType="button" className="h-8 min-w-28 overflow-hidden !p-0" loading={loading} onClick={onRefresh} aria-label="刷新图形验证码">
                    {image ? <img src={src} alt="图形验证码，点击刷新" className="h-full w-full object-cover" /> : <RefreshCw className="size-4" />}
                </Button>
            </div>
        </Form.Item>
    );
}

export function passwordRules() {
    return [
        { required: true, message: "请输入密码" },
        { min: 8, message: "密码至少 8 位" },
        { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: "密码需同时包含字母和数字" },
    ];
}
