import { afterAll, afterEach, beforeAll } from "vitest";

import { authStore } from "@/platform/auth/store";
import { resetRefreshQueueForTests } from "@/platform/http/refresh-queue";

import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
    server.resetHandlers();
    resetRefreshQueueForTests();
    authStore.setState({ accessToken: null, expiresAt: null, sessionEpoch: 0, expiredSessionEpoch: null });
});
afterAll(() => server.close());
