// FE-1 仅提供 HTTP 刷新所需的最小状态；完整用户态、守卫与重登浮层由 FE-2 补齐。
export { authEvents } from "./events";
export { authStore } from "./store";
export type { AuthEvent } from "./events";
export type { AuthTokenState } from "./store";
