// [PLATFORM] 接缝 #4：基座用户空壳整体替换为平台认证状态的再导出。
export { authStore, useAuthStore as useUserStore } from "@/platform/auth/store";
export type { AuthState as UserStore, TeamDTO, UserDTO } from "@/platform/auth/store";
