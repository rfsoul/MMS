#!/usr/bin/env node
// test-harness.js
// Run with: node test-harness.js
// Requires the API to be running on API_URL (default http://localhost:3001)

const API_URL       = process.env.API_URL       || 'http://localhost:3001';
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL   || 'admin@mms.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────

const results = { passed: 0, failed: 0, skipped: 0, errors: [] };

function green(s)  { return `\x1b[32m${s}\x1b[0m`; }
function red(s)    { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function cyan(s)   { return `\x1b[36m${s}\x1b[0m`; }
function bold(s)   { return `\x1b[1m${s}\x1b[0m`; }

function section(name) {
  console.log(`\n${cyan('━'.repeat(55))}`);
  console.log(bold(cyan(`  ${name}`)));
  console.log(`${cyan('━'.repeat(55))}`);
}

function pass(name) {
  results.passed++;
  console.log(`  ${green('✓')} ${name}`);
}

function fail(name, reason) {
  results.failed++;
  results.errors.push({ name, reason });
  console.log(`  ${red('✗')} ${name}`);
  console.log(`    ${red('→')} ${reason}`);
}

function skip(name, reason) {
  results.skipped++;
  console.log(`  ${yellow('○')} ${name} ${yellow(`(skipped: ${reason})`)}`);
}

async function request(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

async function requestMultipart(method, path, fields, fileField, fileContent, fileName, token) {
  const boundary = '----MMS' + Math.random().toString(36).slice(2);
  const CRLF     = '\r\n';
  const parts    = [];

  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined || val === null) continue;
    parts.push(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}` +
      `${val}`
    );
  }
  if (fileContent) {
    parts.push(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"${CRLF}` +
      `Content-Type: text/csv${CRLF}${CRLF}` +
      fileContent
    );
  }
  const body    = parts.join(CRLF) + CRLF + `--${boundary}--`;
  const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

