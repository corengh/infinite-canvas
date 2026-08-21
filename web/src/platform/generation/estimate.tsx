import { useEffect, useRef, useState } from "react";

import { estimateGeneration, type GenerationEstimate, type GenerationEstimateInput } from "@/platform/api/generation";

export type EstimateState = {
    data: GenerationEstimate | null;
    loading: boolean;
    error: boolean;
};

export class EstimateScheduler {
    private seq = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly request: (input: GenerationEstimateInput) => Promise<GenerationEstimate>,
        private readonly publish: (state: EstimateState) => void,
        private readonly delay: number,
    ) {}

    update(input: GenerationEstimateInput): void {
        const seq = ++this.seq;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.publish({ data: null, loading: true, error: false });
            void this.request(input).then(
                (data) => {
                    // 快速切换参数时旧响应即使最后返回，也不能覆盖新档位的价格。
                    if (seq === this.seq) this.publish({ data, loading: false, error: false });
                },
                () => {
                    if (seq === this.seq) this.publish({ data: null, loading: false, error: true });
                },
            );
        }, this.delay);
    }

    cancel(): void {
        this.seq += 1;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }
}

export function useDebouncedEstimate(input: GenerationEstimateInput | null, delay = 300): EstimateState {
    const [state, setState] = useState<EstimateState>({ data: null, loading: false, error: false });
    const scheduler = useRef<EstimateScheduler | null>(null);
    if (!scheduler.current) scheduler.current = new EstimateScheduler(estimateGeneration, setState, delay);
    const serialized = input ? JSON.stringify(input) : "";

    useEffect(() => {
        if (!input) {
            scheduler.current?.cancel();
            setState({ data: null, loading: false, error: false });
            return;
        }
        scheduler.current?.update(input);
        return () => scheduler.current?.cancel();
        // serialized 是深层参数的稳定变化信号，避免父组件每次渲染都重新计时。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serialized]);

    return state;
}

export function EstimateDisplay({ input }: { input: GenerationEstimateInput | null }) {
    const estimate = useDebouncedEstimate(input, 300);
    return (
        <div className="text-xs">
            <div className="font-medium">{estimate.loading ? "✦ 预估中…" : estimate.data ? `✦ 预估 ${estimate.data.credits.toLocaleString("zh-CN")}` : "✦ --"}</div>
            {estimate.data ? (
                <details className="mt-1 opacity-70">
                    <summary className="cursor-pointer">计价明细</summary>
                    <div className="mt-1 grid grid-cols-2 gap-x-3">
                        <span>基准 {estimate.data.breakdown.base}</span>
                        <span>用量 {estimate.data.breakdown.units}</span>
                        <span>质量倍率 {estimate.data.breakdown.quality}</span>
                        <span>分辨率倍率 {estimate.data.breakdown.resolution}</span>
                        <span>时长倍率 {estimate.data.breakdown.duration}</span>
                        <span>团队折扣 {estimate.data.breakdown.discount}</span>
                    </div>
                </details>
            ) : null}
        </div>
    );
}
