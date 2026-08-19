import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Tooltip } from "antd";
import { Coins } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { walletApi } from "@/platform/api/wallet";
import { authStore, useAuthStore } from "@/platform/auth/store";
import { walletKeys } from "@/platform/wallet-team/query-keys";

type RefreshListener = () => void;
const listeners = new Set<RefreshListener>();

export const creditBadgeEvents = {
    refresh() {
        listeners.forEach((listener) => listener());
    },
};

export async function withCreditBadgeRefresh<T>(operation: () => Promise<T>): Promise<T> {
    // 生成提交前读取一次、任务进入终态后再读取一次；FE-6 的统一生成客户端直接复用此包装器。
    creditBadgeEvents.refresh();
    try {
        return await operation();
    } finally {
        creditBadgeEvents.refresh();
    }
}

export function CreditBadge() {
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const userId = user?.id ?? "anonymous";
    const fallback = user?.wallet?.available ?? 0;
    const balance = useQuery({
        queryKey: walletKeys.balance(userId),
        queryFn: walletApi.balance,
        enabled: Boolean(user),
    });

    useEffect(() => {
        const refresh = () => void balance.refetch();
        listeners.add(refresh);
        return () => {
            listeners.delete(refresh);
        };
    }, [balance.refetch]);

    useEffect(() => {
        if (!balance.data) return;
        const state = authStore.getState();
        // 请求返回时再次核对身份，避免切换会话途中的旧响应写进新账号。
        if (state.user?.id === userId) state.setUser({ ...state.user, wallet: balance.data });
    }, [balance.data, userId]);

    const available = balance.data?.available ?? fallback;
    return (
        <Tooltip title={`可用积分 ${available.toLocaleString("zh-CN")}`}>
            <Badge count={available} overflowCount={999999} showZero color="#57534e">
                <Button type="text" shape="circle" icon={<Coins className="size-4" />} aria-label={`可用积分 ${available}`} onClick={() => navigate("/wallet")} />
            </Badge>
        </Tooltip>
    );
}
