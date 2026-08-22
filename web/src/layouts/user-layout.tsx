import type { ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { ReloginOverlay } from "@/platform/auth/relogin-overlay";
import { GenerationConfirmHost } from "@/platform/generation";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav /> {/* [PLATFORM] 接缝 #3：顶栏包含积分徽标与用户菜单。 */}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <ReloginOverlay />
            <GenerationConfirmHost />
        </div>
    );
}
