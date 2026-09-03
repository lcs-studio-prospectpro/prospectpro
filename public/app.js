const API = '/api';
let state = {
  token: localStorage.getItem('pp_token') || null,
  user: JSON.parse(localStorage.getItem('pp_user') || 'null'),
  tenant: JSON.parse(localStorage.getItem('pp_tenant') || 'null'),
  verticals: [],
  selectedVerticalId: null,
  contacts: [],
  tasks: [],
  currentView: 'search',
};

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const RADIUS_OPTIONS = [5, 10, 15, 20, 25, 50, 75, 100, 150, 200, 300, 500];
const MAX_IMPORT_ROWS = 500; // mirrors server-side cap in src/routes/contacts.js

// ── API helper ──
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Auth ──
function showSignup() { document.getElementById('loginForm').classList.add('hidden'); document.getElementById('signupForm').classList.remove('hidden'); clearAuthError(); }
function showLogin() { document.getElementById('signupForm').classList.add('hidden'); document.getElementById('loginForm').classList.remove('hidden'); clearAuthError(); }
function clearAuthError() { document.getElementById('authError').classList.add('hidden'); }
function authError(msg) { const el = document.getElementById('authError'); el.textContent = msg; el.classList.remove('hidden'); }

async function signup() {
  clearAuthError();
  const companyName = document.getElementById('su_company').value.trim();
  const name = document.getElementById('su_name').value.trim();
  const email = document.getElementById('su_email').value.trim();
  const password = document.getElementById('su_password').value;
  const agreed = document.getElementById('su_agree').checked;
  if (!companyName || !name || !email || !password) return authError('All fields are required.');
  if (!agreed) return authError('Please agree to the Terms of Service and Privacy Policy to continue.');
  try {
    const data = await api('/auth/signup', { method: 'POST', body: { companyName, name, email, password } });
    onAuthed(data);
  } catch (e) { authError(e.message); }
}

async function login() {
  clearAuthError();
  const email = document.getElementById('li_email').value.trim();
  const password = document.getElementById('li_password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    onAuthed(data);
  } catch (e) { authError(e.message); }
}

function onAuthed(data) {
  state.token = data.token; state.user = data.user; state.tenant = data.tenant;
  localStorage.setItem('pp_token', data.token);
  localStorage.setItem('pp_user', JSON.stringify(data.user));
  localStorage.setItem('pp_tenant', JSON.stringify(data.tenant));
  boot();
}

function logout() {
  localStorage.removeItem('pp_token'); localStorage.removeItem('pp_user'); localStorage.removeItem('pp_tenant');
  location.reload();
}

// ── Boot ──
async function boot() {
  if (!state.token) return;
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('tenantName').textContent = state.tenant.name;
  document.getElementById('userName').textContent = state.user.name;
  document.getElementById('userRole').textContent = state.user.role;

  await loadVerticals();
  await loadBillingStatus();
  switchView('search');
}

async function loadBillingStatus() {
  try {
    const status = await api('/billing/status');
    state.billingStatus = status;
    if (status.subscriptionStatus === 'trialing') {
      const pill = document.getElementById('trialPill');
      pill.textContent = `Trial · ${status.trialDaysLeft}d left`;
      pill.classList.remove('hidden');
    }
  } catch (e) {}
}

async function loadVerticals() {
  state.verticals = await api('/verticals');
  if (!state.selectedVerticalId && state.verticals.length) state.selectedVerticalId = state.verticals[0].id;
}

// ── Navigation ──
function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.getElementById('addContactBtn').classList.toggle('hidden', view !== 'contacts');
  document.getElementById('importContactsBtn').classList.toggle('hidden', view !== 'contacts');
  const titles = { search: 'Search', contacts: 'Contacts', tasks: 'VA Task Queue', leaderboard: 'Team Leaderboard', verticals: 'Verticals & Categories', billing: 'Billing & Plan', integrations: 'CRM Integrations', route: 'Route Planning', composer: 'Email Composer' };
  document.getElementById('viewTitle').textContent = titles[view];
  if (view === 'search') renderSearchView();
  if (view === 'contacts') renderContactsView();
  if (view === 'tasks') renderTasksView();
  if (view === 'leaderboard') renderLeaderboardView();
  if (view === 'verticals') renderVerticalsView();
  if (view === 'billing') renderBillingView();
  if (view === 'integrations') renderIntegrationsView();
  if (view === 'route') renderRouteView();
  if (view === 'composer') renderComposerView();
}

// ── SEARCH (start page) ──
// Haversine distance in miles between two lat/lng points.
function distanceMiles(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined)) return null;
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Free, no-key US zip lookup — returns { lat, lng, city, state } or null.
async function geocodeZip(zip) {
  try {
    const res = await fetch('https://api.zippopotam.us/us/' + encodeURIComponent(zip));
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places && data.places[0];
    if (!place) return null;
    return { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude), city: place['place name'], state: place['state abbreviation'] };
  } catch (e) { return null; }
}

