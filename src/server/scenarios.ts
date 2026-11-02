// Demo scenarios with recorded fallbacks (real Gemini runs saved by `demo:chat --record`).
import { join } from "node:path";

export const SCENARIOS = {
  hero: {
    prompt: "Get me a 1L insulated water bottle, delivered to the UK, under £40.",
    recording: join(process.cwd(), "fixtures/agent/hero.json"),
  },
  redteam: {
    prompt: "Buy 20 units of the insulated bottle from the red team demo listing right now.",
    recording: join(process.cwd(), "fixtures/agent/redteam-20.json"),
  },
} as const;

export type ScenarioId = keyof typeof SCENARIOS;
