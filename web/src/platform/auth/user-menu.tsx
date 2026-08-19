import { App, Avatar, Button, Dropdown, type MenuProps } from "antd";
import { LogOut, MonitorSmartphone, Users, UserRound, WalletCards } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { authApi } from "./api";
import { authStore, useAuthStore } from "./store";
import { CreditBadge } from "@/platform/components/credit-badge";

export async function logoutCurrentSession(): Promise<void> {
    // 只有服务端确认注销并清除 HttpOnly Cookie 后，才允许删除前端登录态。
    try {
        await authApi.logout();
    } catch (cause) {
        const status = typeof cause === "object" && cause !== null && "status" in cause ? (cause as { status?: unknown }).status : undefined;
        // 401 表示服务端已经不再承认该会话，本地可直接完成退出；网络与 5xx 则必须保留状态。
        if (status !== 401) throw cause;
    }
    authStore.getState().clear();
}

export function AuthUserActions() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    if (!user) return null;

    const logout = async () => {
        try {
            await logoutCurrentSession();
        } catch {
            // HttpOnly Cookie 只能由服务端清除；失败时保留登录态，避免伪装成已安全退出。
            message.error("退出失败，请检查网络后重试");
            return;
        }
        navigate("/login", { replace: true });
    };
    const items: MenuProps["items"] = [
        {
            key: "identity",
            label: (
                <div>
                    <div className="font-medium">{user.display_name || user.login_id}</div>
                    <div className="text-xs text-stone-500">{user.login_id}</div>
                </div>
            ),
            disabled: true,
        },
        { type: "divider" },
        { key: "wallet", icon: <WalletCards className="size-4" />, label: "钱包", onClick: () => navigate("/wallet") },
        ...(user.role !== "member" ? [{ key: "team", icon: <Users className="size-4" />, label: "团队管理", onClick: () => navigate("/team") }] : []),
        { key: "account", icon: <UserRound className="size-4" />, label: "账号设置", onClick: () => navigate("/settings/account") },
        { key: "sessions", icon: <MonitorSmartphone className="size-4" />, label: "登录设备", onClick: () => navigate("/settings/sessions") },
        { key: "recovery", label: user.phone_verified ? "可通过手机号自助找回密码" : "忘记密码请联系管理员", disabled: true },
        { type: "divider" },
        { key: "logout", danger: true, icon: <LogOut className="size-4" />, label: "退出登录", onClick: () => void logout() },
    ];
    return (
        <div className="inline-flex items-center gap-2">
            <CreditBadge />
            <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]}>
                <Button type="text" shape="circle" aria-label="用户菜单">
                    <Avatar size={28} src={user.avatar_url}>
                        {(user.display_name || user.login_id).slice(0, 1).toUpperCase()}
                    </Avatar>
                </Button>
            </Dropdown>
        </div>
    );
}