function renderSearchView() {
  const content = document.getElementById('content');
  const v = state.verticals.find(v => v.id === state.selectedVerticalId);
  const maxRadius = state.billingStatus?.maxRadiusMiles || 25;
  content.innerHTML = `
    <div class="banner">Start here every time you begin prospecting: pick the category of business you're targeting and the region to search. This becomes your active territory in Contacts.</div>
    <div class="card" style="max-width:520px">
      <div class="field">
        <label>Category of business</label>
        <select id="s_vertical" class="select" style="width:100%">
          ${state.verticals.map(x => `<option value="${x.id}" ${x.id === state.selectedVerticalId ? 'selected' : ''}>${x.label}</option>`).join('')}
          <option value="__new__">+ Create new category…</option>
        </select>
      </div>
      <div id="s_new_wrap" class="${state.verticals.length ? 'hidden' : ''}" style="display:flex;gap:8px;margin-bottom:14px">
        <input id="s_new_label" placeholder="Category name (e.g. Interior Designers)" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px">
        <input id="s_new_code" placeholder="Tag code (e.g. INT)" style="width:100px;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px">
      </div>
      <div class="field">
        <label>State</label>
        <select id="s_state" class="select" style="width:100%">
          <option value="">Select a state</option>
          ${US_STATES.map(s => `<option value="${s}" ${v?.targetState === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Search region by</label>
        <div id="s_regionMode">
          <span class="tone-chip ${state.searchRegionMode !== 'county' ? 'active' : ''}" data-mode="city" onclick="setRegionMode('city')">City</span>
          <span class="tone-chip ${state.searchRegionMode === 'county' ? 'active' : ''}" data-mode="county" onclick="setRegionMode('county')">County</span>
        </div>
      </div>
      <div class="field ${state.searchRegionMode === 'county' ? 'hidden' : ''}" id="s_city_wrap"><label>City</label><input id="s_city" placeholder="e.g. Tampa" value="${v?.targetCity || ''}"></div>
      <div class="field ${state.searchRegionMode === 'county' ? '' : 'hidden'}" id="s_county_wrap"><label>County</label><input id="s_county" placeholder="e.g. Suffolk County" value="${v?.targetCounty || ''}"></div>
      <div class="field"><label>Zip code</label><input id="s_zip" placeholder="e.g. 33602" value="${v?.targetZip || ''}"></div>
      <div class="field">
        <label>Search radius</label>
        <select id="s_radius" class="select" style="width:100%">
          ${RADIUS_OPTIONS.map(r => `<option value="${r}" ${r > maxRadius ? 'disabled' : ''} ${(v?.radiusMiles || 25) === r && r <= maxRadius ? 'selected' : ''}>${r} mile radius${r > maxRadius ? ' — upgrade required' : ''}</option>`).join('')}
        </select>
        <div style="font-size:11px;color:var(--mute);margin-top:4px">Your ${state.billingStatus?.plan || 'current'} plan allows up to a ${maxRadius}-mile radius per territory. <a href="#" onclick="switchView('billing');return false;">Upgrade for wider coverage</a>.</div>
      </div>
      <div id="s_error" class="auth-error hidden"></div>
      <button class="btn primary" onclick="runSearch()">🔍 Search This Territory</button>
    </div>`;

  document.getElementById('s_vertical').addEventListener('change', (e) => {
    document.getElementById('s_new_wrap').classList.toggle('hidden', e.target.value !== '__new__');
  });
}

function setRegionMode(mode) {
  state.searchRegionMode = mode;
  document.querySelectorAll('#s_regionMode .tone-chip').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
  document.getElementById('s_city_wrap').classList.toggle('hidden', mode === 'county');
  document.getElementById('s_county_wrap').classList.toggle('hidden', mode !== 'county');
}

async function runSearch() {
  const errEl = document.getElementById('s_error');
  errEl.classList.add('hidden');

  const vertSel = document.getElementById('s_vertical').value;
  const state_ = document.getElementById('s_state').value;
  const regionMode = state.searchRegionMode === 'county' ? 'county' : 'city';
  const city = regionMode === 'city' ? document.getElementById('s_city').value.trim() : '';
  const county = regionMode === 'county' ? document.getElementById('s_county').value.trim() : '';
  const zip = document.getElementById('s_zip').value.trim();
  const radiusMiles = parseInt(document.getElementById('s_radius').value);

  if (!vertSel || !state_ || !zip || (regionMode === 'city' ? !city : !county)) {
    errEl.textContent = `Category, state, zip, and ${regionMode} are all required to search.`;
    errEl.classList.remove('hidden');
    return;
  }

  let verticalId = vertSel;
  try {
    if (vertSel === '__new__') {
      const label = document.getElementById('s_new_label').value.trim();
      const categoryCode = document.getElementById('s_new_code').value.trim();
      if (!label || !categoryCode) { errEl.textContent = 'Enter a name and tag code for the new category.'; errEl.classList.remove('hidden'); return; }
      const created = await api('/verticals', { method: 'POST', body: { label, categoryCode } });
      verticalId = created.id;
    }

    const geo = await geocodeZip(zip);
    await api('/verticals/' + verticalId, {
      method: 'PATCH',
      body: {
        targetState: state_, targetCity: city || null, targetCounty: county || null, targetZip: zip, radiusMiles,
        targetLat: geo?.lat ?? null, targetLng: geo?.lng ?? null,
      },
    });

    await loadVerticals();
    state.selectedVerticalId = verticalId;
    switchView('contacts');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ── CONTACTS VIEW ──
async function renderContactsView() {
  const content = document.getElementById('content');
  const v = state.verticals.find(v => v.id === state.selectedVerticalId);
  const regionLabel = v && v.targetCounty ? v.targetCounty : (v ? v.targetCity : '');
  const searchBanner = v && v.targetState
    ? `<div class="banner">🔍 Active territory: <b>${v.label}</b> in ${regionLabel}, ${v.targetState} ${v.targetZip} · ${v.radiusMiles} mile radius
        <span class="btn link" style="padding:0 0 0 8px" onclick="switchView('search')">Edit search</span></div>`
    : `<div class="banner">No search territory set for this category yet. <span class="btn link" style="padding:0 0 0 4px" onclick="switchView('search')">Set one up</span></div>`;
  content.innerHTML = `
    ${searchBanner}
    <div class="toolbar" id="verticalChips"></div>
    <div class="grid" id="contactsGrid"><div class="empty">Loading…</div></div>
  `;
  renderVerticalChips();
  await loadContactsForSelectedVertical();
}

function renderVerticalChips() {
  const wrap = document.getElementById('verticalChips');
  if (!wrap) return;
  wrap.innerHTML = state.verticals.map(v => `
    <span class="vertical-chip ${v.id === state.selectedVerticalId ? 'active' : ''}" onclick="selectVertical('${v.id}')">
      ${v.label} <span class="vertical-count">${v._count?.contacts ?? ''}</span>
    </span>
  `).join('') || '<span style="font-size:12px;color:var(--mute)">No verticals yet — add one in the Verticals tab.</span>';
}

async function selectVertical(id) {
  state.selectedVerticalId = id;
  await renderContactsView();
}

async function loadContactsForSelectedVertical() {
  const grid = document.getElementById('contactsGrid');
  if (!state.selectedVerticalId) { grid.innerHTML = '<div class="empty">Create a vertical first.</div>'; return; }
  state.contacts = await api('/contacts?verticalId=' + state.selectedVerticalId);
  if (!state.contacts.length) { grid.innerHTML = '<div class="empty">No contacts yet in this vertical. Click "+ Add Contact" to start.</div>'; return; }

  const v = state.verticals.find(v => v.id === state.selectedVerticalId);
  // Attach distance from the active search territory, if both the territory and the contact are geocoded.
  const withDistance = state.contacts.map(c => ({
    ...c,
    _distance: (v?.targetLat != null && c.lat != null) ? distanceMiles(v.targetLat, v.targetLng, c.lat, c.lng) : null,
  }));
  // Contacts within radius (or without coordinates, so nothing is hidden) sort first, closest first.
  withDistance.sort((a, b) => {
    if (a._distance == null && b._distance == null) return 0;
    if (a._distance == null) return 1;
    if (b._distance == null) return -1;
    return a._distance - b._distance;
  });
  state.contacts = withDistance;
  grid.innerHTML = withDistance.map(c => contactCardHTML(c, v)).join('');
}

function contactCardHTML(c, v) {
  const phoneOk = !!c.phone, emailOk = !!c.email, addrOk = !!c.address;
  const inRadius = v && c._distance != null ? c._distance <= v.radiusMiles : null;
  const distanceTag = c._distance != null
    ? `<div class="tag" style="background:${inRadius ? '#eafaf0' : '#fef2f2'};color:${inRadius ? 'var(--green)' : 'var(--red)'}">${c._distance.toFixed(1)} mi ${inRadius ? '· in radius' : '· outside radius'}</div>`
    : '';
  return `
  <div class="card contact-card tier-${c.tier}">
    <div class="dot-row">
      <span class="dot ${phoneOk ? 'ok' : 'bad'}" title="Phone"></span>
      <span class="dot ${emailOk ? 'ok' : 'bad'}" title="Email"></span>
      <span class="dot ${addrOk ? 'ok' : 'bad'}" title="Address"></span>
    </div>
    <div class="contact-name">${c.name}</div>
    <div class="contact-meta">${c.contactName || 'No contact name'} ${c.contactTitle ? '· ' + c.contactTitle : ''}</div>
    <div class="contact-meta">${c.address || 'No address on file'}</div>
    <div class="contact-meta">${c.phone || '—'} · ${c.email || '—'}</div>
    <div class="tag">${c.categoryId || 'uncategorized'}</div>
    ${distanceTag}
    ${c.dataConfirmed
      ? `<div class="badge-confirmed">✓ Confirmed</div><button class="btn" style="margin-top:8px;font-size:11px" onclick="openCallLogModal('${c.id}')">📞 Log Call</button>`
      : `<div class="confirm-row"><button class="btn" style="font-size:11px" onclick="confirmContact('${c.id}')">✓ Confirm data</button></div>`
    }
  </div>`;
}

async function confirmContact(id) {
  await api('/contacts/' + id, { method: 'PATCH', body: { confirm: true } });
  await loadVerticals(); // refresh counts
  await loadContactsForSelectedVertical();
}

function openAddContactModal() {
  if (!state.selectedVerticalId) return alert('Create a vertical first (Verticals tab).');
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Add Contact</h3>
        <div class="field"><label>Company name</label><input id="nc_name" placeholder="Acme Architecture"></div>
        <div class="field"><label>Contact name</label><input id="nc_contact_name" placeholder="Jane Smith"></div>
        <div class="field"><label>Title</label><input id="nc_contact_title" placeholder="Principal"></div>
        <div class="field"><label>Address</label><input id="nc_address" placeholder="123 Main St, City, ST"></div>
        <div class="field"><label>Phone</label><input id="nc_phone" placeholder="(555) 555-5555"></div>
        <div class="field"><label>Email</label><input id="nc_email" placeholder="jane@acme.com"></div>
        <div class="field"><label>Tier</label>
          <select id="nc_tier" class="select" style="width:100%">
            <option value="A">Tier A</option><option value="B" selected>Tier B</option><option value="C">Tier C</option>
          </select>
        </div>
        <div id="addContactError" class="auth-error hidden"></div>
        <button class="btn primary" onclick="saveNewContact()">Save Contact</button>
      </div>
    </div>`;
}

async function saveNewContact() {
  const body = {
    verticalId: state.selectedVerticalId,
    name: document.getElementById('nc_name').value.trim(),
    contactName: document.getElementById('nc_contact_name').value.trim(),
    contactTitle: document.getElementById('nc_contact_title').value.trim(),
    address: document.getElementById('nc_address').value.trim(),
    phone: document.getElementById('nc_phone').value.trim(),
    email: document.getElementById('nc_email').value.trim(),
    tier: document.getElementById('nc_tier').value,
  };
  if (!body.name) return;
  try {
    await api('/contacts', { method: 'POST', body });
    closeModal();
    await loadVerticals();
    await loadContactsForSelectedVertical();
  } catch (e) {
    const el = document.getElementById('addContactError');
    el.textContent = e.message; el.classList.remove('hidden');
  }
}

function openCallLogModal(contactId) {
  const contact = state.contacts.find(c => c.id === contactId);
  const vertical = state.verticals.find(v => v.id === (contact?.verticalId || state.selectedVerticalId));
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Log Call</h3>
        ${vertical?.callScript ? `<div class="banner">📋 Suggested opener for ${vertical.label}: "${vertical.callScript}"</div>` : ''}
        <div class="field"><label>Outcome</label>
          <select id="cl_outcome" class="select" style="width:100%">
            <option value="positive">Positive</option><option value="hesitant">Hesitant</option>
            <option value="low">Low interest</option><option value="ready">Ready to buy</option>
          </select>
        </div>
        <div class="field"><label>Notes</label><input id="cl_notes" placeholder="What happened on the call?"></div>
        <div class="field"><label>Next action</label><input id="cl_next" placeholder="e.g. Send spec sheet"></div>
        <button class="btn primary" onclick="saveCallLog('${contactId}')">Save Call Log</button>
      </div>
    </div>`;
}

async function saveCallLog(contactId) {
  const body = {
    contactId,
    outcome: document.getElementById('cl_outcome').value,
    notes: document.getElementById('cl_notes').value.trim(),
    nextAction: document.getElementById('cl_next').value.trim(),
  };
  await api('/call-logs', { method: 'POST', body });
  closeModal();
  alert('✓ Call logged — visible to your whole team.');
}

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

// ── CSV IMPORT ──
function openImportModal() {
  if (!state.selectedVerticalId) return alert('Select a vertical first.');
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Import Contacts from CSV</h3>
        <div class="banner">First row must be a header with any of: name, contactName, contactTitle, address, phone, email, website, tier. Only "name" is required. Limited to ${MAX_IMPORT_ROWS} rows per paste — split larger lists into multiple imports. Import still respects your batch/confirm-rate rule — rows past a locked batch will be skipped and listed.</div>
        <div class="field"><label>Paste CSV</label>
          <textarea id="csv_text" rows="8" style="width:100%;font-family:monospace;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:8px" placeholder="name,phone,email,address&#10;Acme Architecture,555-1234,info@acme.com,123 Main St"></textarea>
        </div>
        <div id="importResult" style="font-size:12px;margin-bottom:10px"></div>
        <button class="btn primary" onclick="runCsvImport()">Import</button>
      </div>
    </div>`;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => row[h] = cells[i] || '');
    return row;
  });
}

