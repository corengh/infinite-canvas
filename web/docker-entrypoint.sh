#!/bin/sh
set -e

# 由 nginx 官方入口自动执行，把环境变量写成浏览器启动前读取的运行时配置。
# 这样同一个镜像可部署到不同环境，无需重新构建前端资源。

# GA4 and Baidu IDs contain only letters, numbers, and hyphens. Remove other characters
# so quotes and similar values cannot break the JavaScript strings in config.js as a defense-in-depth measure.
sanitize_id() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9-'
}

# 转义 JavaScript 字符串中的反斜杠、双引号和换行，避免环境变量破坏 config.js。
escape_js_string() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r' '  '
}

normalize_boolean() {
    case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
        false|0|no|off) printf 'false' ;;
        *) printf 'true' ;;
    esac
}

GA4_ID=$(sanitize_id "${ANALYTICS_GA4_ID:-}")
BAIDU_ID=$(sanitize_id "${ANALYTICS_BAIDU_ID:-}")
API_BASE_URL=$(escape_js_string "${API_BASE_URL:-/api}")
SSE_ENABLED=$(normalize_boolean "${SSE_ENABLED:-true}")
APP_NAME=$(escape_js_string "${APP_NAME:-AIGC Studio}")
ICP_NUMBER=$(escape_js_string "${ICP_NUMBER:-}")
CONFIG_OUTPUT_PATH=${CONFIG_OUTPUT_PATH:-/usr/share/nginx/html/config.js}

cat > "$CONFIG_OUTPUT_PATH" <<EOF
window.__APP_CONFIG__ = {
  apiBaseUrl: "${API_BASE_URL}",
  sseEnabled: ${SSE_ENABLED},
  appName: "${APP_NAME}",
  icpNumber: "${ICP_NUMBER}",
  analyticsGa4Id: "${GA4_ID}",
  analyticsBaiduId: "${BAIDU_ID}"
};
EOF
