import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

const AUTH_SESSION_KEY = "aigc-studio:auth-session";

export type AuthStatus = "unknown" | "authed" | "anonymous";
export type UserRole = "owner" | "leader" | "member";

export type TeamDTO = { id: string; name: string; slug: string };

export type UserDTO = {
    id: string;
    account_type: "owner" | "sub";
    login_id: string;
    username: string | null;
    phone: string | null;
    phone_verified: boolean;
    email: string | null;
    display_name: string;
    avatar_url: string | null;
    role: UserRole;
    team: TeamDTO;
    group: { id: string; name?: string } | null;
    capabilities: string[];
    wallet?: { balance: number; held: number; available: number };
    preferences?: Record<string, unknown>;
};

export type AuthResult = { access_token: string; expires_in: number; user: UserDTO };

type StoredAuthSession = { accessToken: string; expiresAt: number; loginId?: string };

export type AuthState = {
    user: UserDTO | null;
    team: TeamDTO | null;
    role: UserRole | null;
    capabilities: Set<string>;
    accessToken: string | null;
    expiresAt: number | null;
    status: AuthStatus;
    rehydrateError: string | null;
    loginId: string | null;
    sessionEpoch: number;
    expiredSessionEpoch: number | null;
    authenticate: (result: AuthResult, loginId?: string) => void;
    startSession: (accessToken: string, expiresIn: number) => void;
    setTokens: (accessToken: string, expiresIn: number) => void;
    updateAccessToken: (accessToken: string, expiresIn: number) => void;
    setUser: (user: UserDTO) => void;
    expireSession: (expectedEpoch: number) => void;
    clear: () => void;
    rehydrate: (loadUser?: () => Promise<UserDTO>) => Promise<void>;
};

function getSessionStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
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
        // 浏览器禁用存储时仍保留内存会话，不能阻断当前页面使用。
    }
}

function readStoredSession(): StoredAuthSession | null {
    const storage = getSessionStorage();
    if (!storage) return null;
    try {
        const value = JSON.parse(storage.getItem(AUTH_SESSION_KEY) ?? "null") as Partial<StoredAuthSession> | null;
        if (!value || typeof value.accessToken !== "string" || typeof value.expiresAt !== "number") return null;
        return { accessToken: value.accessToken, expiresAt: value.expiresAt, loginId: typeof value.loginId === "string" ? value.loginId : undefined };
    } catch {
        persistSession(null);
        return null;
    }
}

function userState(user: UserDTO) {
    return { user, team: user.team, role: user.role, capabilities: new Set(user.capabilities) };
}

export const authStore = createStore<AuthState>()((set, get) => {
    const writeTokens = (accessToken: string, expiresIn: number, newEpoch: boolean) => {
        const expiresAt = Date.now() + Math.max(0, expiresIn) * 1000;
        set((state) => ({ accessToken, expiresAt, sessionEpoch: newEpoch ? state.sessionEpoch + 1 : state.sessionEpoch, expiredSessionEpoch: null }));
        persistSession({ accessToken, expiresAt, loginId: get().loginId ?? undefined });
    };

    return {
        user: null,
        team: null,
        role: null,
        capabilities: new Set<string>(),
        accessToken: null,
        expiresAt: null,
        status: "unknown",
        rehydrateError: null,
        loginId: null,
        sessionEpoch: 0,
        expiredSessionEpoch: null,
        authenticate: (result, loginId) => {
            const normalizedLoginId = loginId?.trim().toLowerCase() ?? get().loginId ?? result.user.login_id;
            const expiresAt = Date.now() + Math.max(0, result.expires_in) * 1000;
            set((state) => ({
                ...userState(result.user),
                accessToken: result.access_token,
                expiresAt,
                status: "authed",
                rehydrateError: null,
                loginId: normalizedLoginId,
                sessionEpoch: state.sessionEpoch + 1,
                expiredSessionEpoch: null,
            }));
            persistSession({ accessToken: result.access_token, expiresAt, loginId: normalizedLoginId });
        },
        startSession: (accessToken, expiresIn) => writeTokens(accessToken, expiresIn, true),
        setTokens: (accessToken, expiresIn) => writeTokens(accessToken, expiresIn, true),
        updateAccessToken: (accessToken, expiresIn) => writeTokens(accessToken, expiresIn, false),
        setUser: (user) => set({ ...userState(user), status: "authed", rehydrateError: null }),
        expireSession: (expectedEpoch) => {
            let expired = false;
            set((state) => {
                if (state.sessionEpoch !== expectedEpoch) return state;
                expired = true;
                // 保留用户态与受保护页面，让重登浮层覆盖原 DOM。
                return { accessToken: null, expiresAt: null, sessionEpoch: state.sessionEpoch + 1, expiredSessionEpoch: expectedEpoch };
            });
            if (expired) persistSession(null);
        },
        clear: () => {
            set((state) => ({
                user: null,
                team: null,
                role: null,
                capabilities: new Set<string>(),
                accessToken: null,
                expiresAt: null,
                status: "anonymous",
                rehydrateError: null,
                loginId: null,
                sessionEpoch: state.sessionEpoch + 1,
                expiredSessionEpoch: null,
            }));
            persistSession(null);
        },
        rehydrate: async (loadUser) => {
            set({ status: "unknown", rehydrateError: null });
            const stored = readStoredSession();
            if (stored) {
                set((state) => ({ accessToken: stored.accessToken, expiresAt: stored.expiresAt, loginId: stored.loginId ?? null, sessionEpoch: state.sessionEpoch + 1, status: "unknown" }));
            }
            if (!loadUser) return;
            try {
                // 网络函数由启动层注入，store 不反向依赖 HTTP 模块。
                get().setUser(await loadUser());
            } catch (cause) {
                const status = typeof cause === "object" && cause !== null && "status" in cause ? (cause as { status?: unknown }).status : undefined;
                if (status === 401) {
                    get().clear();
                    return;
                }
                // 断网、超时与服务端暂时故障不能伪装成“未登录”，也不能删除仍有效的凭据。
                set({ status: "unknown", rehydrateError: cause instanceof Error ? cause.message : "暂时无法连接服务器" });
            }
        },
    };
});

export function useAuthStore<T>(selector: (state: AuthState) => T): T {
    return useStore(authStore, selector);
}

export function resetAuthStoreForTests(): void {
    authStore.getState().clear();
    authStore.setState({ status: "unknown", rehydrateError: null, sessionEpoch: 0, expiredSessionEpoch: null });
}