async function runCsvImport() {
  const text = document.getElementById('csv_text').value;
  const rows = parseCsv(text);
  const resultEl = document.getElementById('importResult');
  if (!rows.length) { resultEl.textContent = 'No rows found.'; return; }
  if (rows.length > MAX_IMPORT_ROWS) {
    resultEl.textContent = `This paste has ${rows.length} rows — imports are limited to ${MAX_IMPORT_ROWS} rows at a time. Split it into smaller pastes and import again.`;
    return;
  }
  try {
    const data = await api('/contacts/import', { method: 'POST', body: { verticalId: state.selectedVerticalId, rows } });
    resultEl.innerHTML = `✓ Imported ${data.createdCount}. Skipped ${data.skippedCount}.` +
      (data.skipped.length ? '<br>' + data.skipped.map(s => `${s.row.name || '(no name)'}: ${s.reason}`).join('<br>') : '');
    await loadVerticals();
    await loadContactsForSelectedVertical();
    renderVerticalChips();
  } catch (e) { resultEl.textContent = '⚠ ' + e.message; }
}

// ── LEADERBOARD VIEW ──
async function renderLeaderboardView() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty">Loading…</div>';
  const data = await api('/reports/leaderboard?days=7');
  if (!data.leaderboard.length) { content.innerHTML = '<div class="empty">No team activity yet.</div>'; return; }
  content.innerHTML = `
    <div class="banner">Last ${data.days} days · score = calls×2 + confirms×3 + tasks×1</div>
    <table class="simple">
      <tr><th>#</th><th>Name</th><th>Role</th><th>Calls Made</th><th>Contacts Confirmed</th><th>Tasks Completed</th><th>Score</th></tr>
      ${data.leaderboard.map((u, i) => `
        <tr>
          <td>${i + 1}${i === 0 ? ' 🏆' : ''}</td><td>${u.name}</td><td>${u.role}</td>
          <td>${u.callsMade}</td><td>${u.contactsConfirmed}</td><td>${u.tasksCompleted}</td>
          <td><b>${u.score}</b></td>
        </tr>`).join('')}
    </table>`;
}

