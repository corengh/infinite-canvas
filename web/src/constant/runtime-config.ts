import { runtime } from "@/platform/runtime";

// 保留基座原有导出名，调用方无需感知运行时配置已迁入 platform。
export const ANALYTICS_GA4_ID = runtime.analyticsGa4Id;
export const ANALYTICS_BAIDU_ID = runtime.analyticsBaiduId;
