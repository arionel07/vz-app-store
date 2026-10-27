export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

export function createLogger(minLevel: LogLevel = "info"): Logger {
  const write = (level: LogLevel, message: string, context: LogContext = {}) => {
    if (priorities[level] < priorities[minLevel]) return;

    const normalizedContext = Object.fromEntries(
      Object.entries(context).map(([key, value]) => [key, serializeError(value)]),
    );

    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...normalizedContext,
    });

    if (level === "error") {
      console.error(entry);
    } else if (level === "warn") {
      console.warn(entry);
    } else {
      console.log(entry);
    }
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
