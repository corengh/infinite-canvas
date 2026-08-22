import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Empty, Input, Modal, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { promptsApi, type PromptDTO } from "@/platform/api/prompts";

/** 生成面板共用服务端提示词库，选择后一次点击写回当前输入框。 */
export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [items, setItems] = useState<PromptDTO[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => {
            setLoading(true);
            void promptsApi
                .list({ search: keyword.trim() || undefined, limit: 100 })
                .then((page) => setItems(page.items))
                .catch((error) => message.error(error instanceof Error ? error.message : t("fe9.prompts.loadFailed")))
                .finally(() => setLoading(false));
        }, 250);
        return () => window.clearTimeout(timer);
    }, [keyword, message, open, t]);

    return (
        <Modal title={t("fe9.prompts.title")} open={open} onCancel={() => onOpenChange(false)} footer={null} width={760} centered>
            <Input prefix={<Search className="size-4 text-stone-400" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("fe9.prompts.search")} />
            <div className="thin-scrollbar mt-4 max-h-[58dvh] space-y-3 overflow-y-auto pr-1">
                {loading ? (
                    <div className="grid h-32 place-items-center">
                        <Spin />
                    </div>
                ) : null}
                {!loading && !items.length ? <Empty description={t("fe9.prompts.empty")} /> : null}
                {items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h3 className="font-medium">{item.title}</h3>
                                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-stone-500">{item.content}</p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {item.tags.map((tag) => (
                                        <Tag key={tag}>{tag}</Tag>
                                    ))}
                                </div>
                            </div>
                            <Button
                                type="primary"
                                size="small"
                                onClick={() => {
                                    onSelect(item.content);
                                    onOpenChange(false);
                                }}
                            >
                                {t("fe9.prompts.use")}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
}
