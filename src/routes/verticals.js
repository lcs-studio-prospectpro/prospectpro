const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { effectiveTerritoryLimit, radiusLimit } = require('../lib/plans');
const { estimatedCountyRadiusMiles } = require('../lib/countySize');

const router = express.Router();
router.use(requireAuth);

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Reject a search radius that exceeds the tenant's plan cap.
function checkRadiusAllowed(tenant, radiusMiles) {
  if (radiusMiles == null) return null;
  const max = radiusLimit(tenant.plan);
  if (radiusMiles > max) {
    return `Your ${tenant.plan} plan allows up to a ${max}-mile search radius. Choose a smaller radius or upgrade your plan for wider coverage.`;
  }
  return null;
}

// Also bound "search by county" territories against the same per-plan cap — otherwise a
// Basic-tier account could pick a huge county (e.g. San Bernardino County, CA, an ~80-mile
// equivalent radius) and get more coverage than an Enterprise zip+radius search. We estimate a
// county's footprint as the radius of a circle with the same land area (US Census data). If the
// county name doesn't match our dataset we fail open (don't block) rather than guess wrong.
function checkCountySizeAllowed(tenant, targetState, targetCounty) {
  if (!targetCounty) return null;
  const estRadius = estimatedCountyRadiusMiles(targetState, targetCounty);
  if (estRadius == null) return null;
  const max = radiusLimit(tenant.plan);
  if (estRadius > max) {
    return `${targetCounty} spans roughly a ${Math.round(estRadius)}-mile radius, which is larger than your ${tenant.plan} plan's ${max}-mile coverage limit. Search by zip + a smaller radius instead, or upgrade your plan for county-wide coverage.`;
  }
  return null;
}

// Batch size ("load N contacts, confirm 80% before the next N") is a data-quality control, not
// a plan-tier lever — but it must stay bounded or the confirm-gate is meaningless (e.g. someone
// setting it to 100,000 effectively removes the quality check entirely). Same min/max apply to
// every tier. Confirm threshold is bounded too so the gate can't be set to 0% (no-op) or >100%.
const MIN_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 200;
const MIN_CONFIRM_THRESHOLD = 0.5;
const MAX_CONFIRM_THRESHOLD = 1.0;

function checkBatchConfigAllowed(batchSize, confirmThreshold) {
  if (batchSize != null) {
    const n = Number(batchSize);
    if (!Number.isFinite(n) || n < MIN_BATCH_SIZE || n > MAX_BATCH_SIZE) {
      return `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE} (keeps the confirm-before-next-batch rule meaningful).`;
    }
  }
  if (confirmThreshold != null) {
    const n = Number(confirmThreshold);
    if (!Number.isFinite(n) || n < MIN_CONFIRM_THRESHOLD || n > MAX_CONFIRM_THRESHOLD) {
      return `Confirm threshold must be between ${Math.round(MIN_CONFIRM_THRESHOLD * 100)}% and ${Math.round(MAX_CONFIRM_THRESHOLD * 100)}%.`;
    }
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
  const radiusError = checkRadiusAllowed(tenant, radiusMiles) || checkCountySizeAllowed(tenant, targetState, targetCounty);
  if (radiusError) return res.status(403).json({ error: radiusError });
  const batchError = checkBatchConfigAllowed(batchSize, confirmThreshold);
  if (batchError) return res.status(400).json({ error: batchError });

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

  if (radiusMiles != null || targetCounty != null) {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
    const effState = targetState !== undefined ? targetState : existing.targetState;
    const effCounty = targetCounty !== undefined ? targetCounty : existing.targetCounty;
    const radiusError = checkRadiusAllowed(tenant, radiusMiles) || checkCountySizeAllowed(tenant, effState, effCounty);
    if (radiusError) return res.status(403).json({ error: radiusError });
  }
  const batchError = checkBatchConfigAllowed(batchSize, confirmThreshold);
  if (batchError) return res.status(400).json({ error: batchError });

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
