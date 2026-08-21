export function formatCredits(value: number): string {
    return `✦ ${Math.trunc(value).toLocaleString("zh-CN")}`;
}

export function CreditAmount({ value, className }: { value: number; className?: string }) {
    return <span className={className}>{formatCredits(value)}</span>;
}
