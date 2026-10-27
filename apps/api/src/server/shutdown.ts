import type { Logger } from "../lib/logger";

export interface ShutdownServer {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

export interface ShutdownClient {
  end(): Promise<void>;
}

export interface ShutdownDependencies {
  server: ShutdownServer;
  client: ShutdownClient;
  logger: Logger;
  exit?: (code: number) => void;
}

export function createShutdownHandler({ server, client, logger, exit = (code) => process.exit(code) }: ShutdownDependencies) {
  let shuttingDown = false;

  return async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      logger.warn("Shutdown already in progress", { signal });
      return;
    }

    shuttingDown = true;
    let failed = false;

    try {
      await server.stop(true);
    } catch (error) {
      failed = true;
      logger.error("HTTP server shutdown failed", { error, signal });
    }

    try {
      await client.end();
    } catch (error) {
      failed = true;
      logger.error("Database client shutdown failed", { error, signal });
    }

    exit(failed ? 1 : 0);
  };
}
