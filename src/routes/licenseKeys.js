const crypto = require('crypto');
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { usesRegistrationKeys } = require('../lib/plans');

const router = express.Router();

function generateCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PP-ENT-${part()}-${part()}`;
}

// GET /api/license-keys — list this tenant's registration keys (Enterprise Key plan only)
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  if (!usesRegistrationKeys(tenant.plan)) {
    return res.status(400).json({ error: 'Registration keys are only available on the Enterprise Key plan.' });
  }
  const keys = await prisma.licenseKey.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(keys);
});

// POST /api/license-keys/generate — owner/admin generates N new unassigned keys
router.post('/generate', requireAuth, requireRole('admin'), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  if (!usesRegistrationKeys(tenant.plan)) {
    return res.status(400).json({ error: 'Registration keys are only available on the Enterprise Key plan.' });
  }
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 1, 1), 100);
  const { assignedEmail } = req.body; // optional, only meaningful when count === 1

  const codes = Array.from({ length: count }, () => ({
    tenantId: tenant.id,
    code: generateCode(),
    assignedEmail: count === 1 ? (assignedEmail || null) : null,
  }));
  await prisma.licenseKey.createMany({ data: codes });
  const created = await prisma.licenseKey.findMany({
    where: { tenantId: tenant.id, code: { in: codes.map((c) => c.code) } },
  });
  res.status(201).json(created);
});

// POST /api/license-keys/:id/revoke — owner/admin revokes an unredeemed or redeemed key
router.post('/:id/revoke', requireAuth, requireRole('admin'), async (req, res) => {
  const key = await prisma.licenseKey.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!key) return res.status(404).json({ error: 'Key not found' });
  const updated = await prisma.licenseKey.update({ where: { id: key.id }, data: { status: 'revoked' } });
  res.json(updated);
});

module.exports = router;
