import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Button, Result, Spin } from "antd";

import { authApi } from "./api";
import { authStore, useAuthStore, type AuthStatus } from "./store";

export function authGuardDecision(status: AuthStatus): "spinner" | "login" | "content" {
    if (status === "unknown") return "spinner";
    return status === "anonymous" ? "login" : "content";
}

export function AuthGuard({ children }: { children: ReactNode }) {
    const status = useAuthStore((state) => state.status);
    const rehydrateError = useAuthStore((state) => state.rehydrateError);
    const location = useLocation();
    const decision = authGuardDecision(status);
    if (decision === "spinner") {
        if (rehydrateError) {
            return (
                <div className="flex h-dvh w-full items-center justify-center">
                    <Result
                        status="warning"
                        title="暂时无法恢复登录状态"
                        subTitle={rehydrateError}
                        extra={
                            <Button type="primary" onClick={() => void authStore.getState().rehydrate(() => authApi.me())}>
                                重新连接
                            </Button>
                        }
                    />
                </div>
            );
        }
        return (
            <div className="flex h-dvh w-full items-center justify-center" aria-label="正在恢复登录状态">
                <Spin size="large" />
            </div>
        );
    }
    if (decision === "login") return <Navigate to="/login" state={{ from: location }} replace />;
    return children;
}
