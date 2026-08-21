import { Alert, Button, message } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { walletApi } from "@/platform/api/wallet";
import type { ModelCapability } from "@/platform/api/models";
import { useAuthStore } from "@/platform/auth/store";
import { formatCredits } from "./credit-amount";

export type CreditRequestTaskContext = {
    model_code: string;
    capability: ModelCapability;
    estimated: number;
};

export function creditRequestTaskContext(input: { model_code: string; capability: ModelCapability }, estimated: number): CreditRequestTaskContext {
    // 申请记录会长期保存，只提取审批所需字段，绝不携带 params 中的完整提示词。
    return { model_code: input.model_code, capability: input.capability, estimated };
}

export function InsufficientHint({ required, available, taskContext }: { required: number; available: number; taskContext?: CreditRequestTaskContext }) {
    const navigate = useNavigate();
    const accountType = useAuthStore((state) => state.user?.account_type);
    const [submitting, setSubmitting] = useState(false);
    const shortage = Math.max(1, required - available);

    const requestCredits = async () => {
        setSubmitting(true);
        try {
            await walletApi.createRequest({ amount: shortage, reason: "生成任务积分不足", task_context: taskContext });
            message.success("补拨申请已提交");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "补拨申请提交失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Alert
            type="warning"
            showIcon
            message={`可用 ${formatCredits(available)} / 本次需 ${formatCredits(required)}`}
            action={
                insufficientAction(accountType) === "recharge" ? (
                    <Button size="small" type="link" onClick={() => navigate("/recharge")}>
                        去充值
                    </Button>
                ) : (
                    <Button size="small" type="link" loading={submitting} onClick={() => void requestCredits()}>
                        申请补拨
                    </Button>
                )
            }
        />
    );
}

export function insufficientAction(accountType: "owner" | "sub" | undefined): "recharge" | "request" {
    return accountType === "owner" ? "recharge" : "request";
}
