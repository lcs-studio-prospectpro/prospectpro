const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/reports/leaderboard?days=7 — team activity ranking, tenant-scoped
router.get('/leaderboard', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - days * 86400000);

  const users = await prisma.user.findMany({ where: { tenantId: req.user.tenantId }, select: { id: true, name: true, role: true } });

  const [calls, confirms, tasksDone] = await Promise.all([
    prisma.callLog.groupBy({ by: ['userId'], where: { tenantId: req.user.tenantId, createdAt: { gte: since } }, _count: { id: true } }),
    prisma.contact.groupBy({ by: ['confirmedById'], where: { tenantId: req.user.tenantId, dataConfirmed: true, confirmedAt: { gte: since } }, _count: { id: true } }),
    prisma.vaTask.groupBy({ by: ['assignedToId'], where: { tenantId: req.user.tenantId, status: 'complete', completedAt: { gte: since } }, _count: { id: true } }),
  ]);

  const callMap = Object.fromEntries(calls.map(c => [c.userId, c._count.id]));
  const confirmMap = Object.fromEntries(confirms.filter(c => c.confirmedById).map(c => [c.confirmedById, c._count.id]));
  const taskMap = Object.fromEntries(tasksDone.filter(t => t.assignedToId).map(t => [t.assignedToId, t._count.id]));

  const leaderboard = users.map(u => {
    const callsMade = callMap[u.id] || 0;
    const contactsConfirmed = confirmMap[u.id] || 0;
    const tasksCompleted = taskMap[u.id] || 0;
    return {
      userId: u.id, name: u.name, role: u.role,
      callsMade, contactsConfirmed, tasksCompleted,
      score: callsMade * 2 + contactsConfirmed * 3 + tasksCompleted * 1, // simple weighted activity score
    };
  }).sort((a, b) => b.score - a.score);

  res.json({ days, leaderboard });
});

module.exports = router;
