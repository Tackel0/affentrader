import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-fallback-screen">
      <section className="route-fallback-card">
        <span className="route-fallback-brand">AFFENTERMINAL · 404</span>
        <h1>404 · Route Not Found</h1>
        <p>The requested workspace route or market resource could not be found.</p>
        <div className="route-fallback-actions">
          <Link href="/" className="button primary">
            Chart Workspace
          </Link>
          <Link href="/terminal" className="button">
            AffenTerminal
          </Link>
        </div>
      </section>
    </main>
  );
}