// ── TASKS VIEW ──
async function renderTasksView() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty">Loading…</div>';
  state.tasks = await api('/va-tasks?status=open');
  if (!state.tasks.length) { content.innerHTML = '<div class="empty">🎉 No open tasks — every contact has complete data.</div>'; return; }
  content.innerHTML = `
    <table class="simple">
      <tr><th>Contact</th><th>Tier</th><th>Missing Field</th><th>Assigned To</th><th></th></tr>
      ${state.tasks.map(t => `
        <tr>
          <td>${t.contact.name}</td>
          <td>${t.contact.tier}</td>
          <td>${t.missingField}</td>
          <td>${t.assignedTo?.name || 'Unassigned'}</td>
          <td><button class="btn" style="font-size:11px" onclick="completeTask('${t.id}')">Mark complete</button></td>
        </tr>`).join('')}
    </table>`;
}

async function completeTask(id) {
  await api('/va-tasks/' + id + '/complete', { method: 'PATCH' });
  renderTasksView();
}

// ── VERTICALS VIEW ──
async function renderVerticalsView() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="banner">Verticals are fully custom to your company — add as many categories as your team sells into (e.g. "Architects", "Municipal Boards", "Plumbing Distributors"). Each gets its own batch size and confirm-rate rule.</div>
    <div class="toolbar">
      <input id="v_label" placeholder="New vertical name (e.g. Landscape Architects)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:220px">
      <input id="v_code" placeholder="Tag code (e.g. LAND)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:110px">
      <input id="v_batch" type="number" value="50" min="10" max="200" title="Batch size must be 10–200" placeholder="Batch size (10–200)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:130px">
      <input id="v_call_script" placeholder="Call opener (optional)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:220px">
      <button class="btn primary" style="width:auto" onclick="addVertical()">+ Add Vertical</button>
    </div>
    <table class="simple">
      <tr><th>Vertical</th><th>Tag Code</th><th>Batch Size</th><th>Confirm Threshold</th><th>Contacts</th><th>Call Script</th></tr>
      ${state.verticals.map(v => `
        <tr>
          <td>${v.label}</td><td>${v.categoryCode}</td><td>${v.batchSize}</td>
          <td>${Math.round(v.confirmThreshold*100)}%</td><td>${v._count?.contacts ?? 0}</td>
          <td>${v.callScript ? `<button class="btn" style="font-size:11px" onclick='alert(${JSON.stringify(v.callScript)})'>View</button>` : `<button class="btn" style="font-size:11px" onclick="editScript('${v.id}')">+ Add</button>`}</td>
        </tr>`).join('')}
    </table>`;
}

async function addVertical() {
  const label = document.getElementById('v_label').value.trim();
  const categoryCode = document.getElementById('v_code').value.trim();
  const batchSize = parseInt(document.getElementById('v_batch').value) || 50;
  const callScript = document.getElementById('v_call_script').value.trim();
  if (!label || !categoryCode) return alert('Name and tag code are required.');
  try {
    await api('/verticals', { method: 'POST', body: { label, categoryCode, batchSize, callScript: callScript || null } });
    await loadVerticals();
    renderVerticalsView();
  } catch (e) { alert(e.message); }
}

async function editScript(verticalId) {
  const script = prompt('Call opener / talking points for this vertical:');
  if (script === null) return;
  await api('/verticals/' + verticalId, { method: 'PATCH', body: { callScript: script } });
  await loadVerticals();
  renderVerticalsView();
}

// ── BILLING VIEW ──
const PRODUCT_LINE_GROUPS = [
  { key: 'cloud', label: 'Cloud Dashboard', blurb: 'Multi-user web dashboard for teams and admins.', plans: ['intro', 'smallbiz', 'pro', 'enterprise', 'enterprise_key'] },
  { key: 'desktop', label: 'Desktop App', blurb: 'Per-user downloadable license for Windows & Mac.', plans: ['desktop_basic', 'desktop_plus', 'desktop_pro'] },
  { key: 'mobile', label: 'Mobile App', blurb: 'Per-user license for field reps working on the go.', plans: ['mobile_basic', 'mobile_plus', 'mobile_pro'] },
];

function billingPlanCard(p, status) {
  const isCurrent = status.plan === p.key;
  const seats = p.salesAssisted
    ? `${p.minSeats}\u2013${p.maxSeats} seats (~$${p.pricePerSeat}/seat/mo)`
    : p.seats === null ? 'Unlimited seats' : `Up to ${p.seats} seat${p.seats > 1 ? 's' : ''}`;
  const territories = p.territories === null ? 'Unlimited territories' : `Up to ${p.territories} territor${p.territories > 1 ? 'ies' : 'y'}`;
  const priceHtml = p.salesAssisted
    ? `<div style="font-size:16px;font-weight:800">Custom<span style="font-size:12px;font-weight:400;color:var(--mute)"> quote</span></div>`
    : `<div style="font-size:22px;font-weight:800">$${p.price}<span style="font-size:12px;font-weight:400;color:var(--mute)">/mo</span></div>`;
  let button;
  if (isCurrent) {
    button = `<button class="btn" disabled>Current Plan</button>`;
  } else if (p.isDesktop) {
    button = `<button class="btn primary" onclick="window.open('/download.html','_blank')">Download Desktop App</button>`;
  } else if (p.isMobile) {
    button = `<button class="btn primary" onclick="checkout('${p.key}')">Choose ${p.label}</button>`;
  } else if (p.salesAssisted) {
    button = `<button class="btn primary" onclick="showContactSalesForm('${p.key}')">Contact Sales</button>`;
  } else {
    button = `<button class="btn primary" onclick="checkout('${p.key}')">${p.key === 'intro' ? 'Choose' : 'Upgrade to'} ${p.label}</button>`;
  }
  return `
    <div class="card" style="width:250px;display:flex;flex-direction:column;${isCurrent ? 'border:2px solid var(--gold)' : ''}">
      <h3 style="margin-top:0">${p.label}</h3>
      ${priceHtml}
      <p style="font-size:12px;color:var(--mute);min-height:32px">${p.tagline}</p>
      <ul style="font-size:12px;color:var(--mute);padding-left:18px;flex:1">
        <li>${seats}</li>
        <li>${territories}${p.territoryAddOn ? ` <span style="color:var(--gold)">(+${p.territoryAddOn.maxAddOns} more @ $${p.territoryAddOn.price}/mo ea.)</span>` : ''}</li>
        ${p.features.slice(2).map(f => `<li>${f}</li>`).join('')}
      </ul>
      ${button}
    </div>`;
}

async function renderBillingView() {
  const content = document.getElementById('content');
  const [status, plans] = await Promise.all([api('/billing/status'), api('/billing/plans')]);
  const byKey = {};
  plans.forEach(p => { byKey[p.key] = p; });

  const groupsHtml = PRODUCT_LINE_GROUPS.map(g => `
    <div style="margin-top:22px">
      <h3 style="margin-bottom:2px">${g.label}</h3>
      <p style="font-size:12px;color:var(--mute);margin-top:0 0 10px">${g.blurb}</p>
      <div class="grid" style="display:flex;flex-wrap:wrap;gap:16px;margin-top:10px">
        ${g.plans.filter(k => byKey[k]).map(k => billingPlanCard(byKey[k], status)).join('')}
      </div>
    </div>`).join('');

  const licenseKeyPanel = status.plan === 'enterprise_key' ? await renderLicenseKeyPanelHtml() : '';
  const territoryAddOnPanel = status.territoryAddOn ? renderTerritoryAddOnPanelHtml(status) : '';

  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="n">${status.plan}</div><div class="l">Current Plan</div></div>
      <div class="stat-box"><div class="n">${status.subscriptionStatus}</div><div class="l">Status</div></div>
      ${status.trialDaysLeft !== null ? `<div class="stat-box"><div class="n">${status.trialDaysLeft}</div><div class="l">Trial Days Left</div></div>` : ''}
      <div class="stat-box"><div class="n">${status.effectiveTerritoryLimit === null ? '∞' : status.effectiveTerritoryLimit}</div><div class="l">Territories Available</div></div>
    </div>
    <p style="font-size:11px;color:var(--mute);margin-top:12px;max-width:640px">Priced below comparable prospecting/CRM tools (e.g. Close from $19&#8211;49/seat/mo, Apollo from $49/seat/mo, GoHighLevel from $97&#8211;497/mo) while still including bi-directional CRM sync at the Small Business tier. Enterprise tiers (30+ users) are volume-quoted and sales-assisted.</p>
    ${groupsHtml}
    <div id="contactSalesFormWrap" style="margin-top:20px"></div>
    <div id="billingMsg" style="margin-top:14px;font-size:12px;color:var(--mute)"></div>
    ${territoryAddOnPanel}
    ${licenseKeyPanel}
    ${renderLegalContactPanel()}`;
}