async function test(name, fn) {
  try { await fn(); }
  catch (err) { fail(name, err.message || String(err)); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(res, expected, context = '') {
  if (res.status !== expected) {
    throw new Error(
      `Expected HTTP ${expected}, got ${res.status}${context ? ` (${context})` : ''}. ` +
      `Body: ${JSON.stringify(res.data)}`
    );
  }
}

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────

const state = {
  // Auth
  adminToken: null,
  adminUser: null,
  companyAdminToken: null,
  companyAdminUser: null,
  companyAdminEmail: null,
  companyAdminPassword: null,
  // Companies / users
  testCompanyId: null,
  testUserId: null,
  technicianUserId: null,
  // Assets
  assetTypeId: null,
  siteNodeId: null,
  buildingNodeId: null,
  floorNodeId: null,
  spaceNodeId: null,
  systemNodeId: null,
  assetNodeId: null,
  componentNodeId: null,
  relationshipId: null,
  // Work orders
  workOrderId: null,
  assignedWorkOrderId: null,
  techWOId: null,
  managerUserId: null,
  managerToken: null,
  managerEmail: null,
  managerPassword: null,
  technicianToken: null,
  technicianEmail: null,
  technicianPassword: null,
  // Checklists
  checklistTemplateId: null,
  importedTemplateId: null,
  assetChecklistId: null,
  // PM Schedules
  pmScheduleId: null,
  // Tasks
  generalTaskId: null,
  checklistTaskId: null,
  skippableTaskId: null,
  checklistItemIds: [],     // items from the asset checklist
};

// ─────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────

async function testHealth() {
  section('HEALTH CHECK');
  await test('GET /health returns 200', async () => {
    const res = await request('GET', '/health');
    assertStatus(res, 200);
    assert(res.data.status === 'ok', 'status should be ok');
    pass('GET /health returns 200');
  });
}

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────

async function testAuth() {
  section('AUTH');

  await test('POST /auth/login rejects wrong password', async () => {
    const res = await request('POST', '/auth/login', { email: ADMIN_EMAIL, password: 'WrongPassword123!' });
    assertStatus(res, 401);
    assert(res.data.code === 'INVALID_CREDENTIALS', 'should return INVALID_CREDENTIALS');
    pass('POST /auth/login rejects wrong password');
  });

  await test('POST /auth/login rejects missing fields', async () => {
    const res = await request('POST', '/auth/login', { email: ADMIN_EMAIL });
    assertStatus(res, 400);
    pass('POST /auth/login rejects missing fields');
  });

  await test('POST /auth/login succeeds with correct credentials', async () => {
    const res = await request('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assertStatus(res, 200);
    assert(res.data.token, 'should return token');
    state.adminToken = res.data.token;
    state.adminUser  = res.data.user;
    if (res.data.must_change_password) {
      await request('POST', '/auth/change-password', {
        current_password: ADMIN_PASSWORD, new_password: ADMIN_PASSWORD,
      }, state.adminToken);
      const relogin = await request('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      state.adminToken = relogin.data.token;
      state.adminUser  = relogin.data.user;
    }
    pass('POST /auth/login succeeds with correct credentials');
  });

  if (!state.adminToken) { skip('remaining auth tests', 'no token available'); return; }

  await test('GET /auth/me returns current user', async () => {
    const res = await request('GET', '/auth/me', null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.user.email === ADMIN_EMAIL, 'should return correct user');
    pass('GET /auth/me returns current user');
  });

  await test('Protected routes reject missing token', async () => {
    const res = await request('GET', '/auth/me');
    assertStatus(res, 401);
    pass('Protected routes reject missing token');
  });

  await test('POST /auth/change-password works and login succeeds with new password', async () => {
    const newPassword = 'TestNew@Pass99';
    await request('POST', '/auth/change-password', {
      current_password: ADMIN_PASSWORD, new_password: newPassword,
    }, state.adminToken);
    const loginRes = await request('POST', '/auth/login', { email: ADMIN_EMAIL, password: newPassword });
    assertStatus(loginRes, 200);
    state.adminToken = loginRes.data.token;
    await request('POST', '/auth/change-password', {
      current_password: newPassword, new_password: ADMIN_PASSWORD,
    }, state.adminToken);
    const finalLogin = await request('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    state.adminToken = finalLogin.data.token;
    pass('POST /auth/change-password works and login succeeds with new password');
  });

  await test('POST /auth/forgot-password always returns 200', async () => {
    const res = await request('POST', '/auth/forgot-password', { email: 'nonexistent@example.com' });
    assertStatus(res, 200);
    pass('POST /auth/forgot-password always returns 200');
  });
}

// ─────────────────────────────────────────
// COMPANIES
// ─────────────────────────────────────────

async function testCompanies() {
  section('COMPANIES');
  if (!state.adminToken) { skip('all company tests', 'no admin token'); return; }

  await test('GET /companies returns company list', async () => {
    const res = await request('GET', '/companies', null, state.adminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.companies), 'should return array');
    pass('GET /companies returns company list');
  });

  await test('POST /companies creates a new company', async () => {
    const res = await request('POST', '/companies', {
      name: `Test Company ${Date.now()}`,
      address: '123 Test Street, Sydney NSW 2000',
    }, state.adminToken);
    assertStatus(res, 201);
    state.testCompanyId = res.data.company.id;
    pass('POST /companies creates a new company');
  });

  await test('GET /companies/:id returns company', async () => {
    const res = await request('GET', `/companies/${state.testCompanyId}`, null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.company.id === state.testCompanyId, 'should return correct company');
    pass('GET /companies/:id returns company');
  });

  await test('PATCH /companies/:id updates company', async () => {
    const res = await request('PATCH', `/companies/${state.testCompanyId}`, {
      address: '456 Updated Street, Melbourne VIC 3000',
    }, state.adminToken);
    assertStatus(res, 200);
    pass('PATCH /companies/:id updates company');
  });

  await test('POST /companies rejects duplicate company name', async () => {
    const listRes = await request('GET', '/companies', null, state.adminToken);
    const existingName = listRes.data.companies[0].name;
    const res = await request('POST', '/companies', { name: existingName }, state.adminToken);
    assertStatus(res, 409);
    pass('POST /companies rejects duplicate company name');
  });
}

// ─────────────────────────────────────────
// USERS
// ─────────────────────────────────────────

async function testUsers() {
  section('USERS');
  if (!state.adminToken || !state.testCompanyId) { skip('all user tests', 'no admin token or test company'); return; }

  await test('POST /users creates a company admin', async () => {
    const res = await request('POST', '/users', {
      email:      `admin-${Date.now()}@testcompany.com`,
      full_name:  'Test Admin',
      role:       'admin',
      company_id: state.testCompanyId,
      password:   'TestAdmin@Pass123',
    }, state.adminToken);
    assertStatus(res, 201);
    state.testUserId        = res.data.user.id;
    state.companyAdminEmail = res.data.user.email;
    pass('POST /users creates a company admin');
  });

  await test('Company admin can log in', async () => {
    const res = await request('POST', '/auth/login', {
      email: state.companyAdminEmail, password: 'TestAdmin@Pass123',
    });
    assertStatus(res, 200);
    let token = res.data.token;
    if (res.data.must_change_password) {
      await request('POST', '/auth/change-password', {
        current_password: 'TestAdmin@Pass123', new_password: 'TestAdmin@NewPass123',
      }, token);
      const relogin = await request('POST', '/auth/login', {
        email: state.companyAdminEmail, password: 'TestAdmin@NewPass123',
      });
      token = relogin.data.token;
      state.companyAdminPassword = 'TestAdmin@NewPass123';
    } else {
      state.companyAdminPassword = 'TestAdmin@Pass123';
    }
    state.companyAdminToken = token;
    state.companyAdminUser  = res.data.user;
    pass('Company admin can log in');
  });

  await test('POST /users creates a technician', async () => {
    const res = await request('POST', '/users', {
      email:      `tech-${Date.now()}@testcompany.com`,
      full_name:  'Test Technician',
      role:       'technician',
      company_id: state.testCompanyId,
      password:   'TestTech@Pass123',
    }, state.adminToken);
    assertStatus(res, 201);
    state.technicianUserId = res.data.user.id;
    pass('POST /users creates a technician');
  });

  await test('GET /users returns user list', async () => {
    const res = await request('GET', '/users', null, state.adminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.users), 'should return array');
    pass('GET /users returns user list');
  });

  await test('GET /users/:id returns user', async () => {
    const res = await request('GET', `/users/${state.testUserId}`, null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.user.id === state.testUserId, 'should return correct user');
    pass('GET /users/:id returns user');
  });

  await test('PATCH /users/:id updates user', async () => {
    const res = await request('PATCH', `/users/${state.testUserId}`, {
      full_name: 'Updated Admin Name',
    }, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.user.full_name === 'Updated Admin Name', 'name should be updated');
    pass('PATCH /users/:id updates user');
  });

  await test('Company admin cannot see users from other companies', async () => {
    if (!state.companyAdminToken) { skip('company scoping test', 'no company admin token'); return; }
    const res = await request('GET', '/users', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.users.every(u => u.company_id === state.testCompanyId), 'all users should belong to test company');
    pass('Company admin cannot see users from other companies');
  });

  await test('POST /users rejects help_desk_agent in non-help-desk company', async () => {
    const res = await request('POST', '/users', {
      email: `bad-${Date.now()}@testcompany.com`, role: 'help_desk_agent',
      company_id: state.testCompanyId, password: 'TestBad@Pass123',
    }, state.adminToken);
    assertStatus(res, 400);
    pass('POST /users rejects help_desk_agent in non-help-desk company');
  });

  await test('POST /users/:id/reset-password works', async () => {
    const res = await request('POST', `/users/${state.technicianUserId}/reset-password`, {
      new_password: 'TestTech@NewPass123',
    }, state.adminToken);
    assertStatus(res, 200);
    pass('POST /users/:id/reset-password works');
  });
}

// ─────────────────────────────────────────
// ASSET TYPES
// ─────────────────────────────────────────

async function testAssetTypes() {
  section('ASSET TYPES');
  if (!state.companyAdminToken) { skip('all asset type tests', 'no company admin token'); return; }

  await test('POST /asset-types creates an asset type', async () => {
    const res = await request('POST', '/asset-types', {
      name: 'Air Handling Unit', description: 'Handles air circulation and conditioning',
    }, state.companyAdminToken);
    assertStatus(res, 201);
    state.assetTypeId = res.data.asset_type.id;
    pass('POST /asset-types creates an asset type');
  });

  await test('GET /asset-types returns list', async () => {
    const res = await request('GET', '/asset-types', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.asset_types), 'should return array');
    pass('GET /asset-types returns list');
  });

  await test('PATCH /asset-types/:id updates asset type', async () => {
    const res = await request('PATCH', `/asset-types/${state.assetTypeId}`, {
      description: 'Updated description',
    }, state.companyAdminToken);
    assertStatus(res, 200);
    pass('PATCH /asset-types/:id updates asset type');
  });
}

// ─────────────────────────────────────────
// ASSET GRAPH
// ─────────────────────────────────────────

async function testAssetGraph() {
  section('ASSET GRAPH — NODES');
  if (!state.companyAdminToken) { skip('all asset graph tests', 'no company admin token'); return; }

  const nodeTests = [
    ['Site',      'Test Site HQ',    'SITE-001', 'siteNodeId'],
    ['Building',  'Building A',      'BLD-A',    'buildingNodeId'],
    ['Floor',     'Level 1',         'L1',       'floorNodeId'],
    ['Space',     'Plant Room 1A',   'PR-1A',    'spaceNodeId'],
    ['System',    'HVAC System A',   'HVAC-A',   'systemNodeId'],
    ['Component', 'Supply Fan Motor','SFM-01',   'componentNodeId'],
  ];

  for (const [type, name, code, stateKey] of nodeTests) {
    await test(`POST /assets creates a ${type} node`, async () => {
      const res = await request('POST', '/assets', { node_type: type, name, code }, state.companyAdminToken);
      assertStatus(res, 201, `create ${type}`);
      state[stateKey] = res.data.node.id;
      pass(`POST /assets creates a ${type} node`);
    });
  }

  await test('POST /assets creates an Asset node with asset_type', async () => {
    const res = await request('POST', '/assets', {
      node_type: 'Asset', name: 'AHU-01', code: 'AHU-01',
      description: 'Air Handling Unit 01', asset_type_id: state.assetTypeId, status: 'active',
    }, state.companyAdminToken);
    assertStatus(res, 201);
    state.assetNodeId = res.data.node.id;
    pass('POST /assets creates an Asset node with asset_type');
  });

  await test('GET /assets/:nodeId returns enriched node', async () => {
    const res = await request('GET', `/assets/${state.assetNodeId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.node.id === state.assetNodeId, 'should return correct node');
    pass('GET /assets/:nodeId returns enriched node');
  });

  await test('PATCH /assets/:nodeId updates node properties', async () => {
    const res = await request('PATCH', `/assets/${state.assetNodeId}`, {
      description: 'Updated AHU description', status: 'active',
    }, state.companyAdminToken);
    assertStatus(res, 200);
    pass('PATCH /assets/:nodeId updates node properties');
  });

  await test('GET /assets returns all nodes', async () => {
    const res = await request('GET', '/assets', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.nodes), 'should return array');
    pass('GET /assets returns all nodes');
  });

  await test('POST /assets rejects invalid node_type', async () => {
    const res = await request('POST', '/assets', { node_type: 'InvalidType', name: 'Bad Node' }, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_NODE_TYPE', 'should return INVALID_NODE_TYPE');
    pass('POST /assets rejects invalid node_type');
  });

  section('ASSET GRAPH — RELATIONSHIPS');

  const relTests = [
    [state.siteNodeId,     state.buildingNodeId,   'CONTAINS',      'Site→Building'],
    [state.buildingNodeId, state.floorNodeId,       'CONTAINS',      'Building→Floor'],
    [state.floorNodeId,    state.spaceNodeId,       'CONTAINS',      'Floor→Space'],
    [state.spaceNodeId,    state.assetNodeId,       'HAS_ASSET',     'Space→Asset'],
    [state.assetNodeId,    state.systemNodeId,      'PART_OF',       'Asset→System'],
  ];

  for (const [from, to, type, label] of relTests) {
    await test(`POST /assets/relationships creates ${type} (${label})`, async () => {
      const res = await request('POST', '/assets/relationships', {
        from_node_id: from, to_node_id: to, relationship_type: type,
      }, state.companyAdminToken);
      assertStatus(res, 201, label);
      pass(`POST /assets/relationships creates ${type} (${label})`);
    });
  }

  await test('POST /assets/relationships creates HAS_COMPONENT (Asset→Component)', async () => {
    const res = await request('POST', '/assets/relationships', {
      from_node_id: state.assetNodeId, to_node_id: state.componentNodeId, relationship_type: 'HAS_COMPONENT',
    }, state.companyAdminToken);
    assertStatus(res, 201);
    state.relationshipId = res.data.relationship?.id;
    pass('POST /assets/relationships creates HAS_COMPONENT (Asset→Component)');
  });

  await test('POST /assets/relationships rejects invalid type', async () => {
    const res = await request('POST', '/assets/relationships', {
      from_node_id: state.assetNodeId, to_node_id: state.componentNodeId, relationship_type: 'INVALID_TYPE',
    }, state.companyAdminToken);
    assertStatus(res, 400);
    pass('POST /assets/relationships rejects invalid type');
  });

  section('ASSET GRAPH — TRAVERSAL');

  await test('GET /assets/:nodeId/neighbours returns connections', async () => {
    const res = await request('GET', `/assets/${state.assetNodeId}/neighbours`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.neighbours), 'should return array');
    assert(res.data.neighbours.length > 0, 'should have neighbours');
    pass('GET /assets/:nodeId/neighbours returns connections');
  });

  await test('GET /assets/:nodeId/hierarchy returns spatial ancestors', async () => {
    const res = await request('GET', `/assets/${state.assetNodeId}/hierarchy`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.hierarchy), 'should return array');
    pass('GET /assets/:nodeId/hierarchy returns spatial ancestors');
  });

  if (state.relationshipId) {
    await test('DELETE /assets/relationships/:id removes relationship', async () => {
      const res = await request('DELETE', `/assets/relationships/${state.relationshipId}`, null, state.companyAdminToken);
      assertStatus(res, 200);
      pass('DELETE /assets/relationships/:id removes relationship');
    });
  }
}

// ─────────────────────────────────────────
// WORK ORDERS
// ─────────────────────────────────────────

async function testWorkOrders() {
  section('WORK ORDERS — SETUP');

  await test('Create manager user for work order tests', async () => {
    const email = `manager-${Date.now()}@testcompany.com`;
    const res = await request('POST', '/users', {
      email, full_name: 'Test Manager', role: 'manager',
      company_id: state.testCompanyId, password: 'TestMgr@Pass123',
    }, state.adminToken);
    assertStatus(res, 201);
    state.managerUserId = res.data.user.id;
    state.managerEmail  = email;
    pass('Create manager user for work order tests');
  });

  await test('Manager can log in', async () => {
    const res = await request('POST', '/auth/login', { email: state.managerEmail, password: 'TestMgr@Pass123' });
    assertStatus(res, 200);
    let token = res.data.token;
    if (res.data.must_change_password) {
      await request('POST', '/auth/change-password', {
        current_password: 'TestMgr@Pass123', new_password: 'TestMgr@NewPass123',
      }, token);
      const relogin = await request('POST', '/auth/login', { email: state.managerEmail, password: 'TestMgr@NewPass123' });
      token = relogin.data.token;
      state.managerPassword = 'TestMgr@NewPass123';
    } else {
      state.managerPassword = 'TestMgr@Pass123';
    }
    state.managerToken = token;
    pass('Manager can log in');
  });

  await test('Technician can log in', async () => {
    if (!state.technicianUserId) { skip('technician login', 'no technicianUserId'); return; }
    const userRes = await request('GET', `/users/${state.technicianUserId}`, null, state.adminToken);
    assertStatus(userRes, 200);
    state.technicianEmail = userRes.data.user.email;
    const loginRes = await request('POST', '/auth/login', {
      email: state.technicianEmail, password: 'TestTech@NewPass123',
    });
    let token = loginRes.data.token;
    if (loginRes.data.must_change_password) {
      await request('POST', '/auth/change-password', {
        current_password: 'TestTech@NewPass123', new_password: 'TestTech@Final123',
      }, token);
      const relogin = await request('POST', '/auth/login', { email: state.technicianEmail, password: 'TestTech@Final123' });
      token = relogin.data.token;
      state.technicianPassword = 'TestTech@Final123';
    } else {
      state.technicianPassword = 'TestTech@NewPass123';
    }
    state.technicianToken = token;
    pass('Technician can log in');
  });

  if (!state.companyAdminToken || !state.managerToken) {
    skip('all work order tests', 'missing required tokens');
    return;
  }

  section('WORK ORDERS — CREATE');

  await test('POST /work-orders creates an open work order (admin, no assignee)', async () => {
    const res = await request('POST', '/work-orders', {
      title: 'HVAC Filter Replacement', description: 'Replace all filters on AHU-01',
      priority: 'high', asset_graph_id: state.assetNodeId || null,
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.work_order.status === 'open', 'should be open');
    assert(res.data.work_order.assigned_to === null, 'should have no assignee');
    state.workOrderId = res.data.work_order.id;
    pass('POST /work-orders creates an open work order (admin, no assignee)');
  });

  await test('POST /work-orders creates an assigned work order (manager)', async () => {
    const res = await request('POST', '/work-orders', {
      title: 'Pump Bearing Inspection', priority: 'medium', assigned_to: state.technicianUserId,
    }, state.managerToken);
    assertStatus(res, 201);
    assert(res.data.work_order.status === 'assigned', 'should be assigned');
    state.assignedWorkOrderId = res.data.work_order.id;
    pass('POST /work-orders creates an assigned work order (manager)');
  });

  await test('POST /work-orders rejects invalid priority', async () => {
    const res = await request('POST', '/work-orders', { title: 'Bad', priority: 'urgent' }, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_PRIORITY', 'should return INVALID_PRIORITY');
    pass('POST /work-orders rejects invalid priority');
  });

  section('WORK ORDERS — LIFECYCLE');

  await test('POST /work-orders/:id/assign assigns technician', async () => {
    const res = await request('POST', `/work-orders/${state.workOrderId}/assign`, {
      assigned_to: state.technicianUserId, notes: 'Assigning for immediate action',
    }, state.managerToken);
    assertStatus(res, 200);
    assert(res.data.work_order.status === 'assigned', 'should be assigned');
    pass('POST /work-orders/:id/assign assigns technician');
  });

  await test('POST /work-orders/:id/start transitions to in_progress', async () => {
    if (!state.technicianToken) { skip('start WO', 'no technician token'); return; }
    const res = await request('POST', `/work-orders/${state.workOrderId}/start`, {}, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.work_order.status === 'in_progress', 'should be in_progress');
    pass('POST /work-orders/:id/start transitions to in_progress');
  });
}

// ─────────────────────────────────────────
// CHECKLISTS (redesigned — asset-based)
// ─────────────────────────────────────────

async function testChecklists() {
  if (!state.companyAdminToken || !state.assetTypeId) {
    skip('all checklist tests', 'missing companyAdminToken or assetTypeId');
    return;
  }

  // ── ASSET TYPE TEMPLATES ─────────────────────────────────────────────────────

  section('CHECKLISTS — ASSET TYPE TEMPLATES');

  await test('POST /checklists/templates creates a template with items', async () => {
    const res = await request('POST', '/checklists/templates', {
      asset_type_id: state.assetTypeId,
      name:          'AHU Routine Service',
      description:   'Standard routine service checklist for Air Handling Units',
      items: [
        { sequence: 1, label: 'Check inlet filter condition',      item_type: 'true_false',  is_required: true  },
        { sequence: 2, label: 'Record supply air temperature',     item_type: 'measurement', unit: '°C', min_value: 12, max_value: 18, is_required: true, is_runtime_trigger: false },
        { sequence: 3, label: 'Record return air temperature',     item_type: 'measurement', unit: '°C', min_value: 18, max_value: 26, is_required: true  },
        { sequence: 4, label: 'Record runtime hours since service',item_type: 'measurement', unit: 'hours', is_required: true, is_runtime_trigger: true },
        { sequence: 5, label: 'Inspect belt tension',              item_type: 'step',        is_required: true  },
        { sequence: 6, label: 'Record any abnormal observations',  item_type: 'text',        is_required: false },
        { sequence: 7, label: 'Photo of completed unit',           item_type: 'photo',       is_required: false },
      ],
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.template.id,               'should return template id');
    assert(res.data.template.items.length === 7, 'should have 7 items');
    state.checklistTemplateId = res.data.template.id;
    pass('POST /checklists/templates creates a template with items');
  });

  await test('POST /checklists/templates rejects duplicate runtime trigger', async () => {
    const res = await request('POST', '/checklists/templates', {
      asset_type_id: state.assetTypeId,
      name: 'Bad Runtime Template',
      items: [
        { sequence: 1, label: 'Hours A', item_type: 'measurement', is_runtime_trigger: true },
        { sequence: 2, label: 'Hours B', item_type: 'measurement', is_runtime_trigger: true },
      ],
    }, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('POST /checklists/templates rejects duplicate runtime trigger');
  });

  await test('POST /checklists/templates with same name creates versioned template', async () => {
    const res = await request('POST', '/checklists/templates', {
      asset_type_id: state.assetTypeId,
      name:  'AHU Routine Service',
      items: [{ sequence: 1, label: 'Quick check', item_type: 'step' }],
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.template.name === 'AHU Routine Service v2', 'should be versioned as v2');
    pass('POST /checklists/templates with same name creates versioned template');
  });

  await test('GET /checklists/templates returns list', async () => {
    const res = await request('GET', '/checklists/templates', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.templates), 'should return array');
    pass('GET /checklists/templates returns list');
  });

  await test('GET /checklists/templates/:id returns template with items', async () => {
    const res = await request('GET', `/checklists/templates/${state.checklistTemplateId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.template.items.length === 7, 'should have 7 items');
    pass('GET /checklists/templates/:id returns template with items');
  });

  await test('GET /checklists/templates/:id/export returns CSV', async () => {
    const headers = {};
    if (state.companyAdminToken) headers['Authorization'] = `Bearer ${state.companyAdminToken}`;
    const res = await fetch(`${API_URL}/checklists/templates/${state.checklistTemplateId}/export`, { headers });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('text/csv'), `Expected text/csv, got ${ct}`);
    const csv = await res.text();
    assert(csv.includes('is_runtime_trigger'), 'CSV should include is_runtime_trigger column');
    pass('GET /checklists/templates/:id/export returns CSV');
  });

  await test('POST /checklists/templates/import creates template from CSV', async () => {
    const csv = [
      'sequence,label,description,item_type,unit,min_value,max_value,is_required,is_runtime_trigger',
      '1,Filter check,,true_false,,,,true,false',
      '2,Supply temp,Measure at main inlet,measurement,°C,10,20,true,false',
      '3,Runtime hours,,measurement,hours,,,true,true',
      '4,Lubricate bearings,,step,,,,true,false',
      '5,Technician notes,,text,,,,false,false',
    ].join('\n');

    const res = await requestMultipart('POST', '/checklists/templates/import',
      { asset_type_id: state.assetTypeId, name: 'AHU Imported Template' },
      'file', csv, 'template.csv', state.companyAdminToken
    );
    assertStatus(res, 201);
    assert(res.data.template.items.length === 5, 'should have 5 items');
    state.importedTemplateId = res.data.template.id;
    pass('POST /checklists/templates/import creates template from CSV');
  });

  await test('POST /checklists/templates/import rejects invalid item_type', async () => {
    const csv = 'sequence,label,item_type\n1,Bad item,checkbox';
    const res = await requestMultipart('POST', '/checklists/templates/import',
      { asset_type_id: state.assetTypeId, name: 'Bad CSV' },
      'file', csv, 'bad.csv', state.companyAdminToken
    );
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_CSV', 'should return INVALID_CSV');
    pass('POST /checklists/templates/import rejects invalid item_type');
  });

  // ── ASSET CHECKLISTS ─────────────────────────────────────────────────────────

  section('CHECKLISTS — ASSET CHECKLISTS');

  await test('POST /checklists/assets/:assetGraphId creates checklist from scratch', async () => {
    const res = await request('POST', `/checklists/assets/${state.assetNodeId}`, {
      asset_type_id: state.assetTypeId,
      name:          'AHU-01 Routine Service',
      description:   'Customised checklist for AHU-01',
      source:        'scratch',
      items: [
        { sequence: 1, label: 'Check inlet filter',           item_type: 'true_false',  is_required: true  },
        { sequence: 2, label: 'Record supply air temp',       item_type: 'measurement', unit: '°C', min_value: 12, max_value: 18, is_required: true  },
        { sequence: 3, label: 'Record runtime hours',         item_type: 'measurement', unit: 'hours', is_required: true, is_runtime_trigger: true },
        { sequence: 4, label: 'Inspect belt tension',         item_type: 'step',        is_required: true  },
        { sequence: 5, label: 'Technician observations',      item_type: 'text',        is_required: false },
        { sequence: 6, label: 'Photo of unit post-service',   item_type: 'photo',       is_required: false },
      ],
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.checklist.id,                     'should return checklist id');
    assert(res.data.checklist.asset_graph_id === state.assetNodeId, 'should link to asset');
    assert(res.data.checklist.items.length === 6,     'should have 6 items');
    const rtItems = res.data.checklist.items.filter(i => i.is_runtime_trigger);
    assert(rtItems.length === 1, 'should have exactly 1 runtime trigger item');
    state.assetChecklistId = res.data.checklist.id;
    // Store item IDs for response tests
    state.checklistItemIds = res.data.checklist.items.map(i => i.id);
    pass('POST /checklists/assets/:assetGraphId creates checklist from scratch');
  });

  await test('POST /checklists/assets/:assetGraphId creates checklist from template', async () => {
    const res = await request('POST', `/checklists/assets/${state.assetNodeId}`, {
      asset_type_id: state.assetTypeId,
      name:          'AHU-01 Emergency Response',
      source:        'template',
      template_id:   state.checklistTemplateId,
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.checklist.source_template_id === state.checklistTemplateId, 'should record source template');
    assert(res.data.checklist.items.length === 7, 'should copy 7 items from template');
    pass('POST /checklists/assets/:assetGraphId creates checklist from template');
  });

  await test('POST /checklists/assets/:assetGraphId versioning on duplicate name', async () => {
    const res = await request('POST', `/checklists/assets/${state.assetNodeId}`, {
      asset_type_id: state.assetTypeId,
      name:  'AHU-01 Routine Service',   // same name — should get v2
      items: [{ sequence: 1, label: 'Quick check', item_type: 'step' }],
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.checklist.name === 'AHU-01 Routine Service v2', 'should be versioned v2');
    pass('POST /checklists/assets/:assetGraphId versioning on duplicate name');
  });

  await test('GET /checklists/assets/:assetGraphId lists all checklists for asset', async () => {
    const res = await request('GET', `/checklists/assets/${state.assetNodeId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.checklists),    'should return array');
    assert(res.data.checklists.length >= 3,       'should have at least 3 checklists');
    pass('GET /checklists/assets/:assetGraphId lists all checklists for asset');
  });

  await test('GET /checklists/assets/:assetGraphId/:id returns checklist with items', async () => {
    const res = await request('GET', `/checklists/assets/${state.assetNodeId}/${state.assetChecklistId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.checklist.id === state.assetChecklistId, 'should return correct checklist');
    assert(Array.isArray(res.data.checklist.items),          'should include items');
    pass('GET /checklists/assets/:assetGraphId/:id returns checklist with items');
  });

  await test('PATCH /checklists/assets/:assetGraphId/:id updates checklist', async () => {
    const res = await request('PATCH', `/checklists/assets/${state.assetNodeId}/${state.assetChecklistId}`, {
      description: 'Updated description for AHU-01 checklist',
    }, state.companyAdminToken);
    assertStatus(res, 200);
    pass('PATCH /checklists/assets/:assetGraphId/:id updates checklist');
  });

  await test('POST /checklists/assets/:assetGraphId/import creates checklist from CSV', async () => {
    const csv = [
      'sequence,label,description,item_type,unit,min_value,max_value,is_required,is_runtime_trigger',
      '1,Filter check,,true_false,,,,true,false',
      '2,Runtime hours,,measurement,hours,,,true,true',
      '3,Lube bearings,,step,,,,true,false',
    ].join('\n');
    const res = await requestMultipart('POST', `/checklists/assets/${state.assetNodeId}/import`,
      { asset_type_id: state.assetTypeId, name: 'AHU-01 CSV Import' },
      'file', csv, 'checklist.csv', state.companyAdminToken
    );
    assertStatus(res, 201);
    assert(res.data.checklist.items.length === 3, 'should have 3 items');
    pass('POST /checklists/assets/:assetGraphId/import creates checklist from CSV');
  });

  await test('GET /checklists/assets/:assetGraphId/:id/export returns CSV', async () => {
    const headers = {};
    if (state.companyAdminToken) headers['Authorization'] = `Bearer ${state.companyAdminToken}`;
    const res = await fetch(`${API_URL}/checklists/assets/${state.assetNodeId}/${state.assetChecklistId}/export`, { headers });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('text/csv'), `Expected text/csv, got ${ct}`);
    const csv = await res.text();
    assert(csv.includes('runtime'), 'CSV should contain runtime trigger item');
    pass('GET /checklists/assets/:assetGraphId/:id/export returns CSV');
  });

  await test('Technician cannot manage asset checklists', async () => {
    if (!state.technicianToken) { skip('technician checklist guard', 'no token'); return; }
    const res = await request('POST', `/checklists/assets/${state.assetNodeId}`, {
      asset_type_id: state.assetTypeId, name: 'Sneaky checklist',
      items: [{ sequence: 1, label: 'Step', item_type: 'step' }],
    }, state.technicianToken);
    assertStatus(res, 403);
    pass('Technician cannot manage asset checklists');
  });

  await test('GET /checklists/templates?asset_type_id= filters templates by asset type', async () => {
    const res = await request('GET', `/checklists/templates?asset_type_id=${state.assetTypeId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.templates), 'should return array');
    assert(res.data.templates.every(t => t.asset_type_id === state.assetTypeId), 'all templates should match asset type');
    pass('GET /checklists/templates?asset_type_id= filters templates by asset type');
  });

  await test('DELETE /checklists/templates/:id deactivates a template', async () => {
    if (!state.importedTemplateId) { skip('deactivate template', 'no importedTemplateId'); return; }
    const res = await request('DELETE', `/checklists/templates/${state.importedTemplateId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.message.includes('deactivated'), 'should confirm deactivation');
    // Confirm it is now inactive
    const getRes = await request('GET', `/checklists/templates/${state.importedTemplateId}`, null, state.companyAdminToken);
    assertStatus(getRes, 200);
    assert(getRes.data.template.is_active === false, 'template should now be inactive');
    pass('DELETE /checklists/templates/:id deactivates a template');
  });

  await test('GET /checklists/templates?is_active=false returns only inactive templates', async () => {
    const res = await request('GET', '/checklists/templates?is_active=false', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.templates), 'should return array');
    assert(res.data.templates.every(t => t.is_active === false), 'all returned templates should be inactive');
    pass('GET /checklists/templates?is_active=false returns only inactive templates');
  });

  await test('DELETE /checklists/assets/:assetGraphId/:id deactivates an asset checklist', async () => {
    // Create a throwaway checklist to deactivate — don't use assetChecklistId (needed for task tests)
    const createRes = await request('POST', `/checklists/assets/${state.assetNodeId}`, {
      asset_type_id: state.assetTypeId,
      name:          'Throwaway Checklist for Delete Test',
      items:         [{ sequence: 1, label: 'Quick check', item_type: 'step' }],
    }, state.companyAdminToken);
    assertStatus(createRes, 201);
    const throwawayId = createRes.data.checklist.id;

    const deleteRes = await request('DELETE', `/checklists/assets/${state.assetNodeId}/${throwawayId}`, null, state.companyAdminToken);
    assertStatus(deleteRes, 200);
    assert(deleteRes.data.message.includes('deactivated'), 'should confirm deactivation');

    // Confirm is_active is now false
    const getRes = await request('GET', `/checklists/assets/${state.assetNodeId}/${throwawayId}`, null, state.companyAdminToken);
    assertStatus(getRes, 200);
    assert(getRes.data.checklist.is_active === false, 'checklist should now be inactive');
    pass('DELETE /checklists/assets/:assetGraphId/:id deactivates an asset checklist');
  });
}

// ─────────────────────────────────────────
// WORK ORDER TASKS
// ─────────────────────────────────────────

async function testWorkOrderTasks() {
  if (!state.companyAdminToken || !state.workOrderId) {
    skip('all work order task tests', 'missing required state');
    return;
  }

  // workOrderId is currently in_progress from the work orders lifecycle tests
  // We'll use assignedWorkOrderId (status: assigned) for the full task lifecycle
  // so that all tasks can still be added (not yet in_progress)

  section('WORK ORDER TASKS — CREATE');

  await test('POST /work-orders/:id/tasks creates a general task', async () => {
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title:                     'Pre-work safety check',
      description:               'Verify isolation and lock-out/tag-out complete',
      task_type:                 'safety_check',
      estimated_duration_minutes: 10,
    }, state.managerToken);
    assertStatus(res, 201);
    assert(res.data.task.id,                   'should return task id');
    assert(res.data.task.status === 'pending', 'new task should be pending');
    assert(res.data.task.sequence === 1,       'first task should be sequence 1');
    state.generalTaskId = res.data.task.id;
    pass('POST /work-orders/:id/tasks creates a general task');
  });

  await test('POST /work-orders/:id/tasks creates a checklist_execution task', async () => {
    if (!state.assetChecklistId) { skip('checklist task', 'no assetChecklistId'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title:             'Execute AHU-01 Routine Checklist',
      task_type:         'checklist_execution',
      asset_checklist_id: state.assetChecklistId,
      estimated_duration_minutes: 45,
    }, state.managerToken);
    assertStatus(res, 201);
    assert(res.data.task.asset_checklist_id === state.assetChecklistId, 'should link to checklist');
    state.checklistTaskId = res.data.task.id;
    pass('POST /work-orders/:id/tasks creates a checklist_execution task');
  });

  await test('POST /work-orders/:id/tasks rejects missing title', async () => {
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      task_type: 'general',
    }, state.managerToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('POST /work-orders/:id/tasks rejects missing title');
  });

  await test('POST /work-orders/:id/tasks rejects invalid task_type', async () => {
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title: 'Bad task', task_type: 'magic',
    }, state.managerToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_TASK_TYPE', 'should return INVALID_TASK_TYPE');
    pass('POST /work-orders/:id/tasks rejects invalid task_type');
  });

  await test('POST /work-orders/:id/tasks rejects checklist_execution without asset_checklist_id', async () => {
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title: 'Missing checklist id', task_type: 'checklist_execution',
    }, state.managerToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('POST /work-orders/:id/tasks rejects checklist_execution without asset_checklist_id');
  });

  await test('Technician cannot create tasks', async () => {
    if (!state.technicianToken) { skip('technician task create', 'no token'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title: 'Sneaky task', task_type: 'general',
    }, state.technicianToken);
    assertStatus(res, 403);
    pass('Technician cannot create tasks');
  });

  section('WORK ORDER TASKS — READ');

  await test('GET /work-orders/:id/tasks returns task list', async () => {
    const res = await request('GET', `/work-orders/${state.assignedWorkOrderId}/tasks`, null, state.managerToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.tasks), 'should return array');
    assert(res.data.tasks.length >= 2,    'should have at least 2 tasks');
    pass('GET /work-orders/:id/tasks returns task list');
  });

  await test('GET /work-orders/:id/tasks/:taskId returns single task', async () => {
    const res = await request('GET', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}`, null, state.managerToken);
    assertStatus(res, 200);
    assert(res.data.task.id === state.generalTaskId, 'should return correct task');
    pass('GET /work-orders/:id/tasks/:taskId returns single task');
  });

  await test('GET /work-orders/:id/tasks/:taskId returns 404 for unknown task', async () => {
    const res = await request('GET', `/work-orders/${state.assignedWorkOrderId}/tasks/00000000-0000-0000-0000-000000000000`, null, state.managerToken);
    assertStatus(res, 404);
    assert(res.data.code === 'NOT_FOUND', 'should return NOT_FOUND');
    pass('GET /work-orders/:id/tasks/:taskId returns 404 for unknown task');
  });

  section('WORK ORDER TASKS — UPDATE');

  await test('PATCH /work-orders/:id/tasks/:taskId updates task fields', async () => {
    const res = await request('PATCH', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}`, {
      title: 'Pre-work safety check (updated)',
      estimated_duration_minutes: 15,
    }, state.managerToken);
    assertStatus(res, 200);
    assert(res.data.task.estimated_duration_minutes === 15, 'duration should be updated');
    pass('PATCH /work-orders/:id/tasks/:taskId updates task fields');
  });

  await test('PATCH /work-orders/:id/tasks/:taskId rejects empty body', async () => {
    const res = await request('PATCH', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}`, {}, state.managerToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('PATCH /work-orders/:id/tasks/:taskId rejects empty body');
  });

  await test('POST /work-orders/:id/tasks creates a skippable task (reading)', async () => {
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title:     'Record panel meter reading',
      task_type: 'reading',
    }, state.managerToken);
    assertStatus(res, 201);
    state.skippableTaskId = res.data.task.id;
    pass('POST /work-orders/:id/tasks creates a skippable task (reading)');
  });

  await test('DELETE /work-orders/:id/tasks/:taskId deletes a pending task', async () => {
    // Create a throwaway task to delete
    const createRes = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks`, {
      title: 'Task to be deleted', task_type: 'general',
    }, state.managerToken);
    assertStatus(createRes, 201);
    const throwawayTaskId = createRes.data.task.id;

    const deleteRes = await request('DELETE', `/work-orders/${state.assignedWorkOrderId}/tasks/${throwawayTaskId}`, null, state.managerToken);
    assertStatus(deleteRes, 200);
    assert(deleteRes.data.message.includes('deleted'), 'should confirm deletion');

    // Confirm it's gone
    const getRes = await request('GET', `/work-orders/${state.assignedWorkOrderId}/tasks/${throwawayTaskId}`, null, state.managerToken);
    assertStatus(getRes, 404);
    pass('DELETE /work-orders/:id/tasks/:taskId deletes a pending task');
  });

  await test('Technician cannot delete tasks', async () => {
    if (!state.technicianToken) { skip('tech delete task guard', 'no token'); return; }
    const res = await request('DELETE', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}`, null, state.technicianToken);
    assertStatus(res, 403);
    pass('Technician cannot delete tasks');
  });

  section('WORK ORDER TASKS — LIFECYCLE');

  // First need to start the WO so technician can work on it
  await test('Start the work order before working on tasks', async () => {
    if (!state.technicianToken) { skip('start WO for tasks', 'no technician token'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/start`, {}, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.work_order.status === 'in_progress', 'WO should be in_progress');
    pass('Start the work order before working on tasks');
  });

  await test('POST /work-orders/:id/tasks/:taskId/start transitions pending → in_progress', async () => {
    if (!state.technicianToken) { skip('start task', 'no token'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}/start`, {}, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.task.status === 'in_progress', 'task should be in_progress');
    assert(res.data.task.started_at, 'started_at should be stamped');
    pass('POST /work-orders/:id/tasks/:taskId/start transitions pending → in_progress');
  });

  await test('POST /work-orders/:id/tasks/:taskId/start rejects invalid transition', async () => {
    // Already in_progress — cannot start again
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}/start`, {}, state.managerToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_TRANSITION', 'should return INVALID_TRANSITION');
    pass('POST /work-orders/:id/tasks/:taskId/start rejects invalid transition');
  });

  await test('POST /work-orders/:id/tasks/:taskId/complete transitions in_progress → completed', async () => {
    if (!state.technicianToken) { skip('complete task', 'no token'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}/complete`, {
      actual_duration_minutes: 12,
    }, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.task.status === 'completed',         'task should be completed');
    assert(res.data.task.completed_at,                   'completed_at should be stamped');
    assert(res.data.task.actual_duration_minutes === 12, 'actual duration should be recorded');
    pass('POST /work-orders/:id/tasks/:taskId/complete transitions in_progress → completed');
  });

  await test('POST /work-orders/:id/tasks/:taskId/skip skips a pending task', async () => {
    if (!state.skippableTaskId || !state.technicianToken) { skip('skip task', 'no skippableTaskId or token'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.skippableTaskId}/skip`, {}, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.task.status === 'skipped',   'task should be skipped');
    assert(res.data.task.completed_at,           'completed_at should be stamped by DB trigger on skip');
    pass('POST /work-orders/:id/tasks/:taskId/skip skips a pending task');
  });

  await test('POST /work-orders/:id/tasks/:taskId/skip rejects already-completed task', async () => {
    // generalTaskId is now completed — cannot skip
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.generalTaskId}/skip`, {}, state.managerToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_TRANSITION', 'should return INVALID_TRANSITION');
    pass('POST /work-orders/:id/tasks/:taskId/skip rejects already-completed task');
  });

  await test('Start checklist task so responses can be submitted', async () => {
    if (!state.checklistTaskId || !state.technicianToken) { skip('start checklist task', 'no state'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/start`, {}, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.task.status === 'in_progress', 'checklist task should be in_progress');
    assert(res.data.task.started_at, 'started_at should be stamped by DB trigger');
    pass('Start checklist task so responses can be submitted');
  });

  section('WORK ORDER TASKS — CHECKLIST RESPONSES');

  await test('GET /work-orders/:id/tasks/:taskId/responses returns items with null responses', async () => {
    if (!state.checklistTaskId) { skip('list responses', 'no checklistTaskId'); return; }
    const res = await request('GET', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, null, state.managerToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.responses),         'should return array');
    assert(res.data.responses.length === 6,           'should have 6 items');
    assert(res.data.responses[0].response_id === null,'no responses yet — should be null');
    pass('GET /work-orders/:id/tasks/:taskId/responses returns items with null responses');
  });

  await test('POST /work-orders/:id/tasks/:taskId/responses submits true_false response', async () => {
    if (!state.checklistTaskId || !state.checklistItemIds.length) { skip('submit true_false', 'no items'); return; }
    // Item 0 is true_false (Check inlet filter)
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[0],
        boolean_value:           true,
        notes:                   'Filter in good condition',
      }],
    }, state.technicianToken);
    assertStatus(res, 201);
    assert(res.data.responses[0].boolean_value === true, 'should record boolean value');
    pass('POST /work-orders/:id/tasks/:taskId/responses submits true_false response');
  });

  await test('POST /work-orders/:id/tasks/:taskId/responses submits measurement response', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 2) { skip('submit measurement', 'no items'); return; }
    // Item 1 is measurement (supply air temp)
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[1],
        numeric_value:           14.5,
      }],
    }, state.technicianToken);
    assertStatus(res, 201);
    assert(parseFloat(res.data.responses[0].numeric_value) === 14.5, 'should record numeric value');
    assert(res.data.responses[0].is_out_of_range === false, 'should not be out of range (12–18°C)');
    pass('POST /work-orders/:id/tasks/:taskId/responses submits measurement response');
  });

  await test('POST /work-orders/:id/tasks/:taskId/responses flags out-of-range measurement', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 3) { skip('out of range', 'no items'); return; }
    // Item 2 is runtime hours — no bounds, use supply temp item with out-of-range value instead
    // Re-submit item 1 with an out-of-range value (upsert)
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[1],
        numeric_value:           25.0,   // above max of 18°C
      }],
    }, state.technicianToken);
    assertStatus(res, 201);
    assert(res.data.responses[0].is_out_of_range === true, 'should flag out of range');
    pass('POST /work-orders/:id/tasks/:taskId/responses flags out-of-range measurement');
  });

  await test('POST responses submits runtime hours (is_runtime_trigger item)', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 3) { skip('runtime response', 'no items'); return; }
    // Item 2 is runtime hours (is_runtime_trigger = true)
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[2],
        numeric_value:           1250,
      }],
    }, state.technicianToken);
    assertStatus(res, 201);
    assert(parseFloat(res.data.responses[0].numeric_value) === 1250, 'should record runtime hours');
    pass('POST responses submits runtime hours (is_runtime_trigger item)');
  });

  await test('POST responses rejects wrong type (boolean for measurement item)', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 2) { skip('type mismatch', 'no items'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[1],
        boolean_value:           true,   // item is measurement, not true_false
      }],
    }, state.technicianToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('POST responses rejects wrong type (boolean for measurement item)');
  });

  await test('GET responses returns updated values after submissions', async () => {
    if (!state.checklistTaskId) { skip('get responses after submit', 'no task'); return; }
    const res = await request('GET', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, null, state.managerToken);
    assertStatus(res, 200);
    const responded = res.data.responses.filter(r => r.response_id !== null);
    assert(responded.length >= 3, 'should have at least 3 responses recorded');
    pass('GET responses returns updated values after submissions');
  });

  await test('POST /work-orders/:id/tasks/:taskId/complete rejects task with unanswered required items', async () => {
    if (!state.checklistTaskId || !state.technicianToken) { skip('INCOMPLETE_CHECKLIST guard', 'no state'); return; }
    // Required items: 0 (true_false ✓), 1 (measurement ✓), 2 (runtime hours ✓), 3 (step — not yet submitted)
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/complete`, {}, state.technicianToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INCOMPLETE_CHECKLIST', `should return INCOMPLETE_CHECKLIST, got ${res.data.code}`);
    pass('POST /work-orders/:id/tasks/:taskId/complete rejects task with unanswered required items');
  });

  await test('POST responses submits step response (item 3 — required)', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 4) { skip('step response', 'no items'); return; }
    // Item 3 is step (Inspect belt tension) — is_required: true
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[3],
        boolean_value:           true,
      }],
    }, state.technicianToken);
    assertStatus(res, 201);
    assert(res.data.responses[0].boolean_value === true, 'step should record boolean true');
    pass('POST responses submits step response (item 3 — required)');
  });

  await test('POST responses upserts existing response (re-submit item 1 with corrected value)', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 2) { skip('upsert response', 'no items'); return; }
    // Re-submit item 1 (supply air temp) with corrected in-range value — should update, not create duplicate
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[1],
        numeric_value:           15.2,   // back in range (12–18°C)
        notes:                   'Corrected reading',
      }],
    }, state.technicianToken);
    assertStatus(res, 201);
    assert(parseFloat(res.data.responses[0].numeric_value) === 15.2, 'should update to corrected value');
    assert(res.data.responses[0].is_out_of_range === false, 'corrected value should not be out of range');
    pass('POST responses upserts existing response (re-submit item 1 with corrected value)');
  });

  await test('DELETE /work-orders/:id/tasks/:taskId/responses/:responseId deletes a response', async () => {
    if (!state.checklistTaskId || state.checklistItemIds.length < 5) { skip('delete response', 'not enough items'); return; }
    // Submit a non-required response (item 4 — text, is_required: false) then delete it
    const submitRes = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses`, {
      responses: [{
        asset_checklist_item_id: state.checklistItemIds[4],
        text_value:              'Some observation to delete',
      }],
    }, state.technicianToken);
    assertStatus(submitRes, 201);
    const responseId = submitRes.data.responses[0].id;

    const deleteRes = await request('DELETE', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/responses/${responseId}`, null, state.technicianToken);
    assertStatus(deleteRes, 200);
    assert(deleteRes.data.message.includes('deleted'), 'should confirm deletion');
    pass('DELETE /work-orders/:id/tasks/:taskId/responses/:responseId deletes a response');
  });

  // Complete the checklist task and close the main WO via the normal happy path
  await test('POST /work-orders/:id/tasks/:taskId/complete completes the checklist task', async () => {
    if (!state.checklistTaskId || !state.technicianToken) { skip('complete checklist task', 'no state'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/tasks/${state.checklistTaskId}/complete`, {
      actual_duration_minutes: 40,
    }, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.task.status === 'completed', 'checklist task should be completed');
    pass('POST /work-orders/:id/tasks/:taskId/complete completes the checklist task');
  });

  await test('WO can complete once all tasks are completed or skipped', async () => {
    if (!state.technicianToken) { skip('complete WO after tasks', 'no token'); return; }
    const res = await request('POST', `/work-orders/${state.assignedWorkOrderId}/complete`, {
      actual_duration_minutes: 55,
    }, state.technicianToken);
    assertStatus(res, 200);
    assert(res.data.work_order.status === 'completed', 'WO should now be completed');
    assert(res.data.work_order.completed_at,           'completed_at should be stamped');
    pass('WO can complete once all tasks are completed or skipped');
  });

  section('WORK ORDER TASKS — WO COMPLETION ENFORCEMENT');

  // Use a separate WO with a pending task to prove WOs close regardless of task state.
  // A new WO is created so the main assignedWorkOrderId is not polluted.
  await test('WO can complete even while tasks are still pending/in_progress', async () => {
    if (!state.managerToken || !state.technicianUserId || !state.assetNodeId) {
      skip('WO completion enforcement test', 'no state'); return;
    }
    // Create a fresh WO with one pending task
    const createRes = await request('POST', '/work-orders', {
      title:          'Enforcement test WO — close with open task',
      type:           'corrective',
      priority:       'low',
      asset_graph_id: state.assetNodeId,
      assigned_to:    state.technicianUserId,
    }, state.managerToken);
    assertStatus(createRes, 201);
    const enfWoId = createRes.data.work_order.id;

    // Add a general task and leave it pending
    const taskRes = await request('POST', `/work-orders/${enfWoId}/tasks`, {
      title:     'Incomplete task — should not block WO closure',
      task_type: 'general',
    }, state.managerToken);
    assertStatus(taskRes, 201);
    assert(taskRes.data.task.status === 'pending', 'task should start pending');

    // Start the WO then close it without touching the task
    await request('POST', `/work-orders/${enfWoId}/start`, {}, state.technicianToken);
    const completeRes = await request('POST', `/work-orders/${enfWoId}/complete`, {
      notes: 'Closing without completing task — policy allows this',
    }, state.technicianToken);
    assertStatus(completeRes, 200);
    assert(completeRes.data.work_order.status === 'completed', 'WO should be completed despite pending task');
    pass('WO can complete even while tasks are still pending/in_progress');
  });
}


