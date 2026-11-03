#!/usr/bin/env bash
# Runs the judges' path against a deployed TrueCart (PayPal SANDBOX: no real money).
#   scripts/judge-smoke.sh https://<service>.onrender.com [--no-pay]
# Checks: health, a fresh visitor workspace, landed-cost ranking, the hijacked-agent drill (must be DENIED),
# and, unless --no-pay, the hero request through the agent (must end PAID in the sandbox).
set -euo pipefail
URL="${1:?usage: judge-smoke.sh <base-url> [--no-pay]}"
URL="${URL%/}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log($1)})"; }

echo "1. health (wakes a sleeping free instance; can take ~1 min)"
curl -fsS --max-time 120 "$URL/api/health" | j 'o.ok && o.paypal==="sandbox" ? "   ok: sandbox, paypal="+o.configured.paypal+", webhook="+o.configured.webhook+", llm="+o.configured.llm : "BAD"' | grep -q "ok:" || fail "health"
curl -fsS --max-time 30 "$URL/api/health" | j '"   "+JSON.stringify(o.configured)'

echo "2. fresh visitor workspace"
curl -fsS -c "$JAR" -b "$JAR" -o /dev/null "$URL/"
curl -fsS -b "$JAR" "$URL/api/state" | j '"   mandate: "+o.mandate.perPurchaseCap.text+" per purchase, "+o.mandate.monthlyCap.text+" a month; wallet linked: "+o.wallet.linked'

echo "3. ranking by landed cost"
curl -fsS -b "$JAR" -X POST "$URL/api/offers" -H 'content-type: application/json' -d '{"query":"insulated water bottle 1 litre"}' \
  | j '"   "+o.rows.length+" offers; #1 landed "+o.rows[0].landed.text+" ("+o.rows[0].store+"); cheapest sticker ranks #"+o.rows.find(r=>r.stickerRank===1).trueRank'

echo "4. hijacked-agent drill (20 units from the hostile listing)"
OUT="$(curl -fsS -b "$JAR" -X POST "$URL/api/redteam")"
echo "$OUT" | j '"   "+o.status+": "+o.reasons.join(", ")'
echo "$OUT" | grep -q '"status":"DENIED"' || fail "red-team drill was not denied"

if [[ "${2:-}" != "--no-pay" ]]; then
  echo "5. hero request through the agent (sandbox payment)"
  CID="$(node -e 'console.log(crypto.randomUUID())')"
  EVENTS="$(curl -fsS -N --max-time 180 -b "$JAR" -X POST "$URL/api/agent/chat" -H 'content-type: application/json' \
    -d "{\"conversationId\":\"$CID\",\"message\":\"Get me a 1L insulated water bottle, delivered to the UK, under £40.\",\"scenario\":\"hero\"}")"
  echo "$EVENTS" | sed -n 's/^data: //p' | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      for (const l of d.trim().split("\n")) { const e=JSON.parse(l);
        if (e.type==="mode") console.log("   model:", e.mode, e.model, e.reason??"");
        if (e.type==="tool_result") console.log("   tool:", e.name, e.status??"");
        if (e.type==="guard") console.log("   guard:", e.rule);
        if (e.type==="done") console.log("   answer:", e.text.slice(0,140).replace(/\n/g," "), "…"); } })'
  echo "$EVENTS" | grep -q '"status":"CAPTURED"' || fail "hero purchase was not captured"
  curl -fsS -b "$JAR" "$URL/api/ledger" | j '"   ledger: "+o.rows.length+" purchase(s), spent "+o.spend.committed.text+" of "+o.spend.monthlyCap.text'
fi
echo "PASS"
