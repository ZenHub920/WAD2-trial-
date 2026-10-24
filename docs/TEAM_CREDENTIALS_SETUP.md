# Running the integrations as a team

GitHub distributes the application code and the blank `server/.env.example`. Each backend separately loads private settings from `server/.env`. Git deliberately does not distribute that file. Ignoring a file prevents accidental new commits; it does not encrypt the file or hide it from someone who can access your computer.

## Choose one development arrangement

| Arrangement | Who has provider credentials? | Suitable for |
| --- | --- | --- |
| Each teammate runs Vue + Express locally | Each teammate has their own credentials, or explicitly authorised shared **development** credentials | Independent coding and offline backend development |
| Teammates use one shared development backend | Only the people managing that server need its provider credentials | Testing live integrations without distributing keys to every developer |

With either arrangement, the frontend receives authorised application results. It does not receive the OneMap password/token, LTA Account Key or VAPID private key. Someone who runs a local backend with a credential can read that credential; an `.env` file cannot prevent that. Use a shared backend if teammates should have application access without credential access.

## Option A: a backend on each computer

1. Clone/pull the code and install dependencies in `server` and `client` with `npm.cmd install`.
2. From `server`, create the private file **only if it does not already exist**:

   ```powershell
   if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
   ```

3. Set `APP_ORIGIN=http://localhost:5173`. Keep private credentials in this backend file; never put them in `client/.env` or `VITE_` variables.
4. Prefer each teammate's own OneMap account and LTA DataMall key, subject to provider conditions. If an authorised shared development account/key is necessary, place it in an existing restricted team password-manager vault, grant access to named people, and keep it separate from production. Do not send `.env` files through repository files, issues, group chats or screenshots. No paid vault subscription is required or provisioned by this project.
5. For local push, each teammate can generate a **different free VAPID pair**. Set `VAPID_SUBJECT=mailto:their-contact@example.com` first, leave both key fields blank, then run:

   ```powershell
   npm.cmd run push:keys
   ```

   The command preserves existing settings and refuses existing or partial key pairs. It does not print the keys. A shared deployed backend instead keeps one stable pair for its own subscriptions; do not regenerate it on each restart.
6. Configure the necessary fields:

   | Feature | Backend configuration |
   | --- | --- |
   | Browser push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
   | OneMap | `ONEMAP_EMAIL` + `ONEMAP_PASSWORD`, optionally an existing `ONEMAP_TOKEN`; token-only setup needs a replacement after expiry |
   | LTA REST APIs | `LTA_ACCOUNT_KEY`; the supplied SDK key is not used by these REST integrations |
   | Concert imports | Optional `TICKETMASTER_API_KEY` |
   | NEA weather | Public access, optionally `DATA_GOV_SG_API_KEY` |
   | Password/reset verification emails | Optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |

7. Run `npm.cmd run dev` in each of `server` and `client`, in separate terminals. Visit `http://localhost:5173`. The Vite proxy forwards `/api` to Express, keeping the browser on one origin.
8. In Profile → Notifications, enable browser notifications and accept Edge's prompt. Test a real app event from another test account. Each developer must grant permission on their own browser/device.
9. Before proposing a commit, check `git check-ignore server/.env` from the repository root and inspect `git status --short`. Restart the backend after changing its configuration. `git pull` will update the blank example and code without distributing or replacing an ignored local file.

If the network uses an institution/corporate TLS proxy and Node reports a certificate-chain error, use a supported modern Node runtime and opt in locally with `ENCORE_USE_SYSTEM_CA=true`. This adds roots already trusted by the OS; it does not disable TLS verification. Leave it unset when unnecessary. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable npm certificate verification as a workaround.

## Option B: one shared development backend

Use existing infrastructure only if someone can manage it securely. Configure its credentials in the host's server-side environment/secret settings. Give teammates application accounts, without giving them server administration or secret-store access unless needed. The simplest arrangement is for everyone to visit the shared HTTPS development website, with its frontend and API on that same origin.

Prefer one HTTPS origin that serves the frontend and proxies `/api` to Express. If a different development frontend origin must call Express directly, add its **exact** origin to `CORS_ALLOWED_ORIGINS`; never use a wildcard. The current browser client uses same-origin credentials and a same-origin API proxy. Separate-site cookie deployments need deliberate frontend credentials/cookie changes and browser compatibility testing; adding a CORS origin alone does not solve those issues.

Use `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, a correctly scoped `TRUST_PROXY`, persistent SQLite/upload storage and backups. A sleeping server cannot reliably run scheduled notifications. Do not expose local development servers through an unauthenticated tunnel or deploy with production keys simply to make setup easier. No shared server was provisioned by this task.

## Access lifecycle

- Maintain separate development and production credentials. Restrict production access to deployment administrators.
- Grant vault access individually, preferably with MFA; remove access when someone leaves the team. Revoking vault access does not erase copies already downloaded, so replace shared credentials when necessary.
- GitHub Actions/deployment secrets are for injecting configuration into controlled workflows. They are not a local credential distribution mechanism. Review workflow permissions and changes before giving a workflow access to secrets.
- Credentials pasted in chat should be treated as exposed. The owner should replace/revoke them through provider controls before wider use; the code does not rotate passwords, provider keys or VAPID pairs automatically.
- Never include real secrets in tests, browser bundles, logs, reports or documentation. Automated tests use dummy credentials. A secret-detection scan is useful, but cannot prove every possible exposure has been found.

References: [OWASP secrets management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [OneMap authentication](https://www.onemap.gov.sg/apidocs/authentication), [LTA DataMall](https://datamall.lta.gov.sg/).
