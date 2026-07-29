import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('=== EXACT EVENTS FOR machine_425 IN DB FOR 28/7 EVENING ===');
  const res = await pool.query(`
    SELECT id, machine_id, type, detail, created_at
    FROM machine_events
    WHERE machine_id = 'machine_425'
      AND type != 'status_log'
      AND created_at >= '2026-07-28 20:00:00'
      AND created_at <= '2026-07-29 02:00:00'
    ORDER BY created_at ASC
  `);

  console.log(`Total events for machine_425: ${res.rows.length}`);
  res.rows.forEach(r => {
    const localTime = new Date(r.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    console.log(`[Local: ${localTime} | UTC: ${r.created_at.toISOString()}] Type: ${r.type}`);
    console.log(`  Detail: ${r.detail}`);
  });

  await pool.end();
}

main().catch(console.error);
