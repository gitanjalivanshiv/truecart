import { describe, expect, it } from "vitest";
import { assertSandboxUrl, PAYPAL_SANDBOX_BASE_URL, SandboxGuardError } from "@/src/config/sandbox";

describe("assertSandboxUrl", () => {
  it.each([
    [undefined, PAYPAL_SANDBOX_BASE_URL],
    ["", PAYPAL_SANDBOX_BASE_URL],
    ["https://api-m.sandbox.paypal.com", PAYPAL_SANDBOX_BASE_URL],
    ["https://api-m.sandbox.paypal.com/", PAYPAL_SANDBOX_BASE_URL],
    ["  https://api-m.sandbox.paypal.com  ", PAYPAL_SANDBOX_BASE_URL],
  ])("accepts %j", (input, expected) => {
    expect(assertSandboxUrl(input)).toBe(expected);
  });

  it.each([
    "https://api-m.paypal.com",
    "https://api.paypal.com",
    "https://mcp.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com.evil.example",
    "https://evil.example/?h=api-m.sandbox.paypal.com",
    "https://user:pass@api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com:8443",
    "https://api-m.sandbox.paypal.com/v2",
    "https://api-m.sandbox.paypal.com/#x",
    "https://mcp.sandbox.paypal.com",
    "not a url",
  ])("rejects %j", (input) => {
    expect(() => assertSandboxUrl(input)).toThrow(SandboxGuardError);
  });

  it("accepts only the MCP sandbox host for the mcp service", () => {
    expect(assertSandboxUrl("https://mcp.sandbox.paypal.com", "mcp")).toBe("https://mcp.sandbox.paypal.com");
    expect(() => assertSandboxUrl("https://mcp.paypal.com", "mcp")).toThrow(SandboxGuardError);
    expect(() => assertSandboxUrl("https://api-m.sandbox.paypal.com", "mcp")).toThrow(SandboxGuardError);
  });

  it("never echoes the rejected value", () => {
    const secretish = "https://client:s3cr3t@api-m.paypal.com";
    expect(() => assertSandboxUrl(secretish)).toThrow(/^(?![\s\S]*s3cr3t)/);
  });
});
