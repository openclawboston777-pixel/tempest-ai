import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error({ err: (error as Error).message }, "failed to start server");
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}

void main();
