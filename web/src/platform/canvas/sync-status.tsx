import { Button } from "antd";
import { saveAs } from "file-saver";
import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";

import { canvasSync } from "./sync-engine";

export function CanvasSyncStatus() {
    const navigate = useNavigate();
    const status = useSyncExternalStore(
        (listener) => canvasSync.subscribe(listener),
        () => canvasSync.getStatus(),
        () => canvasSync.getStatus(),
    );
    if (!status.pendingCount && !status.readonly && !status.paused) return null;
    const text = status.deleted
        ? `画布已被删除，${status.currentPendingCount} 处修改尚未保存`
        : status.readonly
          ? `画布已转为只读，${status.currentPendingCount} 处修改尚未保存`
          : status.paused
            ? `同步已暂停，${status.pendingCount} 处修改待同步`
            : status.otherCanvasPendingCount && status.currentPendingCount
              ? `当前画布有 ${status.currentPendingCount} 处待同步；另有 ${status.otherCanvasPendingCount} 处需重新打开对应画布同步`
              : status.otherCanvasPendingCount
                ? `另有 ${status.otherCanvasPendingCount} 处修改需重新打开对应画布同步`
                : `离线中，${status.currentPendingCount} 处修改待同步`;
    return (
        <div className="pointer-events-auto absolute left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <span>{text}</span>
            {status.otherCanvasIds[0] && !status.deleted ? (
                <Button type="text" size="small" onClick={() => navigate(`/canvas/${status.otherCanvasIds[0]}`)}>
                    打开待同步画布
                </Button>
            ) : null}
            {status.pendingCount ? (
                <Button type="text" size="small" onClick={() => void canvasSync.exportUnsaved().then((blob) => saveAs(blob, `canvas-unsaved-${Date.now()}.json`))}>
                    导出未保存的修改
                </Button>
            ) : null}
        </div>
    );
}
