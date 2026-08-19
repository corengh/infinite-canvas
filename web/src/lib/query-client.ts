import { QueryClient } from "@tanstack/react-query";

// 全站只保留一个查询客户端；退出登录时由认证模块统一清除用户态缓存。
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function clearSessionQueries(): void {
    // 钱包、成员等缓存都包含账号敏感信息；切换会话时宁可重新拉取，也不能跨账号复用。
    queryClient.clear();
}