// ─────────────────────────────────────────
// PM SCHEDULES
// ─────────────────────────────────────────

async function testPMSchedules() {
  if (!state.companyAdminToken || !state.assetTypeId || !state.assetNodeId) {
    skip('all PM schedule tests', 'missing required state');
    return;
  }

  section('PM SCHEDULES — TRIGGER TYPES');

  let calendarMonthlyId = null;
  let calendarWeeklyId  = null;
  let calendarYearlyId  = null;
  let runtimeHoursId    = null;

  await test('GET /pm/trigger-types returns seeded trigger types', async () => {
    const res = await request('GET', '/pm/trigger-types', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.trigger_types), 'should return array');
    assert(res.data.trigger_types.length === 7, 'should have 7 seeded trigger types');

    const codes = res.data.trigger_types.map(t => t.code);
    assert(codes.includes('calendar_daily'),   'should have calendar_daily');
    assert(codes.includes('calendar_weekly'),  'should have calendar_weekly');
    assert(codes.includes('calendar_monthly'), 'should have calendar_monthly');
    assert(codes.includes('calendar_yearly'),  'should have calendar_yearly');
    assert(codes.includes('runtime_hours'),    'should have runtime_hours');
    assert(codes.includes('runtime_kms'),      'should have runtime_kms');
    assert(codes.includes('runtime_cycles'),   'should have runtime_cycles');

    calendarMonthlyId = res.data.trigger_types.find(t => t.code === 'calendar_monthly').id;
    calendarWeeklyId  = res.data.trigger_types.find(t => t.code === 'calendar_weekly').id;
    calendarYearlyId  = res.data.trigger_types.find(t => t.code === 'calendar_yearly').id;
    runtimeHoursId    = res.data.trigger_types.find(t => t.code === 'runtime_hours').id;

    pass('GET /pm/trigger-types returns seeded trigger types');
  });

  if (!calendarMonthlyId) { skip('remaining PM tests', 'could not load trigger types'); return; }

  section('PM SCHEDULES — CREATE');

  let quarterlyScheduleId = null;
  let weeklyScheduleId    = null;
  let runtimeScheduleId   = null;
  let yearlyScheduleId    = null;

  await test('POST /pm/schedules creates a quarterly calendar schedule', async () => {
    const today = new Date();
    const starts = new Date(today);
    starts.setDate(1); // first of this month
    const startsStr = starts.toISOString().split('T')[0];

    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'AHU-01 Quarterly Service',
      work_type:       'Service',
      trigger_type_id: calendarMonthlyId,
      interval_value:  3,
      starts_on:       startsStr,
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(res.data.schedule.id,                    'should return schedule id');
    assert(res.data.schedule.interval_value === 3,  'should have interval_value 3');
    assert(res.data.schedule.is_active === true,    'should be active');
    quarterlyScheduleId = res.data.schedule.id;
    state.pmScheduleId  = res.data.schedule.id;
    pass('POST /pm/schedules creates a quarterly calendar schedule');
  });

  await test('POST /pm/schedules creates a weekly inspection schedule', async () => {
    const today = new Date();
    const startsStr = today.toISOString().split('T')[0];

    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'AHU-01 Weekly Inspection',
      work_type:       'Inspection',
      trigger_type_id: calendarWeeklyId,
      interval_value:  1,
      starts_on:       startsStr,
    }, state.companyAdminToken);
    assertStatus(res, 201);
    weeklyScheduleId = res.data.schedule.id;
    pass('POST /pm/schedules creates a weekly inspection schedule');
  });

  await test('POST /pm/schedules creates a yearly overhaul schedule', async () => {
    const today = new Date();
    const startsStr = today.toISOString().split('T')[0];

    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'AHU-01 Annual Overhaul',
      work_type:       'Overhaul',
      trigger_type_id: calendarYearlyId,
      interval_value:  1,
      starts_on:       startsStr,
    }, state.companyAdminToken);
    assertStatus(res, 201);
    yearlyScheduleId = res.data.schedule.id;
    pass('POST /pm/schedules creates a yearly overhaul schedule');
  });

  await test('POST /pm/schedules creates a runtime hours schedule (informational)', async () => {
    const today = new Date();
    const startsStr = today.toISOString().split('T')[0];

    // Use the runtime trigger item from the asset checklist if we have it
    const runtimeItemId = state.checklistItemIds.length >= 3
      ? state.checklistItemIds[2]  // index 2 = runtime hours item
      : null;

    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:             state.assetNodeId,
      asset_type_id:              state.assetTypeId,
      name:                       'AHU-01 Runtime Hours Alert',
      work_type:                  'Service',
      trigger_type_id:            runtimeHoursId,
      runtime_threshold:          500,
      runtime_checklist_item_id:  runtimeItemId,
      starts_on:                  startsStr,
    }, state.companyAdminToken);
    assertStatus(res, 201);
    assert(parseFloat(res.data.schedule.runtime_threshold) === 500, 'should store runtime threshold');
    runtimeScheduleId = res.data.schedule.id;
    pass('POST /pm/schedules creates a runtime hours schedule (informational)');
  });

  await test('POST /pm/schedules rejects calendar schedule without interval_value', async () => {
    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'Bad Schedule',
      work_type:       'Service',
      trigger_type_id: calendarMonthlyId,
      starts_on:       '2026-01-01',
      // missing interval_value
    }, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('POST /pm/schedules rejects calendar schedule without interval_value');
  });

  await test('POST /pm/schedules rejects runtime schedule without runtime_threshold', async () => {
    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'Bad Runtime Schedule',
      work_type:       'Service',
      trigger_type_id: runtimeHoursId,
      starts_on:       '2026-01-01',
      // missing runtime_threshold
    }, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('POST /pm/schedules rejects runtime schedule without runtime_threshold');
  });

  await test('POST /pm/schedules rejects invalid work_type', async () => {
    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'Bad Work Type',
      work_type:       'Polish',
      trigger_type_id: calendarMonthlyId,
      interval_value:  1,
      starts_on:       '2026-01-01',
    }, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_WORK_TYPE', 'should return INVALID_WORK_TYPE');
    pass('POST /pm/schedules rejects invalid work_type');
  });

  await test('Technician cannot create PM schedules', async () => {
    if (!state.technicianToken) { skip('technician PM guard', 'no token'); return; }
    const res = await request('POST', '/pm/schedules', {
      asset_graph_id:  state.assetNodeId,
      asset_type_id:   state.assetTypeId,
      name:            'Sneaky schedule',
      work_type:       'Service',
      trigger_type_id: calendarMonthlyId,
      interval_value:  1,
      starts_on:       '2026-01-01',
    }, state.technicianToken);
    assertStatus(res, 403);
    pass('Technician cannot create PM schedules');
  });

  section('PM SCHEDULES — READ');

  await test('GET /pm/schedules returns schedule list', async () => {
    const res = await request('GET', '/pm/schedules', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.schedules), 'should return array');
    assert(res.data.schedules.length >= 4, 'should have at least 4 schedules');
    pass('GET /pm/schedules returns schedule list');
  });

  await test('GET /pm/schedules?asset_graph_id= filters by asset', async () => {
    const res = await request('GET', `/pm/schedules?asset_graph_id=${state.assetNodeId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.schedules.every(s => s.asset_graph_id === state.assetNodeId), 'all should match asset');
    pass('GET /pm/schedules?asset_graph_id= filters by asset');
  });

  await test('GET /pm/schedules/:id returns schedule with upcoming WOs', async () => {
    const res = await request('GET', `/pm/schedules/${quarterlyScheduleId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.schedule.id === quarterlyScheduleId, 'should return correct schedule');
    assert(res.data.schedule.trigger_type_code === 'calendar_monthly', 'should include trigger code');
    assert(Array.isArray(res.data.schedule.upcoming_work_orders), 'should include upcoming WOs array');
    pass('GET /pm/schedules/:id returns schedule with upcoming WOs');
  });

  await test('GET /pm/schedules/:id returns 404 for unknown schedule', async () => {
    const res = await request('GET', '/pm/schedules/00000000-0000-0000-0000-000000000000', null, state.companyAdminToken);
    assertStatus(res, 404);
    assert(res.data.code === 'NOT_FOUND', 'should return NOT_FOUND');
    pass('GET /pm/schedules/:id returns 404 for unknown schedule');
  });

  section('PM SCHEDULES — UPDATE');

  await test('PATCH /pm/schedules/:id updates schedule fields', async () => {
    const res = await request('PATCH', `/pm/schedules/${quarterlyScheduleId}`, {
      name: 'AHU-01 Quarterly Service (Updated)',
    }, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.schedule.name === 'AHU-01 Quarterly Service (Updated)', 'name should be updated');
    pass('PATCH /pm/schedules/:id updates schedule fields');
  });

  await test('PATCH /pm/schedules/:id rejects empty body', async () => {
    const res = await request('PATCH', `/pm/schedules/${quarterlyScheduleId}`, {}, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'VALIDATION_ERROR', 'should return VALIDATION_ERROR');
    pass('PATCH /pm/schedules/:id rejects empty body');
  });

  section('PM SCHEDULES — WO GENERATION');

  await test('POST /pm/schedules/:id/generate generates WOs for 12 months', async () => {
    const res = await request('POST', `/pm/schedules/${quarterlyScheduleId}/generate`, {}, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.result.generated >= 3, 'quarterly over 12 months should generate at least 3 WOs');
    assert(res.data.result.errors.length === 0, 'should have no errors');
    pass('POST /pm/schedules/:id/generate generates WOs for 12 months');
  });

  await test('POST /pm/schedules/:id/generate is idempotent — no duplicates on re-run', async () => {
    // Record WO count before re-run
    const beforeRes = await request('GET', `/pm/schedules/${quarterlyScheduleId}/work-orders`, null, state.companyAdminToken);
    assertStatus(beforeRes, 200);
    const countBefore = beforeRes.data.work_orders.length;

    // Run generation again
    const res = await request('POST', `/pm/schedules/${quarterlyScheduleId}/generate`, {}, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.result.generated === 0, 'second run should generate 0 new WOs');

    // WO count must not have grown
    const afterRes = await request('GET', `/pm/schedules/${quarterlyScheduleId}/work-orders`, null, state.companyAdminToken);
    assertStatus(afterRes, 200);
    assert(afterRes.data.work_orders.length === countBefore, 'WO count must not increase on re-run');
    pass('POST /pm/schedules/:id/generate is idempotent — no duplicates on re-run');
  });

  await test('GET /pm/schedules/:id/work-orders lists generated WOs', async () => {
    const res = await request('GET', `/pm/schedules/${quarterlyScheduleId}/work-orders`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.work_orders), 'should return array');
    assert(res.data.work_orders.length >= 3,    'should have generated WOs');

    // Verify WO title format: "Service - Air Handling Unit - MMM YYYY"
    const wo = res.data.work_orders[0];
    assert(wo.title.startsWith('Service - '), `WO title should start with work_type. Got: ${wo.title}`);
    assert(wo.status === 'open', 'generated WOs should be open');
    pass('GET /pm/schedules/:id/work-orders lists generated WOs');
  });

  await test('Generated WOs have checklist_execution tasks for each asset checklist', async () => {
    // Get the first generated WO
    const listRes = await request('GET', `/pm/schedules/${quarterlyScheduleId}/work-orders`, null, state.companyAdminToken);
    assertStatus(listRes, 200);
    assert(listRes.data.work_orders.length > 0, 'should have generated WOs');

    const firstWoId = listRes.data.work_orders[0].work_order_id;
    const tasksRes  = await request('GET', `/work-orders/${firstWoId}/tasks`, null, state.companyAdminToken);
    assertStatus(tasksRes, 200);

    // Asset has multiple checklists — should have one task per active checklist
    const checklistTasks = tasksRes.data.tasks.filter(t => t.task_type === 'checklist_execution');
    assert(checklistTasks.length >= 1, 'should have at least one checklist_execution task');
    assert(checklistTasks.every(t => t.asset_checklist_id !== null), 'all checklist tasks should have asset_checklist_id');
    pass('Generated WOs have checklist_execution tasks for each asset checklist');
  });

  await test('POST /pm/run runs scheduler across all active schedules', async () => {
    // Generate weekly schedule WOs via the full run endpoint
    const res = await request('POST', '/pm/run', {}, state.companyAdminToken);
    assertStatus(res, 200);
    assert(typeof res.data.summary.schedules === 'number',        'should report schedule count');
    assert(typeof res.data.summary.total_generated === 'number',  'should report total generated');
    assert(typeof res.data.summary.total_skipped   === 'number',  'should report total skipped');
    // Weekly schedule should have generated WOs (52 weeks in 12 months)
    const weeklySummary = res.data.summary.results.find(r => r.schedule_id === weeklyScheduleId);
    if (weeklySummary) {
      assert(weeklySummary.generated >= 50, `weekly should generate ~52 WOs, got ${weeklySummary.generated}`);
    }
    pass('POST /pm/run runs scheduler across all active schedules');
  });

  await test('POST /pm/schedules/:id/generate rejects inactive schedule', async () => {
    // Deactivate a schedule first
    await request('DELETE', `/pm/schedules/${yearlyScheduleId}`, null, state.companyAdminToken);
    const res = await request('POST', `/pm/schedules/${yearlyScheduleId}/generate`, {}, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_OPERATION', 'should return INVALID_OPERATION');
    pass('POST /pm/schedules/:id/generate rejects inactive schedule');
  });

  await test('POST /pm/schedules/:id/generate rejects runtime schedule', async () => {
    const res = await request('POST', `/pm/schedules/${runtimeScheduleId}/generate`, {}, state.companyAdminToken);
    assertStatus(res, 400);
    assert(res.data.code === 'INVALID_OPERATION', 'should return INVALID_OPERATION');
    pass('POST /pm/schedules/:id/generate rejects runtime schedule');
  });

  section('PM SCHEDULES — DEACTIVATE');

  await test('DELETE /pm/schedules/:id deactivates schedule', async () => {
    const res = await request('DELETE', `/pm/schedules/${quarterlyScheduleId}`, null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(res.data.message.includes('deactivated'), 'should confirm deactivation');
    pass('DELETE /pm/schedules/:id deactivates schedule');
  });

  await test('GET /pm/schedules?is_active=false shows deactivated schedules', async () => {
    const res = await request('GET', '/pm/schedules?is_active=false', null, state.companyAdminToken);
    assertStatus(res, 200);
    assert(Array.isArray(res.data.schedules), 'should return array');
    assert(res.data.schedules.every(s => s.is_active === false), 'all should be inactive');
    pass('GET /pm/schedules?is_active=false shows deactivated schedules');
  });
}

// ─────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────

async function testCleanup() {
  section('CLEANUP');

  const nodesToDelete = [
    ['component', state.componentNodeId],
    ['asset',     state.assetNodeId],
    ['system',    state.systemNodeId],
    ['space',     state.spaceNodeId],
    ['floor',     state.floorNodeId],
    ['building',  state.buildingNodeId],
    ['site',      state.siteNodeId],
  ];

  for (const [label, nodeId] of nodesToDelete) {
    if (nodeId && state.companyAdminToken) {
      await test(`DELETE /assets/${label} node`, async () => {
        const res = await request('DELETE', `/assets/${nodeId}`, null, state.companyAdminToken);
        assertStatus(res, 200, `delete ${label}`);
        pass(`DELETE /assets/${label} node`);
      });
    }
  }

  if (state.managerUserId && state.adminToken) {
    await test('DELETE /users/:id deactivates manager', async () => {
      const res = await request('DELETE', `/users/${state.managerUserId}`, null, state.adminToken);
      assertStatus(res, 200);
      pass('DELETE /users/:id deactivates manager');
    });
  }

  if (state.testUserId && state.adminToken) {
    await test('DELETE /users/:id deactivates company admin', async () => {
      const res = await request('DELETE', `/users/${state.testUserId}`, null, state.adminToken);
      assertStatus(res, 200);
      pass('DELETE /users/:id deactivates company admin');
    });
  }

  if (state.adminToken) {
    await test('POST /auth/logout revokes session', async () => {
      const res = await request('POST', '/auth/logout', null, state.adminToken);
      assertStatus(res, 200);
      const meRes = await request('GET', '/auth/me', null, state.adminToken);
      assertStatus(meRes, 401, 'token should be revoked');
      pass('POST /auth/logout revokes session');
    });
  }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log(bold(`\nMMS API Test Harness`));
  console.log(`Target:  ${cyan(API_URL)}`);
  console.log(`Started: ${new Date().toISOString()}`);

  await testHealth();
  await testAuth();
  await testCompanies();
  await testUsers();
  await testAssetTypes();
  await testAssetGraph();
  await testWorkOrders();
  await testChecklists();
  await testWorkOrderTasks();
  await testPMSchedules();
  await testCleanup();

  console.log(`\n${cyan('━'.repeat(55))}`);
  console.log(bold('  RESULTS'));
  console.log(`${cyan('━'.repeat(55))}`);
  console.log(`  ${green('Passed:')}  ${results.passed}`);
  console.log(`  ${red('Failed:')}  ${results.failed}`);
  console.log(`  ${yellow('Skipped:')} ${results.skipped}`);

  if (results.errors.length > 0) {
    console.log(`\n${bold(red('  FAILURES:'))}`);
    for (const err of results.errors) {
      console.log(`  ${red('✗')} ${err.name}`);
      console.log(`    ${err.reason}`);
    }
  }

  const total = results.passed + results.failed;
  const pct   = total > 0 ? Math.round((results.passed / total) * 100) : 0;
  console.log(`\n  ${bold(`${pct}% pass rate`)} (${results.passed}/${total})`);
  console.log();

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(red('\nFatal error:'), err);
  process.exit(1);
});
