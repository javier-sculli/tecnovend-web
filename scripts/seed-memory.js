import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/src/services/auth.js';

const dbPath = process.env.DATABASE_URL || './server/tecnovend.db';
const db = new DatabaseSync(dbPath);

const ORG = { name: 'Memory Vending' };

const USERS = [
  { name: 'Memory Vending', email: 'memory.vending@gmail.com', password: '123456', role: 'administrador' }
];

function genId(prefix) { return prefix + crypto.randomBytes(3).toString('hex'); }

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

console.log('Seed completo.');
