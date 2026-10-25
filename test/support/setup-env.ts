import { loadRootEnv } from "../../packages/shared/src/node";

// Every integration test talks to the test database, never the dev database.
loadRootEnv();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Live AI must never be reached from tests, even if a key is configured locally.
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) delete process.env[key];
process.env.AI_PROVIDER = "anthropic";
