# ProspectPro — Multi-Tenant SaaS Backend (Prototype)

**Owned by**: Lighting + Controls Solutions LLC (Studio@LCS-Studio.com) — see `OWNERSHIP.md`.

Working backend prototype turning the AIT Prospect Scheduler concept into a sellable,
multi-tenant product. See `ARCHITECTURE_AND_ROADMAP.md` for the full plan, what's built,
and the feature roadmap.

## Quick start
```bash
npm install
npx prisma db push   # creates dev.db (SQLite)
node src/server.js   # starts API on :4000
bash test_e2e.sh     # proves multi-tenancy, custom verticals, batch rule, billing scaffold
```

## Structure
- `prisma/schema.prisma` — data model (Tenant, User, Vertical, Contact, CallLog, VaTask)
- `src/routes/` — auth, verticals, contacts, call-logs, va-tasks, billing
- `src/middleware/auth.js` — JWT auth + role-based access control
- `test_e2e.sh` — end-to-end proof: 2 tenants, custom vertical, batch lock/unlock, isolation check
