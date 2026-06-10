import app from "./app.js";
import { env } from "./config/env.js";

if (!env.isVercel) {
  app.listen(env.port);

  console.log(`Listening on http://localhost:${env.port} (${env.nodeEnv})`);
}
