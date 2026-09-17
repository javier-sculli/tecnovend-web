import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { getEffectiveOrgContext } from '../middleware/auth.js';
import { invalidateClientDiscountConfigCache } from '../services/employee-discounts.js';

const router = Router();

function genEmpId() {
  return 'emp_' + crypto.randomBytes(6).toString('hex');
}

// Resolver cliente activo
async function getOrgId(req, res) {
  const ctx = await getEffectiveOrgContext(req);
  const clientId = ctx.activeOrgId || (ctx.allowedClientIds && ctx.allowedClientIds[0]);
  if (!clientId) {
    res.status(400).json({ error: 'Seleccioná una organización activa' });
    return null;
  }
  return clientId;
}

// GET /config
router.get('/config', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    const row = await db.prepare(`
      SELECT employee_discounts_enabled, default_discount_pct 
      FROM clients WHERE id = ?
    `).get(clientId);

    res.json({
      enabled: Boolean(row?.employee_discounts_enabled),
      defaultDiscountPct: row?.default_discount_pct ?? 20,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /config
router.put('/config', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    const { defaultDiscountPct } = req.body;
    const pct = Math.max(1, Math.min(100, Number(defaultDiscountPct) || 20));

    await db.prepare(`
      UPDATE clients SET default_discount_pct = ? WHERE id = ?
    `).run(pct, clientId);

    invalidateClientDiscountConfigCache(clientId);

    res.json({ ok: true, defaultDiscountPct: pct });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /employees (listado paginado)
router.get('/employees', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;

    let where = `WHERE client_id = ? AND status = 'active'`;
    const params = [clientId];

    if (search) {
      where += ` AND (LOWER(name) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?) OR dni LIKE ?)`;
      params.push(search, search, search);
    }

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM client_employees ${where}`).get(...params);
    const total = Number(countRow?.total || 0);

    const rows = await db.prepare(`
      SELECT id, dni, email, name, discount_pct, status, created_at, updated_at
      FROM client_employees 
      ${where} 
      ORDER BY created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `).all(...params);

    res.json({
      employees: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /employees (alta / edición individual)
router.post('/employees', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    const { id, dni, email, name, discountPct } = req.body;
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanDni = dni ? String(dni).trim() : null;
    const cleanName = name ? String(name).trim() : null;
    const pct = discountPct != null && discountPct !== '' ? Number(discountPct) : null;

    if (!cleanEmail && !cleanDni) {
      return res.status(400).json({ error: 'Se requiere al menos Email o DNI para registrar un empleado' });
    }

    if (id) {
      // Edición
      await db.prepare(`
        UPDATE client_employees 
        SET dni = ?, email = ?, name = ?, discount_pct = ?, updated_at = datetime('now')
        WHERE id = ? AND client_id = ?
      `).run(cleanDni, cleanEmail, cleanName, pct, id, clientId);

      return res.json({ ok: true, id });
    }

    // Alta nuevo
    const newId = genEmpId();
    await db.prepare(`
      INSERT INTO client_employees (id, client_id, dni, email, name, discount_pct)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, clientId, cleanDni, cleanEmail, cleanName, pct);

    res.json({ ok: true, id: newId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /employees/:id
router.delete('/employees/:id', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    await db.prepare(`
      DELETE FROM client_employees WHERE id = ? AND client_id = ?
    `).run(req.params.id, clientId);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /employees (vaciar nómina)
router.delete('/employees', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    await db.prepare(`
      DELETE FROM client_employees WHERE client_id = ?
    `).run(clientId);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /employees/upload (carga masiva de planilla)
router.post('/employees/upload', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    const { employees, mode = 'replace' } = req.body;
    if (!Array.isArray(employees)) {
      return res.status(400).json({ error: 'Se esperaba un array de empleados' });
    }

    const validRows = [];
    let skipped = 0;

    for (const emp of employees) {
      const email = emp.email ? String(emp.email).trim().toLowerCase() : null;
      const dni = emp.dni ? String(emp.dni).trim() : null;
      const name = emp.name ? String(emp.name).trim() : null;
      const discountPct = emp.discountPct != null && emp.discountPct !== '' ? Number(emp.discountPct) : null;

      if (!email && !dni) {
        skipped++;
        continue;
      }

      validRows.push({ email, dni, name, discountPct });
    }

    if (validRows.length === 0) {
      return res.status(400).json({ error: 'La planilla no contiene filas válidas con Email o DNI' });
    }

    await db.transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.prepare(`DELETE FROM client_employees WHERE client_id = ?`).run(clientId);
      }

      for (const row of validRows) {
        const empId = genEmpId();
        await tx.prepare(`
          INSERT INTO client_employees (id, client_id, dni, email, name, discount_pct)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(empId, clientId, row.dni, row.email, row.name, row.discountPct);
      }
    });

    res.json({
      ok: true,
      imported: validRows.length,
      skipped,
      mode,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /stats (métricas para el dashboard tab)
router.get('/stats', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    // Summary general
    const summary = await db.prepare(`
      SELECT 
        COALESCE(SUM(refund_amount), 0) as total_refunded,
        COUNT(*) as total_transactions,
        COUNT(DISTINCT employee_id) as unique_employees,
        COALESCE(AVG(refund_amount), 0) as avg_refund
      FROM employee_discount_logs
      WHERE client_id = ? AND status = 'done'
    `).get(clientId);

    // Top 5 empleados que más consumieron / ahorraron
    const topEmployees = await db.prepare(`
      SELECT 
        l.employee_id,
        COALESCE(e.name, l.payer_email, l.payer_dni, 'Empleado') as name,
        COALESCE(e.email, l.payer_email) as email,
        COALESCE(e.dni, l.payer_dni) as dni,
        COUNT(*) as tx_count,
        SUM(l.original_amount) as total_spent,
        SUM(l.refund_amount) as total_discounted
      FROM employee_discount_logs l
      LEFT JOIN client_employees e ON e.id = l.employee_id
      WHERE l.client_id = ? AND l.status = 'done'
      GROUP BY l.employee_id, e.name, e.email, e.dni, l.payer_email, l.payer_dni
      ORDER BY total_discounted DESC
      LIMIT 5
    `).all(clientId);

    res.json({
      totalRefunded: Number(summary?.total_refunded || 0),
      totalTransactions: Number(summary?.total_transactions || 0),
      uniqueEmployees: Number(summary?.unique_employees || 0),
      avgRefund: Math.round(Number(summary?.avg_refund || 0)),
      topEmployees,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /logs (bitácora de consumos y reembolsos paginada)
router.get('/logs', async (req, res) => {
  try {
    const clientId = await getOrgId(req, res);
    if (!clientId) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const countRow = await db.prepare(`
      SELECT COUNT(*) as total 
      FROM employee_discount_logs 
      WHERE client_id = ?
    `).get(clientId);

    const total = Number(countRow?.total || 0);

    const rows = await db.prepare(`
      SELECT 
        l.id,
        l.payment_id,
        l.payer_email,
        l.payer_dni,
        l.original_amount,
        l.discount_pct,
        l.refund_amount,
        l.mp_refund_id,
        l.status,
        l.error_message,
        l.created_at,
        e.name as employee_name,
        e.email as employee_email,
        e.dni as employee_dni,
        p.machine_id,
        m.name as machine_name
      FROM employee_discount_logs l
      LEFT JOIN client_employees e ON e.id = l.employee_id
      LEFT JOIN payments p ON p.id = l.payment_id
      LEFT JOIN machines m ON m.id = p.machine_id
      WHERE l.client_id = ?
      ORDER BY l.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).all(clientId);

    res.json({
      logs: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
