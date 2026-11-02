import { Suspense } from "react";
import { Mandate } from "../_components/Mandate";

async function WithStatus({ searchParams }: { searchParams: PageProps<"/mandate">["searchParams"] }) {
  const sp = await searchParams;
  const wallet = typeof sp.wallet === "string" ? sp.wallet : undefined;
  return <Mandate walletStatus={wallet} />;
}

export default function MandatePage(props: PageProps<"/mandate">) {
  return (
    <Suspense fallback={null}>
      <WithStatus searchParams={props.searchParams} />
    </Suspense>
  );
}
