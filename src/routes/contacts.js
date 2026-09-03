const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/contacts?verticalId=&tier=&search= — always scoped to req.user.tenantId
router.get('/', async (req, res) => {
  const { verticalId, tier, search } = req.query;
  const where = {
    tenantId: req.user.tenantId, // tenant isolation enforced server-side, never trust client-supplied tenant
    ...(verticalId ? { verticalId } : {}),
    ...(tier ? { tier } : {}),
    ...(search ? { name: { contains: search } } : {}),
  };
  const contacts = await prisma.contact.findMany({ where, include: { vertical: true }, orderBy: { createdAt: 'desc' } });
  res.json(contacts);
});

async function nextCategoryId(tenantId, vertical) {
  const contacts = await prisma.contact.findMany({ where: { tenantId, verticalId: vertical.id } });
  const currentBatch = Math.max(1, ...contacts.map(c => c.batchNumber), 1);
  const inBatch = contacts.filter(c => c.batchNumber === currentBatch);
  const confirmed = inBatch.filter(c => c.dataConfirmed).length;
  const pct = inBatch.length ? confirmed / inBatch.length : 1;
  const locked = inBatch.length >= vertical.batchSize && pct < vertical.confirmThreshold;
  if (locked) return { locked: true, pct, neededToUnlock: Math.ceil(vertical.confirmThreshold * inBatch.length) - confirmed };
  const batchNumber = inBatch.length >= vertical.batchSize ? currentBatch + 1 : currentBatch;
  return { locked: false, batchNumber, categoryId: `${vertical.categoryCode}-B${batchNumber}` };
}

// POST /api/contacts — create, enforcing the per-vertical batch/confirm gate
router.post('/', async (req, res) => {
  const { verticalId, name, address, phone, email, website, contactName, contactTitle, tier } = req.body;
  const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, tenantId: req.user.tenantId } });
  if (!vertical) return res.status(404).json({ error: 'Vertical not found for this account' });

  const gate = await nextCategoryId(req.user.tenantId, vertical);
  if (gate.locked) {
    return res.status(423).json({
      error: `Category locked: "${vertical.label}" batch is full and only ${Math.round(gate.pct * 100)}% confirmed (${Math.round(vertical.confirmThreshold*100)}% required). Confirm ${gate.neededToUnlock} more before adding new contacts.`,
    });
  }

  const contact = await prisma.contact.create({
    data: {
      tenantId: req.user.tenantId, verticalId, name, address, phone, email, website,
      contactName, contactTitle, tier: tier || 'B',
      categoryId: gate.categoryId, batchNumber: gate.batchNumber,
    },
  });
  res.status(201).json(contact);
});

// A single paste/import request is capped regardless of plan — this is a server/DB safety limit,
// not a monetization lever (the per-vertical batch/confirm gate below already governs how fast a
// tenant can grow their contact list; this just stops one request from being enormous).
const MAX_IMPORT_ROWS_PER_REQUEST = 500;

// POST /api/contacts/import — bulk CSV import into a vertical, respecting the same batch/confirm gate
// Body: { verticalId, rows: [{ name, contactName, contactTitle, address, phone, email, website, tier }, ...] }
router.post('/import', async (req, res) => {
  const { verticalId, rows } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows[] is required' });
  if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) {
    return res.status(400).json({ error: `Import is limited to ${MAX_IMPORT_ROWS_PER_REQUEST} rows per paste. Split your CSV into smaller batches and import again.` });
  }

  const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, tenantId: req.user.tenantId } });
  if (!vertical) return res.status(404).json({ error: 'Vertical not found for this account' });

  const created = [];
  const skipped = [];
  for (const row of rows) {
    if (!row.name || !row.name.trim()) { skipped.push({ row, reason: 'Missing company name' }); continue; }
    const gate = await nextCategoryId(req.user.tenantId, vertical);
    if (gate.locked) {
      skipped.push({ row, reason: `Batch locked — confirm ${gate.neededToUnlock} more existing contacts in "${vertical.label}" before importing more` });
      continue; // keep going in case remaining rows target a different situation is not possible here, but report accurately per-row
    }
    const contact = await prisma.contact.create({
      data: {
        tenantId: req.user.tenantId, verticalId,
        name: row.name.trim(), address: row.address || null, phone: row.phone || null, email: row.email || null,
        website: row.website || null, contactName: row.contactName || null, contactTitle: row.contactTitle || null,
        tier: row.tier || 'B', categoryId: gate.categoryId, batchNumber: gate.batchNumber,
      },
    });
    created.push(contact);
  }
  res.status(201).json({ createdCount: created.length, skippedCount: skipped.length, created, skipped });
});

// PATCH /api/contacts/:id — edit / confirm data (mirrors AIT's @company-email VA confirm flow)
router.patch('/:id', async (req, res) => {
  const existing = await prisma.contact.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const fields = { ...req.body };
  if (fields.confirm === true) {
    fields.dataConfirmed = true;
    fields.confirmedById = req.user.userId;
    fields.confirmedAt = new Date();
  }
  delete fields.confirm;

  const contact = await prisma.contact.update({ where: { id: existing.id }, data: fields });
  res.json(contact);
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  const existing = await prisma.contact.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await prisma.contact.delete({ where: { id: existing.id } });
  res.status(204).end();
});

module.exports = router;
