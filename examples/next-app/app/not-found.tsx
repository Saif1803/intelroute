import Link from "next/link";
import { getIntelRouteSuggestions } from "@intelroute/next/server";
import { SuggestionLink } from "./suggestion-link";

export default async function NotFound() {
  const { requestedPath, suggestions } = await getIntelRouteSuggestions();

  return (
    <main>
      <h1>Page not found</h1>
      <p className="muted">
        {requestedPath ? <>We couldn&apos;t find <code>{requestedPath}</code>.</> : "We couldn't find that page."}
      </p>
      {suggestions.length > 0 && (
        <div className="card">
          <h2>Did you mean…</h2>
          <ul className="suggestions">
            {suggestions.map((s) => (
              <li key={s.path}>
                <SuggestionLink href={s.path} from={requestedPath ?? ""}>
                  {s.title ?? s.path}
                </SuggestionLink>
                <span className="muted">
                  {s.path} · {Math.round(s.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
