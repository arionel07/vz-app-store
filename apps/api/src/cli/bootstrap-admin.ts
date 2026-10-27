import { createAuthService } from "../auth/service";
import { loadEnv } from "../config/env";
import { createDatabase } from "../db/client";

async function readLine(prompt: string, secret = false): Promise<string> {
  process.stdout.write(prompt);
  const input = process.stdin as typeof process.stdin & { setRawMode?: (enabled: boolean) => void };
  const rawMode = secret && input.isTTY && input.setRawMode;
  if (rawMode) input.setRawMode?.(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      input.removeListener("data", onData);
      if (rawMode) input.setRawMode?.(false);
      process.stdout.write("\n");
    };

    const finish = () => {
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const character of text) {
        if (character === "\n" || character === "\r") {
          finish();
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled"));
          return;
        }
        if (character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    input.on("data", onData);
  });
}

async function main() {
  const args = Bun.argv.slice(2);
  const emailArgumentIndex = args.indexOf("--email");
  const email = emailArgumentIndex >= 0 ? args[emailArgumentIndex + 1] : await readLine("Administrator email: ");
  const password = await readLine("Administrator password: ", true);
  const confirmation = await readLine("Confirm password: ", true);

  if (password !== confirmation) {
    throw new Error("Passwords do not match");
  }

  const env = loadEnv();
  const { db, client } = createDatabase(env);
  try {
    const result = await createAuthService(db).bootstrapAdmin(email, password);
    if (result.created) {
      console.log(`Initial administrator created with id ${result.userId}`);
    } else {
      console.log("Administrator bootstrap already completed; no changes made");
    }
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Administrator bootstrap failed");
  process.exitCode = 1;
}
