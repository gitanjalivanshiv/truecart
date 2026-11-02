import { describe, expect, it } from "vitest";
import { redact } from "@/src/lib/redact";

describe("redact", () => {
  it("drops secrets and masks identifiers, deeply", () => {
    const out = redact({
      access_token: "A21AA-very-secret",
      nested: [{ client_secret: "x", vault_id: "jwgvx42abc", email_address: "buyer@example.com" }],
      links: [
        { href: "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=1&token=ABC", rel: "approve" },
      ],
      keep: "visible",
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("A21AA");
    expect(text).not.toContain("buyer@example.com");
    expect(text).not.toContain("token=ABC");
    expect(text).toContain("x42abc".slice(-4));
    expect(out.keep).toBe("visible");
  });

  it("hides personal payer and address fields", () => {
    const out = redact({
      name: { given_name: "Jo", surname: "Doe" },
      address: { address_line_1: "1 High St", postal_code: "TW9 1EH", country_code: "GB" },
    });
    expect(JSON.stringify(out)).not.toMatch(/Jo|Doe|High St|TW9/);
    expect(out.address.country_code).toBe("GB");
  });

  it("handles cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});
