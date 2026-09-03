// Pipedrive adapter — uses a Pipedrive personal API token (Settings > Personal Preferences > API).
// Credentials required: { apiToken, companyDomain } (companyDomain = the "xyz" in xyz.pipedrive.com)
function baseUrl(creds) {
  return `https://${creds.companyDomain}.pipedrive.com/api/v1`;
}

async function request(method, path, creds, body) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${baseUrl(creds)}${path}${sep}api_token=${creds.apiToken}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  return { status: resp.status, data };
}

function toPayload(contact) {
  const payload = {
    name: contact.contactName || contact.name,
    org_name: contact.name,
    email: contact.email ? [contact.email] : undefined,
    phone: contact.phone ? [contact.phone] : undefined,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v));
}

async function testConnection(creds) {
  if (!creds.apiToken || !creds.companyDomain) return { ok: false, error: 'API token and company domain are both required.' };
  const { status, data } = await request('GET', '/persons?limit=1', creds);
  if (status !== 200 || data.success === false) return { ok: false, error: data?.error || `Pipedrive rejected the connection (HTTP ${status}).` };
  return { ok: true };
}

async function pushContact(creds, contact) {
  const payload = toPayload(contact);
  if (contact.crmExternalId) {
    const { status, data } = await request('PUT', `/persons/${contact.crmExternalId}`, creds, payload);
    if (status >= 200 && status < 300 && data.success) return { externalId: contact.crmExternalId, ok: true };
    return { ok: false, error: data?.error || `HTTP ${status}` };
  }
  const { status, data } = await request('POST', '/persons', creds, payload);
  if (status >= 200 && status < 300 && data.success && data.data?.id) return { externalId: String(data.data.id), ok: true };
  return { ok: false, error: data?.error || `HTTP ${status}` };
}

async function fetchAll(creds) {
  const out = {};
  let start = 0;
  for (let page = 0; page < 50; page++) {
    const { status, data } = await request('GET', `/persons?limit=100&start=${start}`, creds);
    if (status !== 200 || !data.success) break;
    for (const p of data.data || []) out[String(p.id)] = p;
    if (!data.additional_data?.pagination?.more_items_in_collection) break;
    start = data.additional_data.pagination.next_start;
  }
  return out;
}

function fromExternal(p) {
  return {
    email: p.email?.[0]?.value || undefined,
    phone: p.phone?.[0]?.value || undefined,
    updatedAt: p.update_time,
  };
}

module.exports = {
  key: 'pipedrive',
  name: 'Pipedrive',
  fields: [
    { key: 'companyDomain', label: 'Company Domain (the "xyz" in xyz.pipedrive.com)', type: 'text' },
    { key: 'apiToken', label: 'Personal API Token', type: 'password' },
  ],
  helpUrl: 'https://pipedrive.readme.io/docs/how-to-find-the-api-token',
  testConnection,
  pushContact,
  fetchAll,
  fromExternal,
};
