#!/bin/sh
set -eu

OUTPUT_FILE=$(mktemp)
trap 'rm -f "$OUTPUT_FILE"' EXIT

# 使用包含引号与换行的值验证转义，防止环境变量生成无效 JavaScript。
CONFIG_OUTPUT_PATH="$OUTPUT_FILE" \
API_BASE_URL='https://api.example.com/v1' \
SSE_ENABLED='false' \
APP_NAME='AIGC "Studio"' \
ICP_NUMBER='京ICP备123456号' \
ANALYTICS_GA4_ID='G-ABC<script>' \
ANALYTICS_BAIDU_ID='bd-123' \
sh docker-entrypoint.sh

grep -F 'apiBaseUrl: "https://api.example.com/v1"' "$OUTPUT_FILE" >/dev/null
grep -F 'sseEnabled: false' "$OUTPUT_FILE" >/dev/null
grep -F 'appName: "AIGC \"Studio\""' "$OUTPUT_FILE" >/dev/null
grep -F 'icpNumber: "京ICP备123456号"' "$OUTPUT_FILE" >/dev/null
grep -F 'analyticsGa4Id: "G-ABCscript"' "$OUTPUT_FILE" >/dev/null
grep -F 'analyticsBaiduId: "bd-123"' "$OUTPUT_FILE" >/dev/null

echo "运行时配置注入测试通过"