// ── À LA CARTE TERRITORY ADD-ONS ──
// Lets a tenant on a capped (non-unlimited) plan buy extra territory slots at a flat per-territory
// price, same features, no tier jump. Not shown for Professional/Enterprise/Enterprise Key/trial
// since those already include unlimited or very high territory counts.
function renderTerritoryAddOnPanelHtml(status) {
  const cfg = status.territoryAddOn;
  const extra = status.extraTerritories || 0;
  const cost = extra * cfg.price;
  const options = [];
  for (let i = 0; i <= cfg.maxAddOns; i++) options.push(i);
  return `
    <div class="card" style="margin-top:20px;max-width:520px">
      <h3 style="margin-top:0">Add More Territories</h3>
      <p style="font-size:12px;color:var(--mute)">Same plan, same features — just more coverage. $${cfg.price}/mo per extra territory (each is one county or one zip+radius area), up to ${cfg.maxAddOns} extra on your current plan. Need more than that? Upgrade tiers instead.</p>
      <div style="display:flex;align-items:center;gap:10px;margin:12px 0">
        <label style="font-size:12px">Extra territories
          <select id="territoryAddOnCount" style="display:block;width:100px;margin-top:4px" onchange="previewTerritoryAddOn(${status.baseTerritories}, ${cfg.price})">
            ${options.map(n => `<option value="${n}" ${n === extra ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <div style="font-size:13px;color:var(--mute);margin-top:14px">
          Base: ${status.baseTerritories} + <span id="addOnPreview">${extra}</span> extra = <b><span id="totalPreview">${status.baseTerritories + extra}</span> territories</b>
          &middot; +$<span id="costPreview">${cost}</span>/mo
        </div>
      </div>
      <button class="btn primary" onclick="setTerritoryAddOns()">Update</button>
      <div id="territoryAddOnMsg" style="margin-top:10px;font-size:12px;color:var(--mute)"></div>
    </div>`;
}

function previewTerritoryAddOn(base, pricePerTerritory) {
  const n = parseInt(document.getElementById('territoryAddOnCount').value, 10) || 0;
  document.getElementById('addOnPreview').textContent = n;
  document.getElementById('totalPreview').textContent = base + n;
  document.getElementById('costPreview').textContent = n * pricePerTerritory;
}

async function setTerritoryAddOns() {
  const msg = document.getElementById('territoryAddOnMsg');
  const count = parseInt(document.getElementById('territoryAddOnCount').value, 10);
  msg.textContent = 'Updating...';
  try {
    const res = await api('/billing/territories/set', { method: 'POST', body: { count } });
    msg.textContent = `✓ You now have ${res.effectiveTerritoryLimit} territories total (+$${res.monthlyAddOnCost}/mo).`;
    renderBillingView();
  } catch (e) {
    msg.textContent = '⚠ ' + e.message;
  }
}

function showContactSalesForm(planKey) {
  const wrap = document.getElementById('contactSalesFormWrap');
  wrap.innerHTML = `
    <div class="card" style="max-width:420px">
      <h3 style="margin-top:0">Contact Sales — ${planKey === 'enterprise' ? 'Enterprise' : 'Enterprise Key'}</h3>
      <label style="display:block;font-size:12px;margin-top:6px">Seats needed
        <input type="number" id="salesSeats" min="1" style="display:block;width:100%;margin-top:4px" />
      </label>
      <label style="display:block;font-size:12px;margin-top:10px">Notes (optional)
        <textarea id="salesNotes" rows="3" style="display:block;width:100%;margin-top:4px"></textarea>
      </label>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn primary" onclick="submitContactSales('${planKey}')">Submit</button>
        <button class="btn" onclick="document.getElementById('contactSalesFormWrap').innerHTML=''">Cancel</button>
      </div>
      <div id="contactSalesMsg" style="margin-top:10px;font-size:12px;color:var(--mute)"></div>
    </div>`;
}

async function submitContactSales(planKey) {
  const msg = document.getElementById('contactSalesMsg');
  const seatsRequested = parseInt(document.getElementById('salesSeats').value, 10) || null;
  const notes = document.getElementById('salesNotes').value.trim();
  msg.textContent = 'Sending...';
  try {
    const res = await api('/billing/contact-sales', { method: 'POST', body: { plan: planKey, seatsRequested, notes } });
    msg.textContent = '✓ ' + res.message;
  } catch (e) {
    msg.textContent = '⚠ ' + e.message;
  }
}

// ── LICENSE KEYS (Enterprise Key plan — self-service seat provisioning) ──
async function renderLicenseKeyPanelHtml() {
  let keys = [];
  try { keys = await api('/license-keys'); } catch (e) { /* not entitled or none yet */ }
  const unassigned = keys.filter(k => k.status === 'unassigned').length;
  const redeemed = keys.filter(k => k.status === 'redeemed').length;
  const rows = keys.slice(0, 50).map(k => `
    <tr>
      <td style="font-family:monospace;font-size:12px">${k.code}</td>
      <td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${k.status === 'redeemed' ? 'var(--green-bg)' : k.status === 'revoked' ? 'var(--red-bg)' : 'var(--amber-bg)'}">${k.status}</span></td>
      <td style="font-size:12px;color:var(--mute)">${k.assignedEmail || '—'}</td>
      <td>${k.status !== 'revoked' ? `<button class="btn link" onclick="revokeLicenseKey('${k.id}')">Revoke</button>` : ''}</td>
    </tr>`).join('');
  return `
    <div class="card" style="margin-top:20px;max-width:640px">
      <h3 style="margin-top:0">Registration Keys</h3>
      <p style="font-size:12px;color:var(--mute)">${unassigned} unassigned &middot; ${redeemed} redeemed &middot; ${keys.length} total purchased seats. Share unredeemed keys with your team — each person creates their own login by redeeming a key at <code>/redeem</code>.</p>
      <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px">
        <label style="font-size:12px">Generate
          <input type="number" id="genKeyCount" value="5" min="1" max="100" style="display:block;width:80px;margin-top:4px" />
        </label>
        <button class="btn primary" onclick="generateLicenseKeys()">Generate Keys</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;color:var(--mute)"><th>Code</th><th>Status</th><th>Assigned Email</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="color:var(--mute)">No keys generated yet.</td></tr>'}</tbody>
      </table>
      <div id="licenseKeyMsg" style="margin-top:10px;font-size:12px;color:var(--mute)"></div>
    </div>`;
}

async function generateLicenseKeys() {
  const msg = document.getElementById('licenseKeyMsg');
  const count = parseInt(document.getElementById('genKeyCount').value, 10) || 1;
  msg.textContent = 'Generating...';
  try {
    await api('/license-keys/generate', { method: 'POST', body: { count } });
    renderBillingView();
  } catch (e) {
    msg.textContent = '⚠ ' + e.message;
  }
}

async function revokeLicenseKey(id) {
  if (!confirm('Revoke this key? If already redeemed, the user\'s login is unaffected but the seat no longer counts toward your pool for new invites.')) return;
  await api(`/license-keys/${id}/revoke`, { method: 'POST' });
  renderBillingView();
}

// Owner/admin-only legal & contact info — never shown outside this admin-facing panel.
function renderLegalContactPanel() {
  const role = (state.user && state.user.role) || '';
  if (role !== 'owner' && role !== 'admin') return '';
  return `
    <div class="card" style="margin-top:20px;max-width:420px">
      <h3 style="margin-top:0;font-size:13px">Legal &amp; Contact (admin only)</h3>
      <div style="font-size:12px;color:var(--mute);line-height:1.6">
        Support inbox: <a href="mailto:prospectpro@lcs-studio.com">prospectpro@lcs-studio.com</a><br>
        Operated by: Lighting + Controls Solutions LLC<br>
        Billing contact: Studio@LCS-Studio.com
      </div>
    </div>`;
}

// ── INTEGRATIONS (CRM sync) ──
async function renderIntegrationsView() {
  const content = document.getElementById('content');
  content.innerHTML = '<p style="color:var(--mute);font-size:13px">Loading...</p>';
  const [{ providers, comingSoon }, conn] = await Promise.all([
    api('/crm/providers'),
    api('/crm/connection'),
  ]);
  state.crmProviders = providers;

  if (conn.connected) {
    const provider = providers.find(p => p.key === conn.provider);
    content.innerHTML = `
      <div class="card" style="max-width:520px">
        <h3 style="margin-top:0">${provider ? provider.name : conn.provider} — Connected</h3>
        <div style="font-size:12px;color:var(--mute);line-height:1.8">
          Status: <b style="color:${conn.status === 'connected' ? '#1a7f37' : '#c0392b'}">${conn.status}</b><br>
          Last synced: ${conn.lastSyncAt ? new Date(conn.lastSyncAt).toLocaleString() : 'never yet'}<br>
          ${conn.lastError ? `<span style="color:#c0392b">Last error: ${conn.lastError}</span><br>` : ''}
        </div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn primary" onclick="crmSyncNow()">Sync Now</button>
          <button class="btn" onclick="crmDisconnect()">Disconnect</button>
        </div>
        <div id="crmMsg" style="margin-top:10px;font-size:12px;color:var(--mute)"></div>
      </div>
      <p style="font-size:12px;color:var(--mute);margin-top:16px;max-width:520px">
        Confirmed contacts push to ${provider ? provider.name : 'your CRM'} automatically every 30 minutes,
        and any edits made in ${provider ? provider.name : 'your CRM'} (e.g. after a call) sync back here too.
      </p>`;
    return;
  }

  const cards = providers.map(p => `
    <div class="card" style="width:220px">
      <h3 style="margin-top:0">${p.name}</h3>
      <button class="btn primary" onclick="showCrmConnectForm('${p.key}')">Connect</button>
    </div>`).join('');
  const soonCards = comingSoon.map(p => `
    <div class="card" style="width:220px;opacity:.55">
      <h3 style="margin-top:0">${p.name}</h3>
      <button class="btn" disabled>Coming soon</button>
    </div>`).join('');

  content.innerHTML = `
    <p style="font-size:13px;color:var(--mute);max-width:600px">Connect a CRM to automatically push confirmed
    prospects and pull back call/email outcomes — bi-directional, kept in sync every 30 minutes.</p>
    <div class="grid" style="display:flex;flex-wrap:wrap;gap:14px;margin-top:12px">${cards}${soonCards}</div>
    <div id="crmConnectFormWrap" style="margin-top:20px"></div>`;
}

function showCrmConnectForm(providerKey) {
  const provider = state.crmProviders.find(p => p.key === providerKey);
  const wrap = document.getElementById('crmConnectFormWrap');
  const fieldsHtml = provider.fields.map(f => `
    <label style="display:block;font-size:12px;margin-top:10px">${f.label}
      <input type="${f.type}" id="crmField_${f.key}" style="display:block;width:100%;margin-top:4px" />
    </label>`).join('');
  wrap.innerHTML = `
    <div class="card" style="max-width:420px">
      <h3 style="margin-top:0">Connect ${provider.name}</h3>
      ${fieldsHtml}
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn primary" onclick="crmConnect('${providerKey}')">Connect</button>
        <button class="btn" onclick="document.getElementById('crmConnectFormWrap').innerHTML=''">Cancel</button>
      </div>
      <div id="crmMsg" style="margin-top:10px;font-size:12px;color:var(--mute)"></div>
      ${provider.helpUrl ? `<p style="font-size:11px;margin-top:8px"><a href="${provider.helpUrl}" target="_blank">Where do I find these?</a></p>` : ''}
      ${provider.signupUrl ? `<p style="font-size:11px;margin-top:4px">Don't have a ${provider.name} account? <a href="${provider.signupUrl}" target="_blank">Sign up here</a></p>` : ''}
    </div>`;
}

async function crmConnect(providerKey) {
  const provider = state.crmProviders.find(p => p.key === providerKey);
  const credentials = {};
  provider.fields.forEach(f => { credentials[f.key] = document.getElementById(`crmField_${f.key}`).value.trim(); });
  const msg = document.getElementById('crmMsg');
  msg.textContent = 'Testing connection...';
  try {
    await api('/crm/connect', { method: 'POST', body: { provider: providerKey, credentials } });
    renderIntegrationsView();
  } catch (e) {
    msg.textContent = '⚠ ' + e.message;
  }
}

async function crmSyncNow() {
  const msg = document.getElementById('crmMsg');
  msg.textContent = 'Syncing...';
  try {
    const result = await api('/crm/sync', { method: 'POST' });
    msg.textContent = `Synced: ${result.pushed} pushed, ${result.pulled} pulled.${result.errors && result.errors.length ? ' (' + result.errors.length + ' error(s), see console)' : ''}`;
    if (result.errors && result.errors.length) console.warn(result.errors);
  } catch (e) {
    msg.textContent = '⚠ ' + e.message;
  }
}

async function crmDisconnect() {
  if (!confirm('Disconnect this CRM? Contacts already synced will keep their sync history.')) return;
  await api('/crm/disconnect', { method: 'POST' });
  renderIntegrationsView();
}

async function checkout(plan) {
  const msg = document.getElementById('billingMsg');
  try {
    const data = await api('/billing/checkout', { method: 'POST', body: { plan } });
    window.location.href = data.checkoutUrl;
  } catch (e) {
    msg.textContent = '⚠ ' + e.message + ' (expected in this demo — add real Stripe keys to go live)';
  }
}

// ── ROUTE PLANNING (free OpenStreetMap/Leaflet map — no paid API key needed) ──
let routeLeafletMap = null;

async function renderRouteView() {
  const content = document.getElementById('content');
  if (!state.selectedVerticalId) {
    content.innerHTML = '<div class="empty">Pick a territory in Search or Contacts first, then come back here to plan today\'s route.</div>';
    return;
  }
  content.innerHTML = '<p style="color:var(--mute);font-size:13px">Loading contacts…</p>';
  const contacts = await api('/contacts?verticalId=' + state.selectedVerticalId);
  state.routeContacts = contacts;
  state.routeOrdered = null;
  renderRouteLayout(contacts, null);
}

function renderRouteStops(list) {
  if (!list.length) return '<div class="empty">No contacts with an address yet in this territory.</div>';
  return list.map((c, i) => `
    <div class="route-stop">
      <div class="stop-num">${i + 1}</div>
      <div style="flex:1">
        <div class="contact-name">${c.name}</div>
        <div class="contact-meta">${c.address || 'No address on file'}</div>
        ${c._legMiles != null ? `<div style="font-size:11px;color:var(--mute);margin-top:3px">+${c._legMiles.toFixed(1)} mi from previous stop</div>` : ''}
      </div>
    </div>`).join('');
}

function renderRouteLayout(contacts, ordered) {
  const content = document.getElementById('content');
  const v = state.verticals.find(x => x.id === state.selectedVerticalId);
  const withAddr = contacts.filter(c => c.address);
  content.innerHTML = `
    <p style="font-size:13px;color:var(--mute);max-width:720px;margin-top:0">
      Plan an efficient visiting order for <b>${v ? v.label : 'this territory'}</b>. Distances shown are straight-line
      estimates — use "Open in Google Maps" for real turn-by-turn driving directions.
    </p>
    <div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn primary" style="width:auto" onclick="optimizeRoute()">Optimize Route (${withAddr.length} stops)</button>
      ${ordered ? `<button class="btn" style="width:auto" onclick="exportRouteToGoogleMaps()">Open in Google Maps</button>` : ''}
      <span id="routeMsg" style="font-size:12px;color:var(--mute)"></span>
    </div>
    <div class="route-layout">
      <div class="route-list" id="routeList">${renderRouteStops(ordered || withAddr)}</div>
      <div class="map-box" id="routeMap"></div>
    </div>`;
  initRouteMap(ordered || withAddr);
}

async function optimizeRoute() {
  const msg = document.getElementById('routeMsg');
  const v = state.verticals.find(x => x.id === state.selectedVerticalId);
  let contacts = state.routeContacts.filter(c => c.address);
  if (!contacts.length) { msg.textContent = 'No contacts with an address to route.'; return; }
  msg.textContent = 'Geocoding stops…';

  for (const c of contacts) {
    if (c.lat != null && c.lng != null) continue;
    const m = (c.address || '').match(/\b(\d{5})(-\d{4})?\b/);
    if (!m) continue;
    const geo = await geocodeZip(m[1]);
    if (geo) {
      c.lat = geo.lat; c.lng = geo.lng;
      api('/contacts/' + c.id, { method: 'PATCH', body: { lat: geo.lat, lng: geo.lng } }).catch(() => {});
    }
  }
  contacts = contacts.filter(c => c.lat != null && c.lng != null);
  if (!contacts.length) { msg.textContent = 'Could not geocode any addresses — make sure each has a 5-digit zip.'; return; }

  const start = (v && v.targetLat != null) ? { lat: v.targetLat, lng: v.targetLng } : contacts[0];
  const remaining = contacts.slice();
  const ordered = [];
  let cursor = start;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((c, i) => {
      const d = distanceMiles(cursor.lat, cursor.lng, c.lat, c.lng);
      if (d != null && d < bestDist) { bestDist = d; bestIdx = i; }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    next._legMiles = bestDist;
    ordered.push(next);
    cursor = next;
  }
  state.routeOrdered = ordered;
  const total = ordered.reduce((s, c) => s + (c._legMiles || 0), 0);
  msg.textContent = `Optimized: ${ordered.length} stops, ~${total.toFixed(1)} miles (straight-line estimate).`;
  renderRouteLayout(state.routeContacts, ordered);
}

function initRouteMap(stops) {
  const el = document.getElementById('routeMap');
  if (!el || typeof L === 'undefined') return;
  if (routeLeafletMap) { routeLeafletMap.remove(); routeLeafletMap = null; }
  const geo = stops.filter(c => c.lat != null && c.lng != null);
  const center = geo.length ? [geo[0].lat, geo[0].lng] : [40.73, -74.0];
  routeLeafletMap = L.map('routeMap').setView(center, geo.length ? 9 : 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
  }).addTo(routeLeafletMap);
  const latlngs = [];
  geo.forEach((c, i) => {
    L.marker([c.lat, c.lng]).addTo(routeLeafletMap).bindPopup(`<b>${i + 1}. ${c.name}</b><br>${c.address || ''}`);
    latlngs.push([c.lat, c.lng]);
  });
  if (latlngs.length > 1) {
    L.polyline(latlngs, { color: '#1B3A5C', weight: 3, dashArray: '6,6' }).addTo(routeLeafletMap);
    routeLeafletMap.fitBounds(latlngs, { padding: [30, 30] });
  } else if (latlngs.length === 1) {
    routeLeafletMap.setView(latlngs[0], 12);
  }
}

function exportRouteToGoogleMaps() {
  const ordered = state.routeOrdered;
  if (!ordered || !ordered.length) return;
  const encode = c => encodeURIComponent(c.address || `${c.lat},${c.lng}`);
  const origin = encode(ordered[0]);
  const destination = encode(ordered[ordered.length - 1]);
  const waypoints = ordered.slice(1, -1).map(encode).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  window.open(url, '_blank');
}

// ── EMAIL COMPOSER (template-based smart drafts, no external AI key required) ──
async function renderComposerView() {
  const content = document.getElementById('content');
  content.innerHTML = '<p style="color:var(--mute);font-size:13px">Loading contacts…</p>';
  let contacts = [];
  if (state.selectedVerticalId) contacts = await api('/contacts?verticalId=' + state.selectedVerticalId);
  state.composerContacts = contacts;
  state.composerTone = 'intro';
  content.innerHTML = `
    <div class="composer-layout">
      <div class="composer-panel card">
        <h3 style="margin-top:0;font-size:14px">1. Choose a contact</h3>
        <select id="cmp_contact" class="select" style="width:100%">
          <option value="">${contacts.length ? '— Select a contact —' : 'No contacts in this territory yet'}</option>
          ${contacts.map(c => `<option value="${c.id}">${c.name}${c.contactName ? ' — ' + c.contactName : ''}</option>`).join('')}
        </select>
        <h3 style="font-size:14px;margin-top:18px">2. Pick a tone</h3>
        <div id="cmp_tones">
          ${[['intro', 'Intro'], ['followup', 'Follow-up'], ['checkin', 'Check-in'], ['thanks', 'Thank you']].map(([t, l], i) =>
            `<span class="tone-chip ${i === 0 ? 'active' : ''}" data-tone="${t}" onclick="selectComposerTone('${t}')">${l}</span>`).join('')}
        </div>
        <h3 style="font-size:14px;margin-top:18px">3. Your name</h3>
        <input id="cmp_sender" class="select" style="width:100%" placeholder="Your name" value="${state.user ? state.user.name : ''}" />
        <button class="btn primary" style="margin-top:16px" onclick="generateComposerEmail()">Generate Draft</button>
      </div>
      <div class="composer-output card" id="cmp_output">
        <div class="empty">Pick a contact and tone, then generate a draft. It pulls in the company name, contact person, and category details automatically.</div>
      </div>
    </div>`;
}

function selectComposerTone(tone) {
  state.composerTone = tone;
  document.querySelectorAll('#cmp_tones .tone-chip').forEach(el => el.classList.toggle('active', el.dataset.tone === tone));
}

function generateComposerEmail() {
  const contactId = document.getElementById('cmp_contact').value;
  const senderName = document.getElementById('cmp_sender').value.trim() || 'our team';
  const out = document.getElementById('cmp_output');
  if (!contactId) { out.innerHTML = '<div class="empty">Choose a contact first.</div>'; return; }
  const c = state.composerContacts.find(x => x.id === contactId);
  const v = state.verticals.find(x => x.id === state.selectedVerticalId);
  const tone = state.composerTone || 'intro';
  const firstName = (c.contactName || '').split(' ')[0] || 'there';
  const context = v && v.emailScript ? v.emailScript : `we work with businesses like ${c.name} in the ${v ? v.label.toLowerCase() : 'industry'} space`;

  const templates = {
    intro: {
      subject: `Quick intro — ${c.name}`,
      body: `Hi ${firstName},\n\nMy name is ${senderName}. ${context}.\n\nI'd love to find 10 minutes this week to introduce ourselves and see if there's a fit for ${c.name}. Would a quick call work sometime this week?\n\nBest,\n${senderName}`,
    },
    followup: {
      subject: `Following up — ${c.name}`,
      body: `Hi ${firstName},\n\nWanted to follow up on my earlier note — I know things get busy. Are you still the right person to speak with about this at ${c.name}?\n\nHappy to work around your schedule.\n\nBest,\n${senderName}`,
    },
    checkin: {
      subject: `Checking in — ${c.name}`,
      body: `Hi ${firstName},\n\nIt's been a little while since we last connected. Wanted to check in and see how things are going at ${c.name}, and if there's anything new we can help with.\n\nBest,\n${senderName}`,
    },
    thanks: {
      subject: `Thanks for your time — ${c.name}`,
      body: `Hi ${firstName},\n\nThank you for taking the time to speak with me. It was great learning more about ${c.name}. I'll follow up with next steps shortly, but feel free to reach out in the meantime.\n\nBest,\n${senderName}`,
    },
  };
  const { subject, body } = templates[tone];
  const mailto = `mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  out.innerHTML = `
    <h3 style="margin-top:0;font-size:14px">Draft for ${c.name}</h3>
    <label style="font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:.3px">Subject</label>
    <input id="cmp_subject" class="select" style="width:100%;margin-top:4px;margin-bottom:12px" value="${subject.replace(/"/g, '&quot;')}" />
    <label style="font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:.3px">Body</label>
    <textarea id="cmp_body" class="select" style="width:100%;min-height:220px;margin-top:4px;font-family:inherit;line-height:1.6">${body}</textarea>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" style="width:auto" onclick="copyComposerDraft()">Copy Draft</button>
      <a class="btn" href="${mailto}">Open in Email App</a>
    </div>
    <div id="cmp_copyMsg" style="font-size:12px;color:var(--green);margin-top:8px"></div>`;
}

function copyComposerDraft() {
  const subject = document.getElementById('cmp_subject').value;
  const body = document.getElementById('cmp_body').value;
  navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
    document.getElementById('cmp_copyMsg').textContent = '✓ Copied to clipboard';
  }).catch(() => {
    document.getElementById('cmp_copyMsg').textContent = 'Could not copy automatically — select the text above and copy manually.';
  });
}

// ── Init ──
if (state.token && state.user) { boot(); }
