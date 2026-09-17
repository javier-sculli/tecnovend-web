import pg from 'pg';

const connectionString = 'postgresql://postgres:vdcUCIDdmFimjAaZOJQhUxNvbKUCbLEh@metro.proxy.rlwy.net:53903/railway';
const pool = new pg.Pool({ connectionString });

let lastId = 55975;

async function check() {
  try {
    const res = await pool.query('SELECT id, machine_id, type, created_at, detail FROM machine_events WHERE id > $1 ORDER BY id ASC', [lastId]);
    for (const row of res.rows) {
      lastId = row.id;
      console.log(`\n[NUEVO HEARTBEAT DETECTADO] ID: ${row.id} | Máquina: ${row.machine_id} | Tipo: ${row.type} | Fecha: ${row.created_at}`);
      console.log(`Detalle: ${row.detail}`);
    }
  } catch (e) {
    console.error('Error al consultar BD:', e.message);
  }
}

console.log('Iniciando monitoreo de Heartbeats en tiempo real (ID inicial: 55904)...');
check();
setInterval(check, 5000);
