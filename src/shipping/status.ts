// Simulated delivery progress (pure). PayPal trackers only know SHIPPED/CANCELLED, so the carrier journey is
// simulated and always labelled as such. A "time machine" advances simulated days for the demo.

export type DeliveryStage = "LABEL_CREATED" | "IN_TRANSIT" | "AT_CUSTOMS" | "OUT_FOR_DELIVERY" | "DELIVERED";

export interface DeliveryState {
  stage: DeliveryStage;
  dayOf: number; // simulated days since shipping
  expectedDays: number;
  overdue: boolean;
  daysLate: number;
  timeline: { stage: DeliveryStage; day: number; reached: boolean }[];
}

/** Grace period before a late parcel counts as overdue. */
export const OVERDUE_GRACE_DAYS = 2;

export function deliveryState(args: {
  simDays: number;
  expectedDays: number;
  crossBorder: boolean;
  delayed: boolean;
}): DeliveryState {
  const expected = Math.max(1, args.expectedDays);
  const plan: { stage: DeliveryStage; day: number }[] = [
    { stage: "LABEL_CREATED", day: 0 },
    { stage: "IN_TRANSIT", day: 1 },
    ...(args.crossBorder ? [{ stage: "AT_CUSTOMS" as const, day: Math.max(2, expected - 2) }] : []),
    { stage: "OUT_FOR_DELIVERY", day: Math.max(1, expected - 1) },
    { stage: "DELIVERED", day: expected },
  ];
  // A delayed parcel stalls before the last mile (at customs when crossing a border, else in transit).
  const stallAt: DeliveryStage = args.crossBorder ? "AT_CUSTOMS" : "IN_TRANSIT";
  const reachable = args.delayed ? plan.slice(0, plan.findIndex((p) => p.stage === stallAt) + 1) : plan;
  const reached = reachable.filter((p) => p.day <= args.simDays);
  const stage = reached.at(-1)?.stage ?? "LABEL_CREATED";
  const delivered = stage === "DELIVERED";
  const daysLate = delivered ? 0 : Math.max(0, args.simDays - expected);
  return {
    stage,
    dayOf: args.simDays,
    expectedDays: expected,
    overdue: !delivered && daysLate > OVERDUE_GRACE_DAYS,
    daysLate,
    timeline: plan.map((p) => ({ ...p, reached: reached.some((r) => r.stage === p.stage) })),
  };
}
