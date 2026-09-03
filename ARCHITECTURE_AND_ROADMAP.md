# ProspectPro — Turning the AIT Prospect Scheduler into a Sellable SaaS App

**Status: working backend prototype built and tested this session.** This document is both the architecture plan and the current state of the build.

---

## 1. What's actually built right now (in this folder)

A real, running, multi-tenant backend — not just a plan:

- **Database**: Prisma schema (`prisma/schema.prisma`) modeling Tenants (companies), Users (with roles), Verticals (fully custom per tenant), Contacts, Call Logs, and VA Tasks. Dev runs on SQLite (zero setup); production points the same schema at Postgres by changing one env var.
- **Auth**: Signup creates a brand-new tenant + owner account with a 14-day trial. Login issues a JWT. Owners/admins can invite teammates with a role (admin/rep/va).
- **Custom verticals**: Any company can define its own categories (not AIT's hardcoded 12) — label, short tag code, batch size, and confirm-threshold are all editable per vertical. Tested live: created "Municipal Lighting Boards" with `MUNI` tag and a batch size of 3.
- **Generalized batch-lock rule**: AIT's "50 per batch, 80% confirmed to unlock the next 50" now works for *any* vertical, with *any* batch size, per tenant. Verified: filled a 3-contact batch, confirmed it was correctly locked at 0% confirmed, confirmed all 3, and watched batch 2 unlock automatically with the right `MUNI-B2` category tag.
- **Tenant data isolation**: every query is scoped server-side by the JWT's `tenantId` — a second company (tested with a fake "FlowTech Plumbing Reps" account) sees zero of the first company's contacts. This is the core guarantee a paid multi-tenant product must have.
- **Call Log and VA Task Queue now have real database tables** — this closes AIT's biggest data-quality gap (the original tool's Call Logger and VA Task Queue only saved to local browser storage). Tested: logged a call and completed a VA task, both persisted server-side and visible to the whole team.
- **Stripe billing scaffold**: checkout-session creation, webhook handling for subscription activated/canceled/payment-failed, and a `/billing/status` endpoint for trial countdown. Structurally complete — it errors today only because the `.env` has placeholder Stripe keys, which is expected until you create a real Stripe account.

Run it yourself:
```bash
cd prospect-scheduler-saas
npm install
npx prisma db push   # creates dev.db
node src/server.js   # starts on :4000
bash test_e2e.sh     # re-runs the full proof-of-concept above
```

---

## 2. Why this architecture (and what it replaces)

The original `Prospect_Scheduler_v7_6.html` is a single static file with data in the browser's `localStorage`, later bolted onto a shared Airtable base. That was the right call for one company's internal tool, but it can't be sold as a product because:
- There's no concept of "a customer" — no signup, no login, no billing, no per-company data wall.
- Airtable's free tier and per-base API limits don't scale to many paying customers.
- Verticals, category codes, and the batch rule are hardcoded in the HTML/JS — every new customer would need their own hand-edited copy of the file.

The new architecture fixes all four with standard, well-understood SaaS patterns:

| Concern | AIT internal tool | ProspectPro (this build) |
|---|---|---|
| Data store | Airtable base (1 shared base) | Postgres in production, one schema, tenant-scoped rows |
| Customers | N/A (internal only) | `Tenant` table — one row per paying company |
| Login | None (open file) | Email/password + JWT, ready for OAuth later |
| Verticals | Hardcoded 12 in JS | Fully customer-defined, unlimited, per tenant |
| Batch rule | Hardcoded 50/80% in JS | Configurable per vertical, per tenant |
| Billing | N/A | Stripe subscriptions, trial period, webhook-driven status |
| Roles | None (VA ID from email only) | owner / admin / rep / va with permission checks |

---

## 3. Path to a real, deployable product

This session built the **API and data layer**. To go live, in order:

1. **Frontend**: Build a proper web app UI (React or keep it a well-organized vanilla JS SPA like the original) that calls this API instead of writing to `localStorage`/Airtable directly. The existing HTML file's UI/UX (contact cards, map view, filters) can be largely reused visually — swap its data layer for `fetch()` calls to `/api/*`.
2. **Hosting**: Deploy the API to Render, Railway, or Fly.io (all have free/cheap tiers with managed Postgres). Point `DATABASE_URL` at their Postgres instance and run `npx prisma db push` once.
3. **Stripe**: Create a real Stripe account, add two Products/Prices (Starter, Pro), and drop the real keys into `.env`. The checkout/webhook code needs no changes.
4. **Domain + SSL**: Point a domain at the hosting provider (they handle SSL automatically).
5. **Email**: Add a transactional email service (Resend, Postmark, or SendGrid free tier) for signup confirmation, invite emails, and trial-ending reminders — not built yet, small addition.
6. **Google Maps billing**: Each tenant should either bring their own Google Maps API key (simplest, avoids you paying for their usage) or you meter usage centrally and pass the cost into the Pro plan price.

