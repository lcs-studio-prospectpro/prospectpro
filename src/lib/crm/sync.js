const crypto = require('crypto');
const prisma = require('../prisma');
const { ADAPTERS } = require('./index');

function hashContact(contact) {
  return crypto.createHash('sha1').update(JSON.stringify({
    name: contact.name, contactName: contact.contactName, address: contact.address,
    phone: contact.phone, email: contact.email, website: contact.website,
  })).digest('hex');
}

// Runs a full push+pull sync for one tenant's connected CRM. Returns a summary.
async function syncTenant(tenantId) {
  const conn = await prisma.crmConnection.findUnique({ where: { tenantId } });
  if (!conn) return { ok: false, error: 'No CRM connected' };
  const adapter = ADAPTERS[conn.provider];
  if (!adapter) return { ok: false, error: `Unknown provider: ${conn.provider}` };
  const creds = JSON.parse(conn.credentials);

  const summary = { pushed: 0, pulled: 0, errors: [] };

  try {
    // 1. Push confirmed contacts that are new or locally edited since last sync.
    const confirmed = await prisma.contact.findMany({ where: { tenantId, dataConfirmed: true } });
    for (const contact of confirmed) {
      const hash = hashContact(contact);
      const needsPush = !contact.crmExternalId || contact.crmSyncHash !== hash;
      if (!needsPush) continue;
      const result = await adapter.pushContact(creds, contact);
      if (result.ok) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { crmExternalId: result.externalId, crmSyncedAt: new Date(), crmSyncHash: hash },
        });
        summary.pushed++;
      } else {
        summary.errors.push(`Push failed for ${contact.name}: ${result.error}`);
      }
    }

    // 2. Pull CRM-side edits back for previously-synced contacts.
    const synced = await prisma.contact.findMany({ where: { tenantId, crmExternalId: { not: null } } });
    if (synced.length) {
      const external = await adapter.fetchAll(creds);
      for (const contact of synced) {
        const raw = external[contact.crmExternalId];
        if (!raw) continue;
        const normalized = adapter.fromExternal(raw);
        const extTime = normalized.updatedAt ? new Date(normalized.updatedAt).getTime() : 0;
        const lastSync = contact.crmSyncedAt ? contact.crmSyncedAt.getTime() : 0;
        if (extTime > lastSync) {
          const data = {};
          if (normalized.email) data.email = normalized.email;
          if (normalized.phone) data.phone = normalized.phone;
          if (normalized.address) data.address = normalized.address;
          if (Object.keys(data).length) {
            data.crmSyncedAt = new Date();
            const updated = await prisma.contact.update({ where: { id: contact.id }, data });
            data.crmSyncHash = hashContact(updated);
            await prisma.contact.update({ where: { id: contact.id }, data: { crmSyncHash: data.crmSyncHash } });
            summary.pulled++;
          }
        }
      }
    }

    await prisma.crmConnection.update({
      where: { tenantId },
      data: { status: 'connected', lastError: null, lastSyncAt: new Date() },
    });
    return { ok: true, ...summary };
  } catch (err) {
    await prisma.crmConnection.update({
      where: { tenantId },
      data: { status: 'error', lastError: String(err.message || err) },
    });
    return { ok: false, error: String(err.message || err), ...summary };
  }
}

// Background loop: sync every connected tenant every intervalMs. Errors are isolated per-tenant.
function startScheduledSync(intervalMs = 30 * 60 * 1000) {
  setInterval(async () => {
    try {
      const conns = await prisma.crmConnection.findMany({ select: { tenantId: true } });
      for (const { tenantId } of conns) {
        try {
          await syncTenant(tenantId);
        } catch (err) {
          console.error(`[crm-sync] tenant ${tenantId} failed:`, err.message);
        }
      }
    } catch (err) {
      console.error('[crm-sync] scheduled loop failed:', err.message);
    }
  }, intervalMs);
}

module.exports = { syncTenant, startScheduledSync, hashContact };
