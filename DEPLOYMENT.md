# Deploying to Vercel

The frontend and backend live in **separate GitHub repos** and become **two
separate Vercel projects**.

- Frontend: `mspabitra918/rivercash-loans-frontend` (Next.js)
- Backend: `mspabitra918/rivercash-loans-backend` (NestJS serverless)

---

## 1. Backend (this repo)

Runs as a single Vercel serverless function. `nest build` compiles `src/` to
`dist/` (which preserves the decorator metadata NestJS/Sequelize need), and
[`api/index.ts`](api/index.ts) boots that compiled app behind an Express
adapter. All routing/build config lives in [`vercel.json`](vercel.json).

### Steps

1. Vercel → **Add New → Project** → import `rivercash-loans-backend`.
2. Framework Preset: **Other** (settings come from `vercel.json` — leave
   Build Command / Output Directory as auto/inherited).
3. Add **Environment Variables** (Production). At minimum:

   | Variable                                                                    | Value                                       |
   | --------------------------------------------------------------------------- | ------------------------------------------- |
   | `DATABASE_URL`                                                              | Postgres connection string (see note below) |
   | `FRONTEND_URL`                                                              | `https://<your-frontend>.vercel.app`        |
   | `JWT_SECRET`                                                                | strong random secret                        |
   | `JWT_EXPIRES_IN`                                                            | `7d`                                        |
   | `ENCRYPTION_KEY`                                                            | 64 hex chars (32 bytes)                     |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                            | bootstrap admin login                       |
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_CV_BUCKET`         | file storage                                |
   | (optional) `SENDGRID_*`, `TWILIO_*`, `USER_MAIL`, `USER_PASSWORD`, `META_*` | integrations                                |

   See [`.env.example`](.env.example) for the full list.

4. **Deploy.** After it's live, Swagger is at `https://<backend>.vercel.app/api-docs`.

### `DATABASE_URL` in production

Production uses a single `DATABASE_URL` (see
[`config/database.config.ts`](config/database.config.ts)); SSL is enabled
automatically for non-local hosts. The discrete `DB_*` vars are only a local-dev
fallback used when `DATABASE_URL` is unset.

> **Serverless + Postgres:** each cold start opens a connection. Use your
> provider's **connection pooler**, not the direct connection:
>
> - Supabase: use the **Transaction pooler** string (host `...pooler.supabase.com`, port `6543`).
> - Neon: use the **pooled** connection string.

Example:

```
DATABASE_URL=postgresql://user:pass@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
```

### Migrations

Vercel does not run migrations. Run them against production from your machine:

```bash
DATABASE_URL='postgresql://...pooler...:6543/postgres?sslmode=require' \
  npx sequelize-cli db:migrate
```

(`config/config.js` reads `DATABASE_URL` when present.)

---

## 2. Frontend (`rivercash-loans-frontend`)

Zero-config Next.js on Vercel.

1. Vercel → **Add New → Project** → import `rivercash-loans-frontend`.
2. Add **Environment Variables** (Production):

   | Variable                        | Value                               |
   | ------------------------------- | ----------------------------------- |
   | `NEXT_PUBLIC_API_BASE_URL`      | `https://<your-backend>.vercel.app` |
   | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-JKENV3VNNP`                      |

3. **Deploy.**

---

## 3. Wire the two together

After both are deployed, make sure the URLs point at each other, then redeploy
the affected project so the new env values take effect:

- Backend `FRONTEND_URL` → the frontend's URL (fixes CORS).
- Frontend `NEXT_PUBLIC_API_BASE_URL` → the backend's URL.
