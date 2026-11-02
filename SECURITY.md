# Security policy

IntelRoute runs in front of every request to your site and can send visitors to other URLs, so security bugs matter here.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/Saif1803/intelroute/security) of this repository.
2. Click **Report a vulnerability**.

Include the IntelRoute version, your configuration (routes, redirects, exclusions), the request that triggers the problem, and what happens.

You can expect an acknowledgement within 3 days and a plan within 10 days. Once a fix is released, we'll credit you in the advisory unless you'd rather stay anonymous.

## What counts

Examples of what we'd treat as a vulnerability:

- **Open redirects:** a request that makes IntelRoute redirect to another origin, other than an absolute URL the site owner configured in `redirects`.
- **Header injection:** a visitor controlling the suggestions or decision passed to the not-found page through `x-intelroute-*` headers.
- **Denial of service:** a request that makes matching take far longer than normal or use excessive memory.
- **Bypassed exclusions:** a request to an excluded path (such as `/api/*`) being redirected or changed.
- **Data exposure:** the analytics endpoint returning data without the configured token.

A redirect to the wrong page *on the same site* is a matching bug, not a security issue. Please report those as a normal issue.

## Supported versions

IntelRoute is pre-1.0. Security fixes go into the latest `0.x` release only.
