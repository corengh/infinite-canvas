import { afterAll, afterEach, beforeAll } from "vitest";

import { authStore } from "@/platform/auth/store";
import { resetRefreshQueueForTests } from "@/platform/http/refresh-queue";

import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
    server.resetHandlers();
    resetRefreshQueueForTests();
    authStore.setState({
        user: null,
        team: null,
        role: null,
        capabilities: new Set(),
        accessToken: null,
        expiresAt: null,
        status: "unknown",
        rehydrateError: null,
        loginId: null,
        sessionEpoch: 0,
        expiredSessionEpoch: null,
    });
});
afterAll(() => server.close());
