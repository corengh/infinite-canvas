import type { ReactNode } from "react";
import { useEffect } from "react";

import { authStore } from "@/platform/auth/store";
import { useAssetStore } from "@/stores/use-asset-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    useEffect(() => {
        const search = new URLSearchParams(window.location.search);
        const forbidden = ["base" + "Url", "baseurl", "api" + "Key", "apikey"];
        if (!forbidden.some((key) => search.has(key))) return;
        // 历史分享链接可能携带浏览器直连参数；平台模式只清除，不读取也不保存。
        forbidden.forEach((key) => search.delete(key));
        window.history.replaceState(null, "", `${window.location.pathname}${search.size ? `?${search}` : ""}${window.location.hash}`);
    }, []);
    useEffect(() => {
        const unsubscribe = authStore.subscribe((state, previous) => {
            if (state.sessionEpoch !== previous.sessionEpoch) useAssetStore.setState({ assets: [], nextCursor: null });
        });
        // 每分钟检查当前屏幕中的签名地址；真正续签仍合并为一次批量请求。
        const timer = window.setInterval(
            () =>
                void useAssetStore
                    .getState()
                    .refreshExpiringUrls()
                    .catch(() => undefined),
            60_000,
        );
        return () => {
            unsubscribe();
            window.clearInterval(timer);
        };
    }, []);
    return <>{children}</>;
}
