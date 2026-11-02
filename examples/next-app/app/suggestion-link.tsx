"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** A suggestion link that reports the click as accepted-recovery feedback. */
export function SuggestionLink({ href, from, children }: { href: string; from: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={() => {
        fetch("/api/intelroute", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestedPath: from, destination: href, accepted: true }),
        }).catch(() => {});
      }}
    >
      {children}
    </Link>
  );
}
