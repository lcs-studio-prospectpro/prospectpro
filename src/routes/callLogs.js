const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/call-logs — a real, durable, shared call log (AIT's gap: this never had its own table)
router.post('/', async (req, res) => {
  const { contactId, outcome, notes, nextAction, followUpAt } = req.body;
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.user.tenantId } });
  if (!contact) return res.status(404).json({ error: 'Contact not found for this account' });

  const log = await prisma.callLog.create({
    data: {
      tenantId: req.user.tenantId, contactId, userId: req.user.userId,
      outcome, notes, nextAction, followUpAt: followUpAt ? new Date(followUpAt) : null,
    },
  });
  res.status(201).json(log);
});

// GET /api/call-logs?contactId= — visible to the whole team, not just the device that logged it
router.get('/', async (req, res) => {
  const { contactId } = req.query;
  const logs = await prisma.callLog.findMany({
    where: { tenantId: req.user.tenantId, ...(contactId ? { contactId } : {}) },
    include: { user: { select: { name: true, vaCode: true } }, contact: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(logs);
});

module.exports = router;
