# Security policy

## Supported versions

This project is a client-side web app. Security fixes are applied on the
`main` branch only.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| Older commits / forks | ❌ |

## What this app does (and does not)

- Runs **entirely in the browser** after you open the local or hosted build.
- Does **not** upload rings, text, or STLs to a backend by default.
- Does **not** require an API key for core design/export.

If you add hosting, analytics, or CI secrets in a fork, treat those as
sensitive and never commit them.

## Reporting a vulnerability

Please **do not** open a public issue for security problems that could put
users at risk.

1. Prefer [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories)
   on this repository, or
2. Open a private report via the repo Security tab, or email the maintainer listed
   on https://github.com/mcflyhq (profile contact).

Include:

- Description of the issue
- Steps to reproduce
- Impact assessment (e.g. XSS, dependency CVE, supply-chain)
- Any suggested fix

We will acknowledge reports as soon as practical and coordinate disclosure.

## Dependency vulnerabilities

```bash
npm audit
```

Please open a normal issue or PR for dependency bumps that fix known CVEs.
