import { paypalBaseUrl } from "./src/config/sandbox";

try {
  paypalBaseUrl();
} catch (err) {
  console.error(`[truecart] boot refused: ${(err as Error).message}`);
  process.exit(1);
}
