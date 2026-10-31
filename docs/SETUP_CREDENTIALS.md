# Setting up credentials (sandbox only)

Put every value in `.env` at the repo root (git-ignored, mode 600). Never paste secrets into chat, issues or commits.

## The one thing to understand first

|                                      | What it is                                                                             | Email / phone                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Developer login** (1 real account) | Your own PayPal account, used only to sign in to developer.paypal.com. No money moves. | Your **real** details, your **real** country. A Personal account is enough.  |
| **Sandbox test accounts** (fake)     | Created _inside_ the developer dashboard. They only exist in the sandbox.              | **Auto-generated** (`sb-xxxx@business.example.com`). No phone. Nothing real. |

If a form asks for a government-ID name, a phone that can receive texts, or says the country "can't be changed later", you are on the **real** PayPal sign-up. Use your real details and real country there, or go back and log in with an existing PayPal account instead. Do not invent a US business.

## A. PayPal

1. **Developer login.** Go to developer.paypal.com and choose **Log in to Dashboard**, using any PayPal account you already have. If you have none, sign up for a **Personal** account at paypal.com with your real details, then log in.
2. Set the toggle at the top of the dashboard to **Sandbox**.
3. **US merchant (fake).** Go to **Testing Tools → Sandbox Accounts → Create account**, choose **Business** and **United States**, then **Create**.
4. **GB buyer (fake).**
   - Click **Create account** again and choose **Personal** and **United Kingdom**.
   - If the dialog offers custom fields, set a **PayPal balance** of 5000. Otherwise just click **Create**.
5. **Passwords.** For each sandbox row, open **⋯ → View/Edit account → Change password**. Set one (8–20 characters) and store it in your password manager.
6. **REST app.** Go to **Apps & Credentials → Create App**:
   - Name `TrueCart`, type **Merchant**.
   - Sandbox account: the **US business** account from step 3.
   - Then **Create App**.
7. Copy **Client ID** to `PAYPAL_CLIENT_ID` and **Secret** (click Show) to `PAYPAL_CLIENT_SECRET`.
8. **Enable Vault.** On the app page, open **Features / App Feature Options**:
   - Make sure **Accept payments** is on.
   - Under **Advanced options**, tick **Vault** (it may be labelled "Save payment methods"). Save.
9. **Let the merchant accept GBP/EUR.**
   - Log in at sandbox.paypal.com/signin with the **US business** sandbox account.
   - Go to **Settings → Payments → Payment preferences / Block payments**.
   - For currencies you don't hold, choose **accept and convert to USD**.
   - If you can't find this, skip it: `npm run spike:fx-orders` reports whether GBP/EUR are blocked.

## B. Channel3

Sign up at trychannel3.com/sign-up/developer and copy the key to `CHANNEL3_API_KEY`. The free tier is 1,000 searches a month.

## C. Anthropic

Go to console.anthropic.com → **Settings → API Keys → Create key** and put it in `ANTHROPIC_API_KEY`. Set a low monthly limit under **Settings → Limits**.

## D. GitHub, Render, optional tools

- GitHub: an empty public repo (no README, licence or .gitignore), or run `gh repo create`.
- Render: sign up at render.com with GitHub. No service yet.
- Optional: `brew install cloudflared` for local webhook tests (S5).

## E. Then

Run `npm run spike:vault -- setup`; it prints a PayPal link. Log in as the **GB buyer** and click Agree, then run the remaining spikes (`docs/SPIKE_RESULTS.md`).
