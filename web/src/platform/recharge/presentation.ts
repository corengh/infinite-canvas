export const PAYMENT_PENDING_TIMEOUT_MESSAGE = "若已支付请稍候，系统会自动确认";

export function formatFenAsYuan(amountFen: number): string {
    if (!Number.isSafeInteger(amountFen)) throw new RangeError("金额必须是安全整数分");
    // 先拆整数分再拼十进制字符串，避免二进制浮点除法污染金额展示。
    const sign = amountFen < 0 ? "-" : "";
    const absolute = Math.abs(amountFen);
    const yuan = Math.floor(absolute / 100).toLocaleString("zh-CN");
    return `${sign}${yuan}.${String(absolute % 100).padStart(2, "0")}`;
}

export function formatCredits(value: number): string {
    return value.toLocaleString("zh-CN");
}

export function formatCreditsPerYuan(credits: number, amountFen: number): string {
    if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(amountFen) || amountFen <= 0) return "—";
    // 用整数完成两位小数四舍五入，折算比例也不依赖浮点运算。
    const scaled = (BigInt(credits) * BigInt(10_000) + BigInt(amountFen) / BigInt(2)) / BigInt(amountFen);
    const integer = scaled / BigInt(100);
    const fraction = String(scaled % BigInt(100))
        .padStart(2, "0")
        .replace(/0+$/, "");
    return `${integer.toLocaleString("zh-CN")}${fraction ? `.${fraction}` : ""} 积分/元`;
}

export function formatCountdown(milliseconds: number): string {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutesPart = Math.floor(seconds / 60);
    const secondsPart = seconds % 60;
    return `${String(minutesPart).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}
