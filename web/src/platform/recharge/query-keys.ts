export const rechargeKeys = {
    root: (userId: string) => ["recharge", userId] as const,
    tiers: (userId: string) => ["recharge", userId, "tiers"] as const,
    orders: (userId: string) => ["recharge", userId, "orders"] as const,
};
