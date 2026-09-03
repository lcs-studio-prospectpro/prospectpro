const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { effectiveTerritoryLimit, radiusLimit } = require('../lib/plans');

const router = express.Router();
router.use(requireAuth);

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Reject a search radius that exceeds the tenant's plan cap. County-based territories (no
// radiusMiles / zip search involved) are unaffected — this only bounds zip+radius searches.
function checkRadiusAllowed(tenant, radiusMiles) {
  if (radiusMiles == null) return null;
  const max = radiusLimit(tenant.plan);
  if (radiusMiles > max) {
    return `Your ${tenant.plan} plan allows up to a ${max}-mile search radius. Choose a smaller radius or upgrade your plan for wider coverage.`;
  }
  return null;
}

// GET /api/verticals — list this tenant's verticals (any custom field the sales team sells into)
router.get('/', async (req, res) => {
  const verticals = await prisma.vertical.findMany({
    where: { tenantId: req.user.tenantId, archived: false },
    include: { _count: { select: { contacts: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(verticals);
});

// POST /api/verticals — add a brand-new vertical/category (e.g. a rep expanding into a new field)
router.post('/', requireRole('admin'), async (req, res) => {
  const { label, categoryCode, batchSize, confirmThreshold, color, callScript, emailScript, targetState, targetCity, targetCounty, targetZip, radiusMiles, targetLat, targetLng } = req.body;
  if (!label || !categoryCode) return res.status(400).json({ error: 'label and categoryCode are required' });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  const limit = effectiveTerritoryLimit(tenant);
  if (limit !== null) {
    const count = await prisma.vertical.count({ where: { tenantId: req.user.tenantId } });
    if (count >= limit) {
      return res.status(403).json({ error: `Your plan includes ${limit} territor${limit === 1 ? 'y' : 'ies'}. Upgrade to add more.` });
    }
  }
  const radiusError = checkRadiusAllowed(tenant, radiusMiles);
  if (radiusError) return res.status(403).json({ error: radiusError });

  const key = slugify(label);
  try {
    const vertical = await prisma.vertical.create({
      data: {
        tenantId: req.user.tenantId,
        key,
        label,
        categoryCode: categoryCode.toUpperCase(),
        batchSize: batchSize || 50,
        confirmThreshold: confirmThreshold || 0.8,
        color: color || '#1B3A5C',
        callScript: callScript || null,
        emailScript: emailScript || null,
        targetState: targetState || null,
        targetCity: targetCity || null,
        targetCounty: targetCounty || null,
        targetZip: targetZip || null,
        radiusMiles: radiusMiles || 25,
        targetLat: targetLat || null,
        targetLng: targetLng || null,
      },
    });
    res.status(201).json(vertical);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'A vertical with that name already exists for your account' });
    throw e;
  }
});

// PATCH /api/verticals/:id — edit label/batch rules
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const existing = await prisma.vertical.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { label, batchSize, confirmThreshold, color, archived, callScript, emailScript, targetState, targetCity, targetCounty, targetZip, radiusMiles, targetLat, targetLng } = req.body;

  if (radiusMiles != null) {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
    const radiusError = checkRadiusAllowed(tenant, radiusMiles);
    if (radiusError) return res.status(403).json({ error: radiusError });
  }

  const vertical = await prisma.vertical.update({
    where: { id: existing.id },
    data: { label, batchSize, confirmThreshold, color, archived, callScript, emailScript, targetState, targetCity, targetCounty, targetZip, radiusMiles, targetLat, targetLng },
  });
  res.json(vertical);
});

// GET /api/verticals/:id/batch-status — generalized version of AIT's "50 per batch / 80% confirmed" rule
router.get('/:id/batch-status', async (req, res) => {
  const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!vertical) return res.status(404).json({ error: 'Not found' });

  const contacts = await prisma.contact.findMany({ where: { verticalId: vertical.id } });
  const currentBatch = Math.max(1, ...contacts.map(c => c.batchNumber), 1);
  const inBatch = contacts.filter(c => c.batchNumber === currentBatch);
  const confirmed = inBatch.filter(c => c.dataConfirmed).length;
  const pct = inBatch.length ? confirmed / inBatch.length : 1;
  const locked = inBatch.length >= vertical.batchSize && pct < vertical.confirmThreshold;

  res.json({
    verticalId: vertical.id, label: vertical.label, currentBatch,
    countInBatch: inBatch.length, batchSize: vertical.batchSize,
    confirmedCount: confirmed, pctConfirmed: pct,
    threshold: vertical.confirmThreshold, locked,
    neededToUnlock: locked ? Math.ceil(vertical.confirmThreshold * inBatch.length) - confirmed : 0,
  });
});

module.exports = router;
