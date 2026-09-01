# What this repository is

This is the **unmodified output** of [Naratake](https://naratake.com)'s code
export, run against the bakery starting point on 2026-09-01.

- The first commit in this repository is the export exactly as produced.
  Diff any later commit against it to see what was added (only notes like
  this file).
- The only things missing are the ones the export's own `.gitignore`
  excludes: `node_modules/`, a generated local-dev `.env` (random JWT
  secret and first-login password — copy `.env.example` and fill your own),
  the SQLite dev database, and uploaded media.
- What you are looking at is what a Storefront Pro customer downloads, and
  what the desktop app (LocalSite Studio) exports without limits: a Next.js
  storefront, an admin back office, a REST API and a database schema.

Setup instructions are in the export's own [README](./README.md).
The claims this repo exists to back up are written down, dated, at
[naratake.com/en/own-your-code](https://naratake.com/en/own-your-code).
