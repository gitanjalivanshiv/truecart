// Shapes returned by the API (see src/server/views.ts).
export interface MoneyView {
  minor: number;
  currency: string;
  text: string;
}

export interface StateView {
  mandate: {
    currency: string;
    perPurchaseCap: MoneyView;
    monthlyCap: MoneyView;
    approvalThreshold: MoneyView;
    maxUnitsPerPurchase: number;
    allowedMerchantCountries: string[];
    allowedOrderCurrencies: string[];
    maxFxSlackBps: number;
    buyerCountry: string;
    fundingCurrency: string;
    expiresAt: string;
    paused: boolean;
  };
  wallet: {
    linked: boolean;
    kind: "shared-sandbox-buyer" | "your-sandbox-wallet" | null;
    demoWalletAvailable: boolean;
  };
  spend: { committed: MoneyView; remaining: MoneyView; monthlyCap: MoneyView };
  awaitingApprovals: number;
}
