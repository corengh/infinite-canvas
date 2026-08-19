import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { teamApi } from "@/platform/api/team";
import { walletApi } from "@/platform/api/wallet";
import { authResultFixture } from "@/platform/http/test/fixtures";
import { server } from "@/platform/http/test/server";
import { authStore, type AuthResult } from "@/platform/auth/store";
import { ApiError } from "@/platform/http/errors";
import { balanceValues, maskedPhone, ONE_TIME_SECRET_NOTICE, reclaimErrorMessage, teamActionVisibility, transferErrorMessage } from "./presentation";
import { teamKeys, walletKeys } from "./query-keys";

const ownerResult: AuthResult = {
    ...authResultFixture,
    user: {
        ...authResultFixture.user,
        account_type: "owner",
        role: "owner",
        capabilities: ["member.create_user", "member.reset_password", "credit.transfer", "credit.reclaim"],
    },
};

describe("FE-3 钱包与团队契约", () => {
    beforeEach(() => authStore.getState().authenticate(ownerResult));

    it("三值与冻结任务数全部使用后端值，不重新计算 available", async () => {
        server.use(http.get("http://localhost/api/wallet", () => HttpResponse.json({ data: { balance: 10_000, held: 2_000, available: 7_999, active_hold_count: 3 } })));
        const result = await walletApi.balance();
        expect(balanceValues(result)).toEqual({ balance: 10_000, held: 2_000, available: 7_999 });
        expect(result.active_hold_count).toBe(3);
    });

    it("钱包与团队查询键包含当前身份，不会跨账号命中同一缓存", () => {
        expect(walletKeys.balance("user-a")).not.toEqual(walletKeys.balance("user-b"));
        expect(teamKeys.members("team-a")).not.toEqual(teamKeys.members("team-b"));
    });

    it("流水筛选与游标逐页原样交给服务端", async () => {
        const searches: string[] = [];
        server.use(
            http.get("http://localhost/api/wallet/ledger", ({ request }) => {
                searches.push(new URL(request.url).search);
                return HttpResponse.json({ data: { items: [], next_cursor: searches.length === 1 ? "cursor-2" : null, has_more: searches.length === 1 } });
            }),
        );
        const first = await walletApi.ledger({ type: "transfer_out", limit: 20 });
        await walletApi.ledger({ type: "transfer_out", cursor: first.next_cursor!, limit: 20 });
        expect(searches).toEqual(["?type=transfer_out&limit=20", "?type=transfer_out&cursor=cursor-2&limit=20"]);
    });

    it("划拨和回收均发送独立的 Idempotency-Key", async () => {
        const keys: string[] = [];
        server.use(
            http.post("http://localhost/api/wallet/transfer", ({ request }) => {
                keys.push(request.headers.get("Idempotency-Key") ?? "");
                return HttpResponse.json({ data: { transfer_id: "t1", from_balance: 90, to_balance: 10 } });
            }),
            http.post("http://localhost/api/wallet/reclaim", ({ request }) => {
                keys.push(request.headers.get("Idempotency-Key") ?? "");
                return HttpResponse.json({ data: { transfer_id: "t2", from_balance: 5, to_balance: 95 } });
            }),
        );
        await walletApi.transfer({ to_user_id: "u1", amount: 10, note: "配额" });
        await walletApi.reclaim({ from_user_id: "u1", amount: 5, note: "闲置" });
        expect(keys.every(Boolean)).toBe(true);
        expect(new Set(keys).size).toBe(2);
    });

    it("回收超额文案只读取结构化 details 的三个契约数值", () => {
        const error = new ApiError("RECLAIM_EXCEEDS_AVAILABLE", 400, "服务端原始消息", { available: 8_000, held: 2_000, requested: 9_000 });
        expect(reclaimErrorMessage(error)).toBe("可回收 8,000，其中 2,000 为进行中任务占用");
    });

    it("余额不足使用结构化数值，手机号始终以脱敏值展示", () => {
        expect(transferErrorMessage(new ApiError("CREDIT_INSUFFICIENT", 402, "余额不足", { required: 500, available: 120 }))).toBe("可用 120 / 本次需 500");
        expect(maskedPhone("13800138000")).toBe("138****8000");
        expect(maskedPhone("138****8000")).toBe("138****8000");
    });

    it("owner、leader、member 三套能力只决定按钮显隐", () => {
        const owner = teamActionVisibility(new Set(["member.create_user", "member.reset_password", "credit.transfer", "credit.reclaim"]));
        const leader = teamActionVisibility(new Set(["member.create_user", "member.reset_password", "credit.transfer", "credit.reclaim"]));
        const member = teamActionVisibility(new Set(["credit.request"]));
        expect(owner).toEqual({ create: true, resetPassword: true, transfer: true, reclaim: true });
        expect(leader).toEqual(owner);
        expect(member).toEqual({ create: false, resetPassword: false, transfer: false, reclaim: false });
    });

    it.each([7, 15, 30] as const)("闲置排行支持 %i 天阈值", async (days) => {
        server.use(
            http.get("http://localhost/api/team/idle-ranking", ({ request }) => {
                expect(new URL(request.url).searchParams.get("days")).toBe(String(days));
                return HttpResponse.json({ data: { items: [] } });
            }),
        );
        await expect(teamApi.idleRanking(days)).resolves.toEqual({ items: [] });
    });

    it("创建成功返回完整账号，页面明确一次性明文与交付提醒", async () => {
        server.use(
            http.post("http://localhost/api/team/members", () =>
                HttpResponse.json({ data: { id: "u1", username: "zhangsan", login_id: "zhangsan@test-team", display_name: "张三", phone: null, phone_verified: false, role: "member", group: null, status: "active", created_at: "2026-08-19T00:00:00Z" } }),
            ),
        );
        const created = await teamApi.createMember({ username: "zhangsan", password: "Password1", display_name: "张三", role: "member" });
        expect(created.login_id).toBe("zhangsan@test-team");
        expect(ONE_TIME_SECRET_NOTICE).toContain("关闭后不再可查");
        expect(ONE_TIME_SECRET_NOTICE).toContain("首次登录后修改密码");
    });

    it("团队设置只发送 name，slug 只读且不进入请求体", async () => {
        server.use(
            http.patch("http://localhost/api/team/settings", async ({ request }) => {
                expect(await request.json()).toEqual({ name: "新团队名" });
                return HttpResponse.json({ data: { id: "team-1", name: "新团队名", slug: "locked-slug" } });
            }),
        );
        await expect(teamApi.updateSettings({ name: "新团队名", slug: "hacked" } as { name: string })).resolves.toMatchObject({ slug: "locked-slug" });
    });
});
