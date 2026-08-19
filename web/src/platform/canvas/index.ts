// FE-1 先提供锁丢失事件；FE-7/FE-8 将补齐同步、离线队列与编辑锁 UI，插件 store 明确不进入同步范围。
export { canvasEvents } from "./events";
export type { CanvasEvent } from "./events";
