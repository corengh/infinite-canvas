import { Alert, Button, Card, Typography } from "antd";
import { ArrowLeft, Clock3 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@/platform/auth/store";

export default function RechargePlaceholderPage() {
    const navigate = useNavigate();
    const role = useAuthStore((state) => state.role);
    const owner = role === "owner";

    return (
        <main className="h-full overflow-y-auto p-6">
            <Card className="mx-auto max-w-2xl">
                <Typography.Title level={2}>充值</Typography.Title>
                <Alert
                    showIcon
                    type={owner ? "info" : "warning"}
                    icon={<Clock3 className="size-4" />}
                    message={owner ? "充值功能正在准备中" : "仅主账号可以充值"}
                    description={owner ? "当前暂时无法创建充值订单，请稍后再试。" : "如需积分，请返回钱包提交补拨申请。"}
                />
                <Button className="mt-4" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/wallet")}>
                    返回钱包
                </Button>
            </Card>
        </main>
    );
}
