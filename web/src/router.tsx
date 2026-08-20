import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import LoginPage from "@/pages/auth/login";
import RegisterPage from "@/pages/auth/register";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ResetPasswordPage from "@/pages/auth/reset-password";
import AccountSettingsPage from "@/pages/settings/account";
import SessionsPage from "@/pages/settings/sessions";
import RechargePage from "@/pages/recharge";
import RechargeOrderPage from "@/pages/recharge/order";
import RechargeOrdersPage from "@/pages/recharge/orders";
import TeamPage from "@/pages/team";
import WalletPage from "@/pages/wallet";
import { AuthGuard } from "@/platform/auth/guard";

export const router = createBrowserRouter([
    {
        element: (
            <AuthGuard>
                {/* [PLATFORM] 接缝 #2：业务路由统一经过认证守卫。 */}
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            </AuthGuard>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/settings/account", element: <AccountSettingsPage /> },
            { path: "/settings/sessions", element: <SessionsPage /> },
            // [PLATFORM] FE-3 导航接缝：钱包与团队管理复用受保护业务布局。
            { path: "/wallet", element: <WalletPage /> },
            { path: "/recharge", element: <RechargePage /> },
            { path: "/recharge/orders", element: <RechargeOrdersPage /> },
            { path: "/recharge/orders/:orderId", element: <RechargeOrderPage /> },
            { path: "/team", element: <TeamPage /> },
        ],
    },
    { path: "/login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "/forgot-password", element: <ForgotPasswordPage /> },
    { path: "/reset-password", element: <ResetPasswordPage /> },
    { path: "*", element: <NotFound /> },
]);
