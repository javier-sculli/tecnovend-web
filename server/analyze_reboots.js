import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log("=== ANÁLISIS DE REINICIOS EN BASE DE DATOS DE PRODUCCIÓN ===");

  // 1. Conteo general de eventos de arranque por versión
  console.log("\n1. Conteo de arranques (heartbeat con reason = startup) agrupados por versión de firmware:");
  const startupRes = await pool.query(`
    SELECT 
      detail::json->>'fw' as version,
      COUNT(*) as count
    FROM machine_events
    WHERE type = 'heartbeat'
      AND detail::json->>'reason' = 'startup'
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  console.table(startupRes.rows);

  // 2. Desglose de motivos de reinicio (reset_reason_text) por versión
  console.log("\n2. Motivos de reinicio por versión de firmware:");
  const reasonsRes = await pool.query(`
    SELECT 
      detail::json->>'fw' as version,
      detail::json->>'reset_reason_text' as reset_reason,
      COUNT(*) as count
    FROM machine_events
    WHERE type = 'heartbeat'
      AND detail::json->>'reason' = 'startup'
    GROUP BY 1, 2
    ORDER BY 1 DESC, 3 DESC
  `);
  console.table(reasonsRes.rows);

  // 3. Análisis de breadcrumbs en los reinicios por watchdog o software stale
  console.log("\n3. Último 'breadcrumb' reportado en arranques problemáticos (watchdog, task_wdt, software, etc.):");
  
  // Vamos a buscar los heartbeats de arranque que tengan motivos sospechosos y ver qué guardó en el breadcrumb.
  // Pero espera, en heartbeat, ¿se guarda last_breadcrumb?
  // Vamos a ver la estructura de detalle de los heartbeats.
  const sampleRes = await pool.query(`
    SELECT 
      created_at,
      detail::json->>'fw' as version,
      detail::json->>'reset_reason_text' as reset_reason,
      detail::json->>'last_breadcrumb' as last_breadcrumb
    FROM machine_events
    WHERE type = 'heartbeat'
      AND detail::json->>'reason' = 'startup'
      AND (detail::json->>'reset_reason_text' LIKE '%wdt%' OR detail::json->>'reset_reason_text' = 'watchdog' OR detail::json->>'reset_reason_text' LIKE '%stale%')
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(sampleRes.rows);

  // 4. Buscar también en status_log si last_breadcrumb se reporta ahí
  console.log("\n4. Muestras de breadcrumbs reportadas en eventos tipo 'status_log' con uptime bajo (< 120s) tras reinicios:");
  const statusLogRes = await pool.query(`
    SELECT 
      created_at,
      detail::json->>'fw' as version,
      detail::json->>'reset_reason_text' as reset_reason,
      detail::json->>'last_breadcrumb' as last_breadcrumb,
      (detail::json->>'uptime')::numeric as uptime
    FROM machine_events
    WHERE type = 'status_log'
      AND (detail::json->>'uptime')::numeric < 120
      AND (detail::json->>'reset_reason_text' LIKE '%wdt%' OR detail::json->>'reset_reason_text' = 'watchdog')
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(statusLogRes.rows);

  await pool.end();
}

main().catch(console.error);
