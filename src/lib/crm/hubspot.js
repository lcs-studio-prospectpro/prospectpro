// HubSpot adapter — uses a HubSpot Private App access token (Settings > Integrations > Private Apps).
// Credentials required: { accessToken }
const HS_API = 'https://api.hubapi.com';

function headers(creds) {
  return { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' };
}

async function request(method, url, creds, body) {
  const resp = await fetch(url, { method, headers: headers(creds), body: body ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  return { status: resp.status, data };
}

function toProperties(contact) {
  const nameParts = (contact.contactName || '').split(' ');
  const props = {
    firstname: nameParts[0] || undefined,
    lastname: nameParts.slice(1).join(' ') || undefined,
    company: contact.name,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    address: contact.address || undefined,
    website: contact.website || undefined,
  };
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v));
}

async function testConnection(creds) {
  if (!creds.accessToken) return { ok: false, error: 'Private App access token is required.' };
  const { status, data } = await request('GET', `${HS_API}/crm/v3/objects/contacts?limit=1`, creds);
  if (status !== 200) return { ok: false, error: data?.message || `HubSpot rejected the connection (HTTP ${status}).` };
  return { ok: true };
}

async function pushContact(creds, contact) {
  const properties = toProperties(contact);
  if (contact.crmExternalId) {
    const { status, data } = await request('PATCH', `${HS_API}/crm/v3/objects/contacts/${contact.crmExternalId}`, creds, { properties });
    if (status >= 200 && status < 300) return { externalId: contact.crmExternalId, ok: true };
    return { ok: false, error: data?.message || `HTTP ${status}` };
  }
  const { status, data } = await request('POST', `${HS_API}/crm/v3/objects/contacts`, creds, { properties });
  if (status >= 200 && status < 300 && data?.id) return { externalId: data.id, ok: true };
  // HubSpot 409s if the email already exists — try to recover the existing contact's ID
  if (status === 409 && data?.message) {
    const match = /Existing ID:\s*(\d+)/.exec(data.message);
    if (match) return { externalId: match[1], ok: true };
  }
  return { ok: false, error: data?.message || `HTTP ${status}` };
}

async function fetchAll(creds) {
  const out = {};
  let after;
  const props = 'email,phone,address,city,state,zip,hs_lastmodifieddate';
  for (let page = 0; page < 50; page++) {
    let url = `${HS_API}/crm/v3/objects/contacts?limit=100&properties=${props}`;
    if (after) url += `&after=${after}`;
    const { status, data } = await request('GET', url, creds);
    if (status !== 200) break;
    for (const c of data.results || []) out[c.id] = c;
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

function fromExternal(c) {
  const p = c.properties || {};
  return {
    email: p.email || undefined,
    phone: p.phone || undefined,
    address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ') || undefined,
    updatedAt: p.hs_lastmodifieddate,
  };
}

module.exports = {
  key: 'hubspot',
  name: 'HubSpot',
  fields: [
    { key: 'accessToken', label: 'Private App Access Token', type: 'password' },
  ],
  helpUrl: 'https://developers.hubspot.com/docs/api/private-apps',
  testConnection,
  pushContact,
  fetchAll,
  fromExternal,
};
