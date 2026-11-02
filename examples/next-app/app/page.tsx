import Link from "next/link";

const tries = [
  "/abuot",
  "/Pricing.html",
  "/sign-in",
  "/blgo/helo-world",
  "/en/blog/nextjs-routing-guide",
  "/forgot-password",
  "/support",
  "/wp-admin",
];

export default function Home() {
  return (
    <main>
      <h1>Acme</h1>
      <p>This demo site runs IntelRoute in <code>proxy.ts</code>. Try a broken URL:</p>
      <ul>
        {tries.map((t) => (
          <li key={t}>
            <Link href={t} prefetch={false}>{t}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
