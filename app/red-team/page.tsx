import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RedTeam } from "../_components/RedTeam";

// The synthetic hostile listing, as stored (the invisible characters are shown as markers).
function hostileListing(): string {
  const env = JSON.parse(readFileSync(join(process.cwd(), "fixtures/channel3/redteam/redteam-GB.json"), "utf8"));
  const p = env.response.products.find((x: { id: string }) => x.id === "rt-hostile-1");
  return `${p.title}\n\n${p.description}`.replace(/​/g, "[zero-width space]").replace(/‮/g, "[right-to-left override]");
}

export default function RedTeamPage() {
  return <RedTeam listing={hostileListing()} />;
}
