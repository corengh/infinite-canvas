import { useTranslation } from "react-i18next";

import { PlatformFooter } from "@/components/layout/platform-footer";
import { runtime } from "@/platform/runtime";

export default function AboutPage() {
    const { t } = useTranslation();
    return (
        <main className="h-full overflow-y-auto bg-background px-6 py-12">
            <div className="mx-auto flex min-h-full max-w-3xl flex-col">
                <h1 className="text-3xl font-semibold">{runtime.appName}</h1>
                <p className="mt-4 leading-7 text-stone-500">{t("meta.description")}</p>
                <div className="mt-auto pt-16">
                    <PlatformFooter />
                </div>
            </div>
        </main>
    );
}
