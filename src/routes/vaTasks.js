const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/va-tasks — shared team task queue (also missing its own table in the original AIT build)
router.get('/', async (req, res) => {
  const { status, assignedToId } = req.query;
  const tasks = await prisma.vaTask.findMany({
    where: {
      tenantId: req.user.tenantId,
      status: status || 'open',
      ...(assignedToId ? { assignedToId } : {}),
    },
    include: { contact: { select: { name: true, tier: true } }, assignedTo: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(tasks);
});

// POST /api/va-tasks — usually auto-created when a contact is missing a field; can also be manual
router.post('/', async (req, res) => {
  const { contactId, missingField, assignedToId } = req.body;
  const task = await prisma.vaTask.create({
    data: { tenantId: req.user.tenantId, contactId, missingField, assignedToId },
  });
  res.status(201).json(task);
});

// PATCH /api/va-tasks/:id/complete
router.patch('/:id/complete', async (req, res) => {
  const existing = await prisma.vaTask.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const task = await prisma.vaTask.update({
    where: { id: existing.id }, data: { status: 'complete', completedAt: new Date() },
  });
  res.json(task);
});

module.exports = router;
