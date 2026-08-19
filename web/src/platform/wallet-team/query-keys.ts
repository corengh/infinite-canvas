import type { QueryClient } from "@tanstack/react-query";

export const walletKeys = {
    root: (userId: string) => ["wallet", userId] as const,
    balance: (userId: string) => ["wallet", userId, "balance"] as const,
    ledger: (userId: string, type: string) => ["wallet", userId, "ledger", type] as const,
    requests: (userId: string) => ["wallet", userId, "requests"] as const,
};

export const teamKeys = {
    root: (teamId: string) => ["team", teamId] as const,
    members: (teamId: string) => ["team", teamId, "members"] as const,
    memberOptions: (teamId: string) => ["team", teamId, "member-options"] as const,
    groups: (teamId: string) => ["team", teamId, "groups"] as const,
    idleRoot: (teamId: string) => ["team", teamId, "idle-ranking"] as const,
    idle: (teamId: string, days: number) => ["team", teamId, "idle-ranking", days] as const,
    consumption: (teamId: string) => ["team", teamId, "consumption"] as const,
};

export async function invalidateCreditState(
    client: QueryClient,
    identity: { userId: string; teamId: string },
): Promise<void> {
    // 账务移动会同时改变当前钱包、成员钱包、流水和闲置排行。
    await Promise.all([
        client.invalidateQueries({ queryKey: walletKeys.root(identity.userId) }),
        client.invalidateQueries({ queryKey: teamKeys.members(identity.teamId) }),
        client.invalidateQueries({ queryKey: teamKeys.memberOptions(identity.teamId) }),
        client.invalidateQueries({ queryKey: teamKeys.idleRoot(identity.teamId) }),
    ]);
}

export async function invalidateGroupState(client: QueryClient, teamId: string): Promise<void> {
    // 任命或撤销组长会同步改变成员的角色和分组，两个视图必须一起刷新。
    await Promise.all([
        client.invalidateQueries({ queryKey: teamKeys.groups(teamId) }),
        client.invalidateQueries({ queryKey: teamKeys.members(teamId) }),
        client.invalidateQueries({ queryKey: teamKeys.memberOptions(teamId) }),
    ]);
}
