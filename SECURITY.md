# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest release (`v0.3.x`) | Yes |
| Older tags | Best-effort |

Cinekive is local-first. Most risk is on **your** machine (paths, Docker, optional VLM providers).

## Reporting a vulnerability

**Do not open a public Issue for security bugs.**

Email **hello@gianlucaimprota.com** with:

- Affected version / commit
- Steps to reproduce
- Impact (data leak, RCE in the API container, path traversal, etc.)

We aim to reply within a few days. Please give us a reasonable window before public disclosure.

## Scope notes

- Mirror / scraper scripts are for **personal licensed access** — please report if a change would encourage redistributing copyrighted archives by default
- Optional OpenAI-compatible VLM providers send frames **off-machine** when you enable them; treat API keys as secrets
- `data/` is never published; never commit `.env` or credentials

## Acknowledgments

Responsible disclosures are credited in release notes if you want a name listed.
