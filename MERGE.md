# 上游合并手册

本项目长期保留两个远端：`upstream/main` 指向 `basketikun/infinite-canvas`，`origin/main` 指向项目 fork。业务分支从 `origin/main` 创建；每次完成上游合并后，在 `origin/main` 的合并点打 `merge/upstream-v<版本>` tag。

## 标准流程

1. 确认 `main` 与工作区干净，运行 `scripts/merge-upstream.sh prepare v<上游版本>`。脚本会 fetch `upstream/main`、创建 `merge/upstream-<日期>-v<版本>` 分支，并以 `--no-commit` 合入上游。
2. 按下表处理冲突，确认远程插件、WebDAV、工作台路由和本地 Agent 入口没有复活，然后提交合并结果。
3. 在合并分支运行 `scripts/merge-upstream.sh verify`，完成接缝/禁用项、i18n、平台模块、类型和生产构建回归。脚本优先使用 CI 同款 Bun，本机未安装 Bun 时使用现有 npm 依赖执行相同 package scripts。
4. 完成人工回归：登录与画布基本编辑、刷新后 op 恢复、双标签编辑锁、带预估与 SSE 的图片生成、资产加载与共享标识。
5. 合入和推送前再次确认当前提交已在 fork 可达：

```bash
git switch main
git merge --no-ff merge/upstream-<日期>-v<版本>
git tag merge/upstream-v<版本>
git push origin main
git push origin merge/upstream-v<版本>
```

父仓库只有在上述 frontend commit 和 tag 均已推送到 fork 后，才能更新 `frontend` gitlink。

## 冲突重灾区

| 文件                                                    | 处置策略                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `web/src/pages/canvas/project.tsx`                      | 优先接受上游主体，再按父仓库 `docs/design/03-fe-modules.md` 重新植入 #8～#10 三处接缝。 |
| `web/src/stores/canvas/use-canvas-store.ts`             | 优先接受上游，再重新植入 #5、#6。                                                       |
| `web/src/components/canvas/canvas-node.tsx`             | 优先接受上游，再重新植入 Audio 隐藏接缝 #18。                                           |
| `web/src/services/api/image.ts`、`video.ts`、`audio.ts` | 保留己方平台 API 实现，不合回浏览器供应商直连。                                         |
| `web/src/stores/use-config-store.ts`                    | 逐段人工合并，禁止恢复用户密钥、baseUrl 或 WebDAV 凭据。                                |
| `web/src/lib/canvas/plugin-loader.ts`                   | 保留己方删除结果，禁止恢复远程下载、动态执行和持久化 source 恢复。                      |
| `web/src/router.tsx`                                    | 手工合并平台路由；`/image`、`/video` 不得恢复。                                         |
| `web/src/platform/**`                                   | 全部保留己方；该目录承载平台能力。                                                      |

## 自动回归边界

`web/scripts/check-foundation.mjs` 固定检查 18 个 `[PLATFORM]` 接缝、禁用项、不可达入口和 Audio 生成隐藏；`web/scripts/check-i18n-keys.mjs` 校验中英文 key 完全一致。CI 还会在 `web/src/platform/` 以外单次改动超过 500 行时给出 D-16 警告。

自动守卫不能替代五项人工业务回归。发生冲突时，不应为追求“无冲突”而恢复被平台安全边界明确删除的上游能力。
