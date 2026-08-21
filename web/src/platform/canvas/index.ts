// 插件 store 明确不进入同步范围；画布 UI 选择态和撤销历史也保持本地，避免存储型 XSS 与视图状态污染。
export { canvasEvents } from "./events";
export type { CanvasEvent } from "./events";
export { canvasLoader } from "./loader";
export { canvasSync, SyncEngine } from "./sync-engine";
