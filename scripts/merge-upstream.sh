#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command_name="${1:-}"
upstream_version="${2:-}"

usage() {
    echo "用法："
    echo "  scripts/merge-upstream.sh prepare <上游版本，例如 v0.16.0>"
    echo "  scripts/merge-upstream.sh verify"
}

ensure_clean() {
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "工作区存在未提交改动，请先处理后再合并上游。" >&2
        exit 1
    fi
}

run_web_script() {
    if command -v bun >/dev/null 2>&1; then
        (cd web && bun run "$1")
    else
        npm --prefix web run "$1"
    fi
}

cd "$repo_root"

case "$command_name" in
    prepare)
        if [[ ! "$upstream_version" =~ ^v[0-9]+([.][0-9]+){2}([.-][0-9A-Za-z.-]+)?$ ]]; then
            usage
            exit 2
        fi
        ensure_clean
        if [[ "$(git branch --show-current)" != "main" ]]; then
            echo "prepare 必须从 origin/main 对应的本地 main 分支执行。" >&2
            exit 1
        fi
        git fetch upstream main
        merge_branch="merge/upstream-$(date +%Y%m%d)-${upstream_version}"
        git switch -c "$merge_branch" main
        if ! git merge --no-commit --no-ff upstream/main; then
            echo "上游冲突已保留在工作区；请按 MERGE.md 的策略处理，然后提交合并结果。" >&2
            exit 1
        fi
        echo "上游已合入暂存状态。检查差异后提交，再执行：scripts/merge-upstream.sh verify"
        ;;
    verify)
        ensure_clean
        if [[ "$(git branch --show-current)" != merge/upstream-* ]]; then
            echo "verify 只允许在 merge/upstream-* 分支执行。" >&2
            exit 1
        fi
        run_web_script test:foundation
        run_web_script lint:http
        run_web_script test:http
        run_web_script test:auth
        run_web_script test:wallet-team
        run_web_script test:recharge
        run_web_script test:generation
        run_web_script test:canvas-sync
        run_web_script test:fe9
        run_web_script typecheck
        run_web_script build
        echo "自动回归通过。继续按 MERGE.md 完成人工回归、合入 main、打 tag 和推送。"
        ;;
    *)
        usage
        exit 2
        ;;
esac
