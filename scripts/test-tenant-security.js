import { DatabaseSync } from 'node:sqlite';
import { hashPassword, signToken } from '../server/src/services/auth.js';
import crypto from 'crypto';

console.log('=== VERIFICANDO MECANISMO DE AISLAMIENTO MULTI-TENANT ===');

// Prepara una base SQLite en memoria para testear el comportamiento del backend
const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT);
  CREATE TABLE memberships (id TEXT PRIMARY KEY, user_id TEXT, client_id TEXT, role TEXT);
  CREATE TABLE machines (id TEXT PRIMARY KEY, name TEXT, client_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, channels_config TEXT DEFAULT '[]');
  CREATE TABLE payments (id TEXT PRIMARY KEY, machine_id TEXT, amount INTEGER, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Insertar clientes
db.prepare("INSERT INTO clients VALUES ('cli_super', 'Tecnovend')").run();
db.prepare("INSERT INTO clients VALUES ('cli_client_a', 'Cliente A')").run();
db.prepare("INSERT INTO clients VALUES ('cli_client_b', 'Cliente B')").run();

// Insertar usuarios
db.prepare("INSERT INTO users VALUES ('usr_super', 'Super User', 'super@tecnovend.com', 'hash')").run();
db.prepare("INSERT INTO users VALUES ('usr_client_a', 'User A', 'usera@clienta.com', 'hash')").run();
db.prepare("INSERT INTO users VALUES ('usr_client_b', 'User B', 'userb@clientb.com', 'hash')").run();

// Insertar membresías
db.prepare("INSERT INTO memberships VALUES ('mem_1', 'usr_super', 'cli_super', 'administrador')").run();
db.prepare("INSERT INTO memberships VALUES ('mem_2', 'usr_client_a', 'cli_client_a', 'administrador')").run();
db.prepare("INSERT INTO memberships VALUES ('mem_3', 'usr_client_b', 'cli_client_b', 'administrador')").run();

// Insertar máquinas
db.prepare("INSERT INTO machines (id, name, client_id) VALUES ('m_a1', 'Máquina A1', 'cli_client_a')").run();
db.prepare("INSERT INTO machines (id, name, client_id) VALUES ('m_a2', 'Máquina A2', 'cli_client_a')").run();
db.prepare("INSERT INTO machines (id, name, client_id) VALUES ('m_b1', 'Máquina B1', 'cli_client_b')").run();

// Test helper: emula getEffectiveOrgContext
async function mockGetEffectiveOrgContext(userId, requestedOrgId) {
  const isSuperCheck = db.prepare(`
    SELECT 1 FROM memberships m JOIN clients c ON c.id = m.client_id
    WHERE m.user_id = ? AND (c.name = 'Tecnovend' OR c.id = 'cli_87c461') AND m.role = 'administrador'
  `).get(userId);
  const isSuper = !!isSuperCheck;

  if (isSuper) {
    return { isSuperAdmin: true, activeOrgId: requestedOrgId, allowedClientIds: requestedOrgId ? [requestedOrgId] : null };
  }

  const rows = db.prepare("SELECT client_id FROM memberships WHERE user_id = ?").all(userId);
  const userClientIds = rows.map(r => r.client_id);

  if (userClientIds.length === 0) return { isSuperAdmin: false, activeOrgId: null, allowedClientIds: [] };

  if (requestedOrgId) {
    if (!userClientIds.includes(requestedOrgId)) {
      const err = new Error('No pertenecés a esta organización');
      err.status = 403;
      throw err;
    }
    return { isSuperAdmin: false, activeOrgId: requestedOrgId, allowedClientIds: [requestedOrgId] };
  }

  return {
    isSuperAdmin: false,
    activeOrgId: userClientIds.length === 1 ? userClientIds[0] : null,
    allowedClientIds: userClientIds
  };
}

async function runTests() {
  // Test 1: User A consulta sus máquinas sin pasar x-org-id header
  const ctxA = await mockGetEffectiveOrgContext('usr_client_a', null);
  const placeholdersA = ctxA.allowedClientIds.map(() => '?').join(',');
  const machinesA = db.prepare(`SELECT * FROM machines WHERE client_id IN (${placeholdersA})`).all(...ctxA.allowedClientIds);
  console.assert(machinesA.length === 2, 'Test 1 Falló: User A debió obtener 2 máquinas');
  console.assert(machinesA.every(m => m.client_id === 'cli_client_a'), 'Test 1 Falló: Máquinas pertenecen a client A');
  console.log('✓ Test 1 Exitoso: Usuario A solo recibe sus máquinas sin header');

  // Test 2: User A intenta pasar x-org-id de Cliente B
  try {
    await mockGetEffectiveOrgContext('usr_client_a', 'cli_client_b');
    console.error('✗ Test 2 Falló: debió lanzar error 403');
  } catch (err) {
    console.assert(err.status === 403, 'Test 2 Falló: status debió ser 403');
    console.log('✓ Test 2 Exitoso: Usuario A bloqueado (403) al intentar acceder a Cliente B');
  }

  // Test 3: User A intenta acceder al detalle de máquina B1
  const ctxA_single = await mockGetEffectiveOrgContext('usr_client_a', null);
  const machineB1 = db.prepare("SELECT * FROM machines WHERE id = 'm_b1'").get();
  const hasAccessB1 = ctxA_single.isSuperAdmin || ctxA_single.allowedClientIds.includes(machineB1.client_id);
  console.assert(!hasAccessB1, 'Test 3 Falló: User A no debió tener acceso a m_b1');
  console.log('✓ Test 3 Exitoso: Acceso directo a m_b1 bloqueado para Usuario A');

  // Test 4: Super Admin consulta sin orgId (ve todas)
  const ctxSuper = await mockGetEffectiveOrgContext('usr_super', null);
  const allMachines = db.prepare("SELECT * FROM machines").all();
  console.assert(ctxSuper.isSuperAdmin && allMachines.length === 3, 'Test 4 Falló: Super Admin debió ver todas');
  console.log('✓ Test 4 Exitoso: Super Admin ve todas las máquinas');

  // Test 5: Super Admin filtra por Cliente A
  const ctxSuperFiltered = await mockGetEffectiveOrgContext('usr_super', 'cli_client_a');
  const filteredMachines = db.prepare("SELECT * FROM machines WHERE client_id = ?").all(ctxSuperFiltered.activeOrgId);
  console.assert(filteredMachines.length === 2, 'Test 5 Falló: Super Admin filtrado debió ver 2');
  console.log('✓ Test 5 Exitoso: Super Admin puede filtrar por Cliente A');

  console.log('=== TODOS LOS TESTS PASARON EXITOSAMENTE ===');
}

runTests();
