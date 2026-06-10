import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';

const router = Router();

function genClientId() {
  return 'cli_' + crypto.randomBytes(3).toString('hex');
}

// Listado de clientes + cantidad de máquinas vinculadas
router.get('/', (req, res) => {
  const clients = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM machines m WHERE m.client_id = c.id) AS machine_count
    FROM clients c
    ORDER BY c.created_at DESC
  `).all();
  res.json(clients);
});

// Crear cliente
router.post('/', (req, res) => {
  const {
    name, contact_name, contact_email, contact_phone, notes,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name es requerido' });

  const id = genClientId();
  db.prepare(`
    INSERT INTO clients
      (id, name, contact_name, contact_email, contact_phone, notes)
    VALUES (?,?,?,?,?,?)
  `).run(
    id, name, contact_name ?? null, contact_email ?? null, contact_phone ?? null, notes ?? null,
  );
  res.status(201).json({ id });
});

// Detalle de cliente + sus máquinas
router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  const machines = db.prepare(
    'SELECT id, name, location, status, last_seen_at FROM machines WHERE client_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json({ ...client, machines });
});

// Actualizar cliente (datos de contacto, notas, etc.)
router.put('/:id', (req, res) => {
  const {
    name, contact_name, contact_email, contact_phone, notes,
  } = req.body || {};
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  db.prepare(`
    UPDATE clients SET
      name          = COALESCE(?, name),
      contact_name  = COALESCE(?, contact_name),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      notes         = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    name ?? null, contact_name ?? null, contact_email ?? null, contact_phone ?? null, notes ?? null,
    req.params.id,
  );
  res.json({ ok: true });
});

export default router;
