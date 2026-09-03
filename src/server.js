require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const verticalsRoutes = require('./routes/verticals');
const contactsRoutes = require('./routes/contacts');
const callLogsRoutes = require('./routes/callLogs');
const vaTasksRoutes = require('./routes/vaTasks');
const billingRoutes = require('./routes/billing');
const reportsRoutes = require('./routes/reports');
const tenantRoutes = require('./routes/tenant');

const app = express();

// Stripe webhook needs the raw body, so mount it BEFORE express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'prospect-scheduler-saas' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/verticals', verticalsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/call-logs', callLogsRoutes);
app.use('/api/va-tasks', vaTasksRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tenant', tenantRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`ProspectPro API listening on :${PORT}`));
