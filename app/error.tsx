"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="max-w-[60ch] py-10">
      <div className="box-head">
        <span className="no">ERR</span>
        <h2>Something went wrong on this page</h2>
      </div>
      <p className="mb-4 text-ink-2">
        Nothing was charged because of this error. Payments only happen through the mandate checks, never from the page
        itself.
      </p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
