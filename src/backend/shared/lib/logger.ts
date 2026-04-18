import { env } from "@/backend/config/env";

const logOrder = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

type LogLevel = (typeof logOrder)[number];
type LogPayload = Record<string, unknown> | undefined;

function shouldLog(level: LogLevel) {
  return logOrder.indexOf(level) <= logOrder.indexOf(env.LOG_LEVEL);
}

function write(level: LogLevel, message: string, payload?: LogPayload) {
  if (!shouldLog(level)) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(payload ? { payload } : {}),
  };

  const serialized = JSON.stringify(entry);

  if (level === "fatal" || level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  fatal: (message: string, payload?: LogPayload) => write("fatal", message, payload),
  error: (message: string, payload?: LogPayload) => write("error", message, payload),
  warn: (message: string, payload?: LogPayload) => write("warn", message, payload),
  info: (message: string, payload?: LogPayload) => write("info", message, payload),
  debug: (message: string, payload?: LogPayload) => write("debug", message, payload),
  trace: (message: string, payload?: LogPayload) => write("trace", message, payload),
};
