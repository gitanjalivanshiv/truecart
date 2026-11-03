import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-[60ch] py-10">
      <div className="box-head">
        <span className="no">404</span>
        <h2>No such page</h2>
      </div>
      <p className="text-ink-2">
        That address does not exist. Go to the{" "}
        <Link href="/" className="underline underline-offset-2">
          Shop
        </Link>{" "}
        to start a request.
      </p>
    </div>
  );
}
