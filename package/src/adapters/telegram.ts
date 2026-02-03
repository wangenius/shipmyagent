/**
 * Telegram adapter entrypoint.
 *
 * The implementation is split into small modules under `./telegram/` to keep each file
 * maintainable (≤ 800–1000 LOC) and to avoid the old monolithic adapter.
 *
 * This file remains the stable import surface:
 * - Runtime: `createTelegramBot(...)` / `TelegramBot`
 * - Types: `TelegramConfig` / `TelegramUpdate` / `TelegramUser`
 */
export { TelegramBot, createTelegramBot } from "./telegram/bot.js";
export type {
  TelegramConfig,
  TelegramUpdate,
  TelegramUser,
} from "./telegram/shared.js";

