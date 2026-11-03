"use client";

import { useState, useSyncExternalStore } from "react";
import { BoxHead } from "./bits";
import { post, useApi } from "./useApi";

interface TokenView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  hint: string;
}

const noop = () => () => {};
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "never";

export function ConnectAgent() {
  const origin = useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );
  const { data: tokens, reload } = useApi<TokenView[]>("/api/agent-tokens");
  const [label, setLabel] = useState("My assistant");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const config =
    fresh &&
    JSON.stringify(
      {
        mcpServers: { truecart: { type: "http", url: `${origin}/mcp`, headers: { Authorization: `Bearer ${fresh}` } } },
      },
      null,
      2,
    );

  return (
    <section>
      <BoxHead no="05" title="Connect an agent" aside={<span className="label">MCP</span>} />
      <p className="mb-4 max-w-[75ch] text-[13.5px] text-ink-2">
        Let another AI assistant shop for you through TrueCart&apos;s MCP server. It gets four tools (mandate, search,
        cost breakdown, buy) and works inside exactly this mandate: the same limits, approvals and pause switch apply,
        and it cannot change them. Revoke a token at any time.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setCopied(false);
          try {
            const r = await post<{ token: string }>("/api/agent-tokens", { label });
            setFresh(r.token);
            reload();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="w-64">
          <span className="label">Name this connection</span>
          <input
            className="field mt-1 font-sans text-[14px]"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
          />
        </label>
        <button className="btn btn-primary">Create token</button>
        {error && <span className="text-stop">{error}</span>}
      </form>

      {fresh && config && (
        <div className="sheet mt-4 p-4">
          <div className="label mb-1">Shown once. Copy it now.</div>
          <p className="mb-2 text-[13px] text-ink-2">
            Server: <span className="code">{origin}/mcp</span> (streamable HTTP). Add this to an MCP client that
            supports remote servers with headers:
          </p>
          <pre className="code max-h-56 overflow-auto bg-paper p-3 text-[12px] leading-snug">{config}</pre>
          <button
            className="btn mt-2"
            onClick={async () => {
              await navigator.clipboard.writeText(config);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy configuration"}
          </button>
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <table className="ruled mt-5 max-w-[760px]">
          <thead>
            <tr>
              <th>Connection</th>
              <th>Token</th>
              <th>Created</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className={t.revokedAt ? "text-muted" : ""}>
                <td>{t.label}</td>
                <td className="code text-[12px]">…{t.hint}</td>
                <td className="num text-[12.5px]">{when(t.createdAt)}</td>
                <td className="num text-[12.5px]">{when(t.lastUsedAt)}</td>
                <td className="r">
                  {t.revokedAt ? (
                    <span className="label">revoked</span>
                  ) : (
                    <button
                      className="btn-link text-[12.5px] text-stop"
                      onClick={async () => {
                        await fetch(`/api/agent-tokens/${t.id}`, { method: "DELETE" });
                        reload();
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
