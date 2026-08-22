import { Button } from "antd";
import { LockKeyhole } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { lockManager, useCanvasLockState } from "@/platform/canvas/lock";
import { useThemeStore } from "@/stores/use-theme-store";

export function ReadonlyBanner() {
    const state = useCanvasLockState();
    const theme = canvasThemes[useThemeStore((store) => store.theme)];
    if (state.mode !== "readonly" || !state.canvasId) return null;
    const holder = state.holder?.display_name || "其他用户";
    const waiting = Boolean(state.pending && state.wait_seconds);
    return (
        <>
            <div className="pointer-events-none absolute inset-0 z-30 border-2 opacity-25" style={{ borderColor: theme.node.activeStroke }} aria-hidden />
            <div
                className="pointer-events-auto absolute left-1/2 top-14 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-sm backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.node.activeStroke, color: theme.node.text }}
            >
                <LockKeyhole className="size-3.5" />
                <span>{holder}正在编辑，你处于只读模式</span>
                <Button type="text" size="small" disabled={waiting} onClick={() => void lockManager.requestTakeover()}>
                    {waiting ? `已通知对方，${state.wait_seconds} 秒后可强制接管` : state.pending ? "强制接管" : "申请接管"}
                </Button>
            </div>
        </>
    );
}
