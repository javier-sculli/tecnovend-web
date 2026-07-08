import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkMachine(id, name) {
  try {
    console.log(`\n========================================`);
    console.log(`ANÁLISIS DE LA MÁQUINA: ${name} (${id})`);
    console.log(`========================================`);
    
    // 1. Configuración actual
    const machineRes = await pool.query(
      'SELECT id, name, arduino_id, target_fw_version, ota_url, status, firmware_version FROM machines WHERE id = $1',
      [id]
    );
    console.log("Configuración actual:");
    console.log(JSON.stringify(machineRes.rows[0], null, 2));

    // 2. Últimos 15 eventos
    const eventsRes = await pool.query(
      `SELECT id, type, detail, created_at 
       FROM machine_events 
       WHERE machine_id = $1 
       ORDER BY created_at DESC 
       LIMIT 15`,
      [id]
    );
    console.log("\nÚltimos 15 eventos:");
    eventsRes.rows.forEach(row => {
      console.log(`[${row.created_at}] Tipo: ${row.type} | Detalle: ${JSON.stringify(row.detail)}`);
    });

  } catch (err) {
    console.error(`Error al consultar ${name}:`, err);
  }
}

async function main() {
  await checkMachine('machine_892', 'Café Soluble');
  await checkMachine('machine_727', 'Vega 700');
  await pool.end();
}

main();
