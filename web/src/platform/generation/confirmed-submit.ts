import type { GenerationEstimate, GenerationEstimateInput } from "@/platform/api/generation";
import { ApiError } from "@/platform/http/errors";
import { confirmGeneration } from "./confirm-dialog";

export async function runConfirmedGeneration<T>(input: GenerationEstimateInput, submit: (estimate: GenerationEstimate) => Promise<T>, confirmer: typeof confirmGeneration = confirmGeneration): Promise<T | null> {
    let force = false;
    for (;;) {
        const estimate = await confirmer(input, { force });
        if (!estimate) return null;
        try {
            return await submit(estimate);
        } catch (error) {
            if (!(error instanceof ApiError) || error.code !== "ESTIMATE_STALE") throw error;
            // 后台切价后必须重新估价并重新取得用户确认，不能沿用静默状态。
            force = true;
        }
    }
}
