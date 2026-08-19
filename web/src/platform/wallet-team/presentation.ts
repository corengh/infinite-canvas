import { ApiError } from "@/platform/http/errors";

export const ONE_TIME_SECRET_NOTICE = "明文只展示这一次，关闭后不再可查。请交给该成员并提醒首次登录后修改密码。";

export function balanceValues(balance: { balance: number; held: number; available: number }) {
    // available 是服务端生成列，展示模型绝不重新执行 balance - held。
    return { available: balance.available, balance: balance.balance, held: balance.held };
}

export function reclaimErrorMessage(error: ApiError): string {
    if (error.code !== "RECLAIM_EXCEEDS_AVAILABLE") return error.message;
    const available = typeof error.details?.available === "number" ? error.details.available : 0;
    const held = typeof error.details?.held === "number" ? error.details.held : 0;
    return `可回收 ${available.toLocaleString("zh-CN")}，其中 ${held.toLocaleString("zh-CN")} 为进行中任务占用`;
}

export function transferErrorMessage(error: ApiError): string {
    if (error.code !== "CREDIT_INSUFFICIENT") return error.message;
    const required = typeof error.details?.required === "number" ? error.details.required : 0;
    const available = typeof error.details?.available === "number" ? error.details.available : 0;
    return `可用 ${available.toLocaleString("zh-CN")} / 本次需 ${required.toLocaleString("zh-CN")}`;
}

export function maskedPhone(phone: string | null): string | null {
    if (!phone || phone.includes("*")) return phone;
    return /^(\d{3})\d+(\d{4})$/.test(phone) ? phone.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2") : phone;
}

export function teamSettingsBody(name: string): { name: string } {
    // 团队标识不属于用户侧写契约，构造请求时从类型和值两层都排除 slug。
    return { name: name.trim() };
}

export function teamActionVisibility(capabilities: Set<string>) {
    return {
        create: capabilities.has("member.create_user"),
        resetPassword: capabilities.has("member.reset_password"),
        transfer: capabilities.has("credit.transfer"),
        reclaim: capabilities.has("credit.reclaim"),
    };
}
