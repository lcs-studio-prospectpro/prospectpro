// GoHighLevel adapter — uses GHL's free Private Integration API (no OAuth app needed).
// Credentials required: { apiToken, locationId }
const GHL_API = 'https://services.leadconnectorhq.com';

function headers(creds) {
  return {
    Authorization: `Bearer ${creds.apiToken}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };
}

async function request(method, url, creds, body) {
  const resp = await fetch(url, {
    method,
    headers: headers(creds),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  return { status: resp.status, data };
}

function toPayload(contact) {
  const nameParts = (contact.contactName || '').split(' ');
  const payload = {
    firstName: nameParts[0] || undefined,
    lastName: nameParts.slice(1).join(' ') || undefined,
    companyName: contact.name,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    address1: contact.address || undefined,
    website: contact.website || undefined,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v));
}

async function testConnection(creds) {
  if (!creds.apiToken || !creds.locationId) return { ok: false, error: 'API token and Location ID are both required.' };
  const { status, data } = await request('GET', `${GHL_API}/contacts/?locationId=${creds.locationId}&limit=1`, creds);
  if (status !== 200) return { ok: false, error: data?.message || `GoHighLevel rejected the connection (HTTP ${status}).` };
  return { ok: true };
}

async function pushContact(creds, contact) {
  const payload = { ...toPayload(contact), locationId: creds.locationId };
  if (contact.crmExternalId) {
    const { status, data } = await request('PUT', `${GHL_API}/contacts/${contact.crmExternalId}`, creds, payload);
    if (status >= 200 && status < 300) return { externalId: contact.crmExternalId, ok: true };
    return { ok: false, error: data?.message || `HTTP ${status}` };
  }
  const { status, data } = await request('POST', `${GHL_API}/contacts/`, creds, payload);
  const c = data.contact || data;
  if (status >= 200 && status < 300 && c?.id) return { externalId: c.id, ok: true };
  return { ok: false, error: data?.message || `HTTP ${status}` };
}

async function fetchAll(creds) {
  const out = {};
  let startAfter, startAfterId;
  for (let page = 0; page < 50; page++) {
    let url = `${GHL_API}/contacts/?locationId=${creds.locationId}&limit=100`;
    if (startAfter) url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
    const { status, data } = await request('GET', url, creds);
    if (status !== 200) break;
    const batch = data.contacts || [];
    for (const c of batch) out[c.id] = c;
    const meta = data.meta || {};
    if (!meta.nextPage || !batch.length) break;
    startAfter = meta.startAfter;
    startAfterId = meta.startAfterId;
  }
  return out;
}

function fromExternal(c) {
  return {
    email: c.email || undefined,
    phone: c.phone || undefined,
    address: [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(', ') || undefined,
    updatedAt: c.dateUpdated,
  };
}

module.exports = {
  key: 'ghl',
  name: 'GoHighLevel',
  fields: [
    { key: 'apiToken', label: 'Private Integration API Token', type: 'password' },
    { key: 'locationId', label: 'Location ID', type: 'text' },
  ],
  helpUrl: 'https://help.gohighlevel.com/support/solutions/articles/155000003054',
  // Our affiliate referral link — shown to users who don't have a GoHighLevel account yet.
  signupUrl: 'https://www.gohighlevel.com/?fp_ref=steven-3106b6',
  testConnection,
  pushContact,
  fetchAll,
  fromExternal,
};
