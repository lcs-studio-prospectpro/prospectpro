const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { ADAPTERS, PROVIDERS, COMING_SOON } = require('../lib/crm');
const { syncTenant } = require('../lib/crm/sync');
const { crmSyncAllowed } = require('../lib/plans');

const router = express.Router();
router.use(requireAuth);

// GET /api/crm/providers — list of connectable CRMs + their connect-form fields, plus roadmap items
router.get('/providers', (req, res) => {
  res.json({ providers: PROVIDERS, comingSoon: COMING_SOON });
});

// GET /api/crm/connection — current tenant's connection status (never returns raw credentials)
router.get('/connection', async (req, res) => {
  const conn = await prisma.crmConnection.findUnique({ where: { tenantId: req.user.tenantId } });
  if (!conn) return res.json({ connected: false });
  res.json({
    connected: true,
    provider: conn.provider,
    label: conn.label,
    status: conn.status,
    lastError: conn.lastError,
    lastSyncAt: conn.lastSyncAt,
  });
});

// POST /api/crm/connect  { provider, credentials }
router.post('/connect', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  if (!crmSyncAllowed(tenant.plan)) {
    return res.status(403).json({ error: 'CRM sync is available on the Small Business plan and above. Upgrade to connect a CRM.' });
  }
  const { provider, credentials } = req.body;
  const adapter = ADAPTERS[provider];
  if (!adapter) return res.status(400).json({ error: 'Unsupported CRM provider' });
  const test = await adapter.testConnection(credentials || {});
  if (!test.ok) return res.status(400).json({ error: test.error || 'Could not connect with those credentials.' });

  const conn = await prisma.crmConnection.upsert({
    where: { tenantId: req.user.tenantId },
    update: { provider, label: adapter.name, credentials: JSON.stringify(credentials), status: 'connected', lastError: null },
    create: { tenantId: req.user.tenantId, provider, label: adapter.name, credentials: JSON.stringify(credentials), status: 'connected' },
  });
  res.json({ connected: true, provider: conn.provider, label: conn.label, status: conn.status });
});

// POST /api/crm/disconnect
router.post('/disconnect', async (req, res) => {
  await prisma.crmConnection.deleteMany({ where: { tenantId: req.user.tenantId } });
  res.json({ connected: false });
});

// POST /api/crm/sync — run an on-demand sync now
router.post('/sync', async (req, res) => {
  const conn = await prisma.crmConnection.findUnique({ where: { tenantId: req.user.tenantId } });
  if (!conn) return res.status(404).json({ error: 'No CRM connected for this account.' });
  const result = await syncTenant(req.user.tenantId);
  if (!result.ok) return res.status(502).json(result);
  res.json(result);
});

module.exports = router;