None of this requires re-architecting — it's additive to what's built.

---

## 4. Feature roadmap — valuable to ANY regional sales rep, any vertical

Organized by how directly it ties to what's already built vs. net-new:

### Tier 1 — Natural extensions of what exists (low effort, high value)
- **Per-vertical email/call scripts library** — since verticals are now custom, let each tenant attach a script template to each vertical (like AIT's VA call scripts, generalized).
- **Team leaderboard** — calls logged, contacts confirmed, and tasks completed per rep per week, using the Call Log and VA Task tables already built.
- **CSV import** — let a new customer bulk-upload their existing contact list into a vertical on day one instead of typing them in one at a time.
- **Multi-CRM sync** — the AIT build proved out Outlook + GoHighLevel sync patterns; genericize those into a "connect your CRM" settings panel supporting HubSpot, Salesforce, Pipedrive, and GoHighLevel, so any rep's existing CRM stays in sync.

### Tier 2 — Differentiators regional reps would pay extra for
- **Territory heat-mapping** — color-code a map by contact density, tier mix, or days-since-last-contact per territory, so a rep instantly sees under-served areas.
- **Commission/quota tracking** — since reps are commission-driven, let them log a deal value against a contact and see progress toward a monthly/quarterly quota.
- **Multi-rep territory assignment & conflict prevention** — flag when two reps in the same tenant have the same company in their pipeline (a common real pain point in manufacturer's rep firms with overlapping territories).
- **Smart reconfirmation reminders** — AIT already flags contacts unconfirmed 12+ months; extend this into a weekly digest email per rep ("these 8 contacts need a fresh confirm").
- **Sample/literature request tracking** — for reps who leave product samples or spec sheets, track what was left where and follow up automatically after N days.

### Tier 3 — Bigger bets, worth prototyping once there's paying demand
- **AI email/call-prep assistant** — given a contact's vertical, tier, and notes, draft a personalized outreach email or call talking points (the AIT build had a placeholder for this — an actual LLM call is a natural v2 feature, and the Anthropic key already in the AIT credentials doc could power a first version).
- **Marketplace of vertical templates** — since a new tenant currently starts with one blank "General Prospects" vertical, offer pre-built starter packs (e.g., "Lighting Reps," "Plumbing Distributors," "AV Integrators," "Interior Design") with sensible category codes and starter scripts, so a new customer is productive in minutes.
- **Mobile app wrapper** — the current UI is already mobile-responsive HTML; wrapping it as a lightweight PWA (installable, works offline, push notifications for nearby Tier A contacts) captures the "in-the-field" use case better than a browser tab.
- **Usage-based add-ons** — metered Hunter/Clearbit/Abstract enrichment credits sold as an add-on once volume exceeds the free tiers documented in AIT's Enrichment Pipeline Guide.

### Suggested initial pricing (to validate, not final)
| Plan | Price | Seats | Notes |
|---|---|---|---|
| Trial | Free, 14 days | 3 | Full features, no card required |
| Starter | $29/mo | 3 | 1 territory, core features |
| Pro | $99/mo | 15 | Unlimited territories, CRM sync, leaderboard |
| Team/Enterprise | Custom | Unlimited | SSO, dedicated support, custom verticals marketplace |

---

## 5. What I'd do next, in order

1. Build the frontend against this API (reusing the existing HTML's visual design).
2. Stand up a free-tier Postgres + hosting deployment so there's a real URL to demo/test with real users.
3. Get real Stripe test-mode keys wired in and run a full signup → trial → paid-upgrade flow end-to-end.
4. Pick 2–3 Tier 1 features above and ship them, since they reuse tables already built (Call Log, VA Task Queue).
5. Recruit a few non-AIT beta users (different verticals) specifically to pressure-test the "fully custom verticals" promise — that's the core thing differentiating this from being "just AIT's tool."
