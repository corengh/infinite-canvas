import { ArrowRight, Bot, Clapperboard, Image as ImageIcon, Sparkles, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Card, Empty, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PlatformFooter } from "@/components/layout/platform-footer";
import { appsApi, type PlatformAppDTO } from "@/platform/api/apps";

const icons = { clapperboard: Clapperboard, video: Video, image: ImageIcon, bot: Bot } as const;

export default function HomePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [items, setItems] = useState<PlatformAppDTO[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void appsApi
            .list()
            .then((result) => setItems(result.items))
            .catch((error) => message.error(error instanceof Error ? error.message : t("fe9.home.loadFailed")))
            .finally(() => setLoading(false));
    }, [message, t]);

    return (
        <main className="h-full overflow-y-auto bg-background">
            <section className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-7xl flex-col px-6 pt-16">
                <div className="mx-auto max-w-3xl text-center">
                    <div className="mb-4 inline-flex items-center gap-2 text-sm text-stone-500">
                        <Sparkles className="size-4" />
                        {t("fe9.home.eyebrow")}
                    </div>
                    <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">{t("fe9.home.title")}</h1>
                    <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-7 text-stone-500">{t("fe9.home.description")}</p>
                </div>
                {loading ? (
                    <div className="grid h-72 place-items-center">
                        <Spin />
                    </div>
                ) : null}
                {!loading && !items.length ? <Empty className="py-24" description={t("fe9.home.empty")} /> : null}
                <div className="mx-auto mt-12 grid w-full max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((item) => {
                        const Icon = icons[item.icon as keyof typeof icons] || Sparkles;
                        return (
                            <Card key={item.code} hoverable className="group h-full" styles={{ body: { display: "flex", minHeight: 230, flexDirection: "column", padding: 24 } }}>
                                <div className="grid size-11 place-items-center rounded-xl bg-stone-100 dark:bg-stone-800">
                                    <Icon className="size-5" />
                                </div>
                                <h2 className="mt-5 text-lg font-semibold">{item.name}</h2>
                                <p className="mt-2 flex-1 text-sm leading-6 text-stone-500">{item.description}</p>
                                <Button type="link" className="mt-5 w-fit px-0" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => navigate(item.entry_path)}>
                                    {t("fe9.home.enter")}
                                </Button>
                            </Card>
                        );
                    })}
                </div>
                <div className="mt-auto pt-16">
                    <PlatformFooter />
                </div>
            </section>
        </main>
    );
}
