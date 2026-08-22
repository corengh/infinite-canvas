import { useTranslation } from "react-i18next";

import { PlatformPreferencesPanel } from "@/platform/config/preferences-panel";

export default function ConfigPage() {
    const { t } = useTranslation();
    return (
        <main className="h-full overflow-y-auto bg-background px-5 py-7">
            <div className="mx-auto max-w-7xl">
                <h1 className="text-2xl font-semibold">{t("fe9.config.title")}</h1>
                <p className="mb-6 mt-1 text-sm text-stone-500">{t("fe9.config.description")}</p>
                <PlatformPreferencesPanel />
            </div>
        </main>
    );
}
