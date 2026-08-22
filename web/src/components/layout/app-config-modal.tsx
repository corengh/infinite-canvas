import { Modal } from "antd";
import { useTranslation } from "react-i18next";

import { PlatformPreferencesPanel } from "@/platform/config/preferences-panel";
import { useConfigStore } from "@/stores/use-config-store";

/** 顶栏快捷设置与 /config 共用安全面板，避免旧渠道编辑器从其他入口重新暴露。 */
export function AppConfigModal() {
    const { t } = useTranslation();
    const open = useConfigStore((state) => state.isConfigOpen);
    const setOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal title={t("fe9.config.title")} open={open} footer={null} width={1040} centered destroyOnHidden onCancel={() => setOpen(false)} styles={{ body: { maxHeight: "76dvh", overflowY: "auto" } }}>
            <p className="mb-5 text-sm text-stone-500">{t("fe9.config.description")}</p>
            <PlatformPreferencesPanel />
        </Modal>
    );
}
