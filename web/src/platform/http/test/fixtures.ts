// 夹具逐字段对齐 design/06-api-contract.md，避免测试自行发明响应形状。
export const authResultFixture = {
    access_token: "fresh-access-token",
    expires_in: 900,
    user: {
        id: "0198f2a1-0000-7000-8000-000000000001",
        account_type: "owner",
        login_id: "13800138000",
        username: null,
        phone: "138****8000",
        phone_verified: true,
        email: null,
        display_name: "测试用户",
        avatar_url: null,
        role: "owner",
        team: { id: "0198f2a1-0000-7000-8000-000000000002", name: "测试团队", slug: "test-team" },
        group: null,
        capabilities: [],
    },
};

export const unauthorizedFixture = {
    error: {
        code: "UNAUTHORIZED",
        message: "登录已过期",
        details: {},
        request_id: "0198f2a1-0000-7000-8000-000000000003",
    },
};

export const completedTaskFixture = {
    id: "0198f2a1-0000-7000-8000-000000000004",
    status: "succeeded",
    progress: 1,
    stage: "completed",
    error_kind: null,
    outputs: [{ asset_id: "0198f2a1-0000-7000-8000-000000000005", url: "https://assets.example/result.png", width: 1024, height: 1024 }],
};
