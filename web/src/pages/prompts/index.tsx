import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Form, Input, Modal, Select, Spin, Switch, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { promptsApi, type PromptDTO, type PromptInput, type PromptVisibility } from "@/platform/api/prompts";
import { useAuthStore } from "@/platform/auth/store";

const emptyDraft: PromptInput = { title: "", content: "", tags: [], visibility: "private" };

export default function PromptsPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const userId = useAuthStore((state) => state.user?.id);
    const [items, setItems] = useState<PromptDTO[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [visibility, setVisibility] = useState<PromptVisibility | "all">("all");
    const [tag, setTag] = useState("all");
    const [editing, setEditing] = useState<PromptDTO | null | undefined>(undefined);
    const [form] = Form.useForm<PromptInput>();

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [search]);

    const load = useCallback(
        async (append = false) => {
            setLoading(true);
            try {
                const page = await promptsApi.list({ search: debouncedSearch || undefined, tag: tag === "all" ? undefined : tag, visibility: visibility === "all" ? undefined : visibility, cursor: append ? cursor || undefined : undefined, limit: 30 });
                setItems((current) => (append ? [...current, ...page.items] : page.items));
                setCursor(page.next_cursor);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("fe9.prompts.loadFailed"));
            } finally {
                setLoading(false);
            }
        },
        [cursor, debouncedSearch, message, t, tag, visibility],
    );

    useEffect(() => {
        void load(false);
        // cursor 是本次分页结果，不能作为筛选首屏重载的触发条件。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, tag, visibility]);

    const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags))).sort(), [items]);
    const openEditor = (prompt: PromptDTO | null) => {
        setEditing(prompt);
        form.setFieldsValue(prompt ? { title: prompt.title, content: prompt.content, tags: prompt.tags, visibility: prompt.visibility } : emptyDraft);
    };
    const save = async () => {
        const values = await form.validateFields();
        try {
            const saved = editing ? await promptsApi.update(editing.id, values) : await promptsApi.create(values);
            setItems((current) => (editing ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current]));
            setEditing(undefined);
            message.success(t("fe9.prompts.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("fe9.prompts.loadFailed"));
        }
    };
    const remove = (prompt: PromptDTO) => {
        modal.confirm({
            title: t("common.delete"),
            content: t("fe9.prompts.deleteConfirm", { name: prompt.title }),
            okButtonProps: { danger: true },
            onOk: async () => {
                await promptsApi.remove(prompt.id);
                setItems((current) => current.filter((item) => item.id !== prompt.id));
                message.success(t("fe9.prompts.deleted"));
            },
        });
    };
    const share = async (prompt: PromptDTO, checked: boolean) => {
        const saved = await promptsApi.update(prompt.id, { visibility: checked ? "team" : "private" });
        setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    };

    return (
        <main className="h-full overflow-y-auto bg-background px-5 py-7">
            <div className="mx-auto max-w-7xl">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold">{t("fe9.prompts.title")}</h1>
                        <p className="mt-1 text-sm text-stone-500">{t("fe9.prompts.description")}</p>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openEditor(null)}>
                        {t("fe9.prompts.create")}
                    </Button>
                </header>
                <div className="mt-6 flex flex-wrap gap-3">
                    <Input.Search className="max-w-md" allowClear value={search} placeholder={t("fe9.prompts.search")} onChange={(event) => setSearch(event.target.value)} />
                    <Select
                        value={visibility}
                        className="w-40"
                        options={[
                            { value: "all", label: t("fe9.assets.allVisibility") },
                            { value: "private", label: t("fe9.assets.private") },
                            { value: "team", label: t("fe9.assets.team") },
                        ]}
                        onChange={setVisibility}
                    />
                    <Select value={tag} className="w-40" options={[{ value: "all", label: t("common.all") }, ...tags.map((value) => ({ value, label: value }))]} onChange={setTag} />
                </div>

                {loading && !items.length ? (
                    <div className="grid h-64 place-items-center">
                        <Spin />
                    </div>
                ) : null}
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((prompt) => {
                        const owned = prompt.owner.id === userId;
                        return (
                            <Card key={prompt.id} className="h-full" styles={{ body: { display: "flex", height: "100%", flexDirection: "column" } }}>
                                <div className="flex items-start justify-between gap-3">
                                    <h2 className="font-medium">{prompt.title}</h2>
                                    <Tag>{t(prompt.visibility === "team" ? "fe9.assets.team" : "fe9.assets.private")}</Tag>
                                </div>
                                <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-stone-600 dark:text-stone-300">{prompt.content}</p>
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {prompt.tags.map((value) => (
                                        <Tag key={value}>{value}</Tag>
                                    ))}
                                </div>
                                <div className="mt-auto flex items-center gap-1 border-t border-stone-100 pt-4 dark:border-stone-800">
                                    <Button type="text" size="small" icon={<Copy className="size-4" />} onClick={() => copyText(prompt.content, t("common.promptCopied"))}>
                                        {t("common.copy")}
                                    </Button>
                                    {owned ? (
                                        <Button type="text" size="small" icon={<Pencil className="size-4" />} onClick={() => openEditor(prompt)}>
                                            {t("common.edit")}
                                        </Button>
                                    ) : null}
                                    {owned ? (
                                        <Button type="text" danger size="small" icon={<Trash2 className="size-4" />} onClick={() => remove(prompt)}>
                                            {t("common.delete")}
                                        </Button>
                                    ) : null}
                                    {owned ? <Switch className="ml-auto" size="small" checked={prompt.visibility === "team"} onChange={(checked) => void share(prompt, checked)} /> : null}
                                </div>
                            </Card>
                        );
                    })}
                </div>
                {!loading && !items.length ? <Empty className="py-20" description={t("fe9.prompts.empty")} /> : null}
                {cursor ? (
                    <div className="mt-8 text-center">
                        <Button loading={loading} onClick={() => void load(true)}>
                            {t("fe9.prompts.loadMore")}
                        </Button>
                    </div>
                ) : null}
            </div>

            <Modal title={editing ? t("fe9.prompts.edit") : t("fe9.prompts.create")} open={editing !== undefined} okText={t("common.save")} cancelText={t("common.cancel")} onOk={() => void save()} onCancel={() => setEditing(undefined)} destroyOnHidden>
                <Form form={form} layout="vertical" initialValues={emptyDraft}>
                    <Form.Item name="title" label={t("fe9.prompts.titleField")} rules={[{ required: true }]}>
                        <Input maxLength={200} />
                    </Form.Item>
                    <Form.Item name="content" label={t("fe9.prompts.content")} rules={[{ required: true }]}>
                        <Input.TextArea rows={8} maxLength={50000} />
                    </Form.Item>
                    <Form.Item name="tags" label={t("fe9.prompts.tags")}>
                        <Select mode="tags" maxCount={20} />
                    </Form.Item>
                    <Form.Item name="visibility" label={t("fe9.prompts.visibility")}>
                        <Select
                            options={[
                                { value: "private", label: t("fe9.assets.private") },
                                { value: "team", label: t("fe9.assets.team") },
                            ]}
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
