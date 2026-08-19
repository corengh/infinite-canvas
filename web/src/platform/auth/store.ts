import { createStore } from "zustand/vanilla";

const AUTH_SESSION_KEY = "aigc-studio:auth-session";

type StoredAuthSession = {
    accessToken: string;
    expiresAt: number;
};

export type AuthTokenState = {
    accessToken: string | null;
    expiresAt: number | null;
    sessionEpoch: number;
    expiredSessionEpoch: number | null;
    startSession: (accessToken: string, expiresIn: number) => void;
    setTokens: (accessToken: string, expiresIn: number) => void;
    updateAccessToken: (accessToken: string, expiresIn: number) => void;
    expireSession: (expectedEpoch: number) => void;
    clear: () => void;
    rehydrate: () => void;
};

function getSessionStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        // 浏览器禁用存储时仍允许使用内存会话，不能阻断应用启动。
        return null;
    }
}

function persistSession(session: StoredAuthSession | null): void {
    const storage = getSessionStorage();
    if (!storage) return;
    try {
        if (session) storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
        else storage.removeItem(AUTH_SESSION_KEY);
    } catch {
        // 隐私模式或存储配额异常只影响刷新后的恢复，当前内存会话仍须保持可用。
    }
}

// FE-1 先提供刷新队列所需的最小 token 状态；用户、团队和权限字段由 FE-2 扩展。
export const authStore = createStore<AuthTokenState>()((set) => {
    const startSession = (accessToken: string, expiresIn: number) => {
        const expiresAt = Date.now() + Math.max(0, expiresIn) * 1000;
        set((state) => ({ accessToken, expiresAt, sessionEpoch: state.sessionEpoch + 1, expiredSessionEpoch: null }));
        persistSession({ accessToken, expiresAt });
    };

    return {
        accessToken: null,
        expiresAt: null,
        sessionEpoch: 0,
        expiredSessionEpoch: null,
        startSession,
        // 保留 FE-1 原有名称供 FE-2 衔接；登录写入会创建新的认证 epoch。
        setTokens: startSession,
        updateAccessToken: (accessToken, expiresIn) => {
            const expiresAt = Date.now() + Math.max(0, expiresIn) * 1000;
            set({ accessToken, expiresAt });
            persistSession({ accessToken, expiresAt });
        },
        expireSession: (expectedEpoch) => {
            let expired = false;
            set((state) => {
                if (state.sessionEpoch !== expectedEpoch) return state;
                expired = true;
                return { accessToken: null, expiresAt: null, sessionEpoch: state.sessionEpoch + 1, expiredSessionEpoch: expectedEpoch };
            });
            if (expired) persistSession(null);
        },
        clear: () => {
            set((state) => ({ accessToken: null, expiresAt: null, sessionEpoch: state.sessionEpoch + 1, expiredSessionEpoch: null }));
            persistSession(null);
        },
        rehydrate: () => {
            const storage = getSessionStorage();
            if (!storage) return;
            try {
                const stored = JSON.parse(storage.getItem(AUTH_SESSION_KEY) ?? "null") as Partial<StoredAuthSession> | null;
                if (!stored || typeof stored.accessToken !== "string" || typeof stored.expiresAt !== "number") return;
                set((state) => ({ accessToken: stored.accessToken, expiresAt: stored.expiresAt, sessionEpoch: state.sessionEpoch + 1, expiredSessionEpoch: null }));
            } catch {
                // 损坏或不可读的缓存不能阻断启动；删除失败时继续使用空的内存会话。
                persistSession(null);
            }
        },
    };
});

export function resetAuthStoreForTests(): void {
    authStore.getState().clear();
}
