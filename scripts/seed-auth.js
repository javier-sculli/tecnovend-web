// Seed idempotente de organización + usuarios con rol.
// Uso:
//   node scripts/seed-auth.js
// Editá ORG y USERS abajo y volvé a correrlo cuantas veces quieras: no duplica.
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/src/services/auth.js';

const dbPath = process.env.DATABASE_URL || './server/tecnovend.db';
const db = new DatabaseSync(dbPath);

const ORG = { name: 'Tecnovend' };

// role: 'administrador' | 'operativo'
const USERS = [
  { name: 'Javier Sculli', email: 'javier.sculli@gmail.com', password: '123456', role: 'administrador' },
  { name: 'Pablo', email: 'pablo.tecnovend@gmail.com', password: '123456', role: 'administrador' },
];

function genId(prefix) { return prefix + crypto.randomBytes(3).toString('hex'); }

// Org (clients): por nombre. Si ya existe, la reusamos.
let org = db.prepare('SELECT id FROM clients WHERE name = ?').get(ORG.name);
if (!org) {
  const id = genId('cli_');
  db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, ORG.name);
  org = { id };
  console.log(`✓ Org creada: ${ORG.name} (${id})`);
} else {
  console.log(`· Org ya existe: ${ORG.name} (${org.id})`);
}

for (const u of USERS) {
  const email = u.email.trim().toLowerCase();
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    const id = genId('usr_');
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)')
      .run(id, u.name, email, hashPassword(u.password));
    user = { id };
    console.log(`✓ Usuario creado: ${u.name} <${email}>`);
  } else {
    console.log(`· Usuario ya existe: ${email}`);
  }

  const m = db.prepare('SELECT id, role FROM memberships WHERE user_id = ? AND client_id = ?').get(user.id, org.id);
  if (!m) {
    db.prepare('INSERT INTO memberships (id, user_id, client_id, role) VALUES (?,?,?,?)')
      .run(genId('mem_'), user.id, org.id, u.role);
    console.log(`  ↳ membresía ${u.role} en ${ORG.name}`);
  } else if (m.role !== u.role) {
    db.prepare('UPDATE memberships SET role = ? WHERE id = ?').run(u.role, m.id);
    console.log(`  ↳ rol actualizado a ${u.role} en ${ORG.name}`);
  } else {
    console.log(`  ↳ ya es ${m.role} en ${ORG.name}`);
  }
}

// Conveniencia para el demo local: las máquinas sin organización quedan en la
// primera org del seed, así la lista no aparece vacía. (No toca máquinas que ya
// tengan client_id.)
const orphan = db.prepare('UPDATE machines SET client_id = ? WHERE client_id IS NULL').run(org.id);
if (orphan.changes > 0) console.log(`↳ ${orphan.changes} máquina(s) sin org asignadas a ${ORG.name}`);

console.log('Seed completo.');
