const SESSION_KEY = "aigc-studio:canvas-session-id";

/** 生成符合 RFC 9562 布局的 UUIDv7；时间戳有序，剩余位使用密码学随机数。 */
export function uuid7(now = Date.now()): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let timestamp = now;
    for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = timestamp % 256;
        timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canvasSessionId(): string {
    if (typeof sessionStorage === "undefined") return uuid7();
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = uuid7();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
}
