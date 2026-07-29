import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('=== ALL EVENTS ON 28/7 FOR machine_425 ===');
  const res = await pool.query(`
    SELECT id, type, detail, created_at
    FROM machine_events
    WHERE machine_id = 'machine_425'
      AND created_at >= '2026-07-28 00:00:00'
      AND created_at <= '2026-07-28 23:59:59'
    ORDER BY created_at ASC
  `);

  console.log(`Total events found on 28/7: ${res.rows.length}`);
  res.rows.forEach(r => {
    const localTime = new Date(r.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    console.log(`[UTC: ${r.created_at.toISOString()} | Local: ${localTime}] Type: ${r.type} -> ${r.detail}`);
  });

  await pool.end();
}

main().catch(console.error);
