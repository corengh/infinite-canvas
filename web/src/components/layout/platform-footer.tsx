import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { runtime } from "@/platform/runtime";

export function PlatformFooter() {
    const { t } = useTranslation();
    return (
        <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500 dark:border-stone-800">
            <a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noopener noreferrer" className="hover:text-stone-900 dark:hover:text-stone-100">
                {t("fe9.home.attribution")}
            </a>
            <span className="mx-2">·</span>
            <Link to="/about" className="hover:text-stone-900 dark:hover:text-stone-100">
                {t("navigation.about", { defaultValue: "关于" })}
            </Link>
            {runtime.icpNumber ? (
                <>
                    <span className="mx-2">·</span>
                    <span>{runtime.icpNumber}</span>
                </>
            ) : null}
        </footer>
    );
}
