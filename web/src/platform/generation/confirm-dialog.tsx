import { Checkbox, Modal } from "antd";
import { useEffect, useState } from "react";

import { estimateGeneration, type GenerationEstimate, type GenerationEstimateInput } from "@/platform/api/generation";
import { authStore } from "@/platform/auth/store";
import { CreditAmount } from "@/platform/components/credit-amount";
import { creditRequestTaskContext, InsufficientHint } from "@/platform/components/insufficient-hint";

type PendingConfirmation = {
    input: GenerationEstimateInput;
    estimate: GenerationEstimate;
    resolve: (result: GenerationEstimate | null) => void;
};

type Listener = (pending: PendingConfirmation | null) => void;
const listeners = new Set<Listener>();
const queue: PendingConfirmation[] = [];
let active: PendingConfirmation | null = null;
type Approval = { key: string; credits: number; remaining: number };
const approvals: Approval[] = [];

function approvalKey(input: GenerationEstimateInput): string {
    // prompt 与模型足以隔离紧邻的画布操作；完整参数仍由提交前的服务端估价权威校验。
    return JSON.stringify([input.capability, input.model_code, input.params.prompt ?? ""]);
}

export function rememberGenerationApproval(input: GenerationEstimateInput, estimate: GenerationEstimate): void {
    const count = typeof input.params.count === "number" ? input.params.count : Number(input.params.count) || 1;
    approvals.push({ key: approvalKey(input), credits: estimate.credits, remaining: Math.max(1, Math.floor(count)) });
}

function takeGenerationApproval(input: GenerationEstimateInput): Approval | undefined {
    const index = approvals.findIndex((approval) => approval.key === approvalKey(input) && approval.remaining > 0);
    if (index < 0) return undefined;
    const approval = approvals[index];
    approval.remaining -= 1;
    if (approval.remaining === 0) approvals.splice(index, 1);
    return approval;
}

function publish() {
    listeners.forEach((listener) => listener(active));
}

function enqueue(pending: PendingConfirmation) {
    queue.push(pending);
    if (!active) {
        active = queue.shift() ?? null;
        publish();
    }
}

function finish(result: GenerationEstimate | null) {
    const current = active;
    active = queue.shift() ?? null;
    current?.resolve(result);
    publish();
}

function silentKey(): string {
    return `aigc-studio:generation-confirm-silent:${authStore.getState().user?.id ?? "anonymous"}`;
}

function isSilent(): boolean {
    try {
        return sessionStorage.getItem(silentKey()) === "1";
    } catch {
        return false;
    }
}

export async function confirmGeneration(input: GenerationEstimateInput, options: { force?: boolean } = {}): Promise<GenerationEstimate | null> {
    const approval = takeGenerationApproval(input);
    const estimate = await estimateGeneration(input);
    // 画布已对同一提示词的整批上限取得确认；单项价格未超过该上限时无需重复弹窗。
    if (approval && estimate.credits <= approval.credits && !options.force) return estimate;
    // 高消耗确认永远不能被会话静默跳过；预估过期重试也必须强制再次展示。
    if (!shouldShowConfirmation(estimate, Boolean(options.force), isSilent())) return estimate;
    return new Promise((resolve) => enqueue({ input, estimate, resolve }));
}

export function shouldShowConfirmation(estimate: GenerationEstimate, force: boolean, silent: boolean): boolean {
    return force || estimate.requires_confirmation || !estimate.sufficient || !silent;
}

export function confirmationAllowed(estimate: GenerationEstimate, highCostChecked: boolean): boolean {
    return estimate.sufficient && (!estimate.requires_confirmation || highCostChecked);
}

export function GenerationConfirmHost() {
    const [pending, setPending] = useState<PendingConfirmation | null>(active);
    const [highCostChecked, setHighCostChecked] = useState(false);
    const [silentChecked, setSilentChecked] = useState(false);

    useEffect(() => {
        listeners.add(setPending);
        return () => {
            listeners.delete(setPending);
        };
    }, []);

    useEffect(() => {
        setHighCostChecked(false);
        setSilentChecked(false);
    }, [pending]);

    const estimate = pending?.estimate;
    return (
        <Modal
            title="确认生成"
            open={Boolean(pending)}
            okText="确认生成"
            cancelText="取消"
            centered
            okButtonProps={{ disabled: !estimate || !confirmationAllowed(estimate, highCostChecked) }}
            onOk={() => {
                if (!estimate) return;
                if (silentChecked && !estimate.requires_confirmation) {
                    try {
                        sessionStorage.setItem(silentKey(), "1");
                    } catch {
                        // 存储不可用只影响静默偏好，不影响本次确认。
                    }
                }
                finish(estimate);
            }}
            onCancel={() => finish(null)}
        >
            {estimate ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                        <span>本次预计消耗</span>
                        <CreditAmount value={estimate.credits} className="font-semibold" />
                        <span>当前可用余额</span>
                        <CreditAmount value={estimate.available} />
                        <span>生成后剩余</span>
                        <CreditAmount value={Math.max(0, estimate.after)} />
                    </div>
                    {!estimate.sufficient ? (
                        <InsufficientHint
                            required={estimate.credits}
                            available={estimate.available}
                            // 补拨申请只保存审批所需摘要，不能把完整提示词写入业务记录。
                            taskContext={creditRequestTaskContext(pending.input, estimate.credits)}
                        />
                    ) : null}
                    {estimate.requires_confirmation ? (
                        <Checkbox checked={highCostChecked} onChange={(event) => setHighCostChecked(event.target.checked)}>
                            本次属于高消耗任务，我已确认预计积分
                        </Checkbox>
                    ) : (
                        <Checkbox checked={silentChecked} onChange={(event) => setSilentChecked(event.target.checked)}>
                            本次会话不再提示
                        </Checkbox>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}
