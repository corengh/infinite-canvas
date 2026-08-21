import { api } from "@/platform/http/client";
import type { AuthResult, UserDTO } from "./store";

export type CaptchaDTO = { captcha_id: string; image_base64: string; expires_in: number };
export type SendCodeResult = { sent: boolean; resend_after: number };
export type SlugAvailability = { available: boolean; reason?: "exists" | "reserved" | "format" };
export type SessionDTO = { id: string; device_name: string | null; ip: string; created_at: string; last_seen_at: string };

function deviceName(): string {
    if (typeof navigator === "undefined") return "浏览器";
    return navigator.userAgent.slice(0, 200);
}

export const authApi = {
    me: () => api.get<UserDTO>("/me"),
    captcha: () => api.post<CaptchaDTO>("/auth/captcha", undefined, { auth: "public" }),
    login: (loginId: string, password: string) => api.post<AuthResult>("/auth/login", { login_id: loginId.trim().toLowerCase(), password, device_name: deviceName() }, { auth: "public" }),
    registerCode: (phone: string, captchaId: string, captchaCode: string) => api.post<SendCodeResult>("/auth/register/code", { phone: phone.trim(), captcha_id: captchaId, captcha_code: captchaCode.trim() }, { auth: "public" }),
    register: (input: { phone: string; password: string; smsCode: string; captchaId: string; captchaCode: string; teamSlug?: string }) =>
        api.post<AuthResult>(
            "/auth/register",
            {
                phone: input.phone.trim(),
                password: input.password,
                sms_code: input.smsCode.trim(),
                captcha_id: input.captchaId,
                captcha_code: input.captchaCode.trim(),
                team_slug: input.teamSlug?.trim().toLowerCase() || undefined,
                device_name: deviceName(),
            },
            { auth: "public" },
        ),
    slugAvailable: (slug: string) => api.get<SlugAvailability>(`/auth/team-slug/available?slug=${encodeURIComponent(slug.trim().toLowerCase())}`, { auth: "public" }),
    forgotPassword: (phone: string, captchaId: string, captchaCode: string) => api.post<SendCodeResult>("/auth/password/forgot", { phone: phone.trim(), captcha_id: captchaId, captcha_code: captchaCode.trim() }, { auth: "public" }),
    resetPassword: (phone: string, smsCode: string, newPassword: string) => api.post<{ ok: boolean }>("/auth/password/reset", { phone: phone.trim(), sms_code: smsCode.trim(), new_password: newPassword }, { auth: "public" }),
    logout: () => api.post<{ ok: boolean }>("/auth/logout"),
    updateMe: (input: { display_name?: string; email?: string | null; avatar_url?: string }) => api.patch<UserDTO>("/me", input),
    updatePreferences: (input: { default_models?: Partial<Record<"text2image" | "image2image" | "text2video" | "image2video" | "text" | "audio", string>> }) => api.patch<Record<string, unknown>>("/me/preferences", input),
    changePassword: (oldPassword: string, newPassword: string) => api.post<{ ok: boolean }>("/me/password", { old_password: oldPassword, new_password: newPassword }),
    bindPhoneCode: (phone: string, captchaId: string, captchaCode: string) => api.post<SendCodeResult>("/me/phone/bind/code", { phone: phone.trim(), captcha_id: captchaId, captcha_code: captchaCode.trim() }),
    bindPhone: (phone: string, smsCode: string) => api.post<{ phone: string; phone_verified: boolean }>("/me/phone/bind", { phone: phone.trim(), sms_code: smsCode.trim() }),
    sessions: async () => (await api.get<{ items: SessionDTO[] }>("/auth/sessions")).items,
    revokeSession: (id: string) => api.delete<{ ok: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`),
};
