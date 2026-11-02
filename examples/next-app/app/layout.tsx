import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: { default: "Acme", template: "%s · Acme" } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/" className="brand">Acme</Link>
          <nav>
            <Link href="/about">About</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/docs/getting-started">Docs</Link>
            <Link href="/insights">IntelRoute insights</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
