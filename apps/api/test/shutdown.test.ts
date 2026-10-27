import { expect, test } from "bun:test";
import { createShutdownHandler } from "../src/server/shutdown";
import { noopLogger } from "../src/lib/logger";

test("shuts down the server and database once", async () => {
  let stopCalls = 0;
  let endCalls = 0;
  const exitCodes: number[] = [];

  const shutdown = createShutdownHandler({
    server: {
      stop: async () => {
        stopCalls += 1;
      },
    },
    client: {
      end: async () => {
        endCalls += 1;
      },
    },
    logger: noopLogger,
    exit: (code) => exitCodes.push(code),
  });

  await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

  expect(stopCalls).toBe(1);
  expect(endCalls).toBe(1);
  expect(exitCodes).toEqual([0]);
});

test("continues cleanup and reports shutdown failures", async () => {
  let endCalls = 0;
  const exitCodes: number[] = [];

  const shutdown = createShutdownHandler({
    server: {
      stop: async () => {
        throw new Error("server stop failed");
      },
    },
    client: {
      end: async () => {
        endCalls += 1;
      },
    },
    logger: noopLogger,
    exit: (code) => exitCodes.push(code),
  });

  await shutdown("SIGTERM");

  expect(endCalls).toBe(1);
  expect(exitCodes).toEqual([1]);
});
