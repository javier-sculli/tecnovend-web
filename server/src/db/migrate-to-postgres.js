import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import fs from 'fs';

// Determinar la ruta de SQLite. En producción está en /data/tecnovend.db, local en ./tecnovend.db.
let sqlitePath = './tecnovend.db';
if (fs.existsSync('/data/tecnovend.db')) {
  sqlitePath = '/data/tecnovend.db';
} else if (fs.existsSync('./server/tecnovend.db')) {
  sqlitePath = './server/tecnovend.db';
} else if (fs.existsSync('./tecnovend.db')) {
  sqlitePath = './tecnovend.db';
}

console.log(`[migration] Usando base de datos SQLite de origen: ${sqlitePath}`);

const pgUrl = process.env.DATABASE_URL;
if (!pgUrl || sqlitePath === pgUrl || pgUrl.startsWith('/data')) {
  console.error('[migration] DATABASE_URL no está configurado para PostgreSQL.');
  process.exit(1);
}

const sqliteDb = new DatabaseSync(sqlitePath);
const pgPool = new pg.Pool({ connectionString: pgUrl });

// Helper para convertir ? a $1, $2
function translateSql(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

async function migrateTable(tableName, pkeyName = 'id') {
  console.log(`[migration] Migrando tabla: ${tableName}...`);
  
  // Obtener filas de SQLite
  let rows;
  try {
    rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  } catch (e) {
    console.warn(`[migration] No se pudo leer la tabla ${tableName} de SQLite: ${e.message}`);
    return;
  }
  
  if (rows.length === 0) {
    console.log(`[migration] Tabla ${tableName} vacía en SQLite.`);
    return;
  }

  // Obtener columnas de PostgreSQL para filtrar columnas obsoletas
  const pgColsRes = await pgPool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
    [tableName]
  );
  const pgColumns = pgColsRes.rows.map(r => r.column_name);

  // Filtrar columnas de SQLite para dejar solo las que existen en PostgreSQL
  const columns = Object.keys(rows[0]).filter(col => pgColumns.includes(col));
  
  if (columns.length === 0) {
    console.warn(`[migration] No hay columnas coincidentes para la tabla ${tableName}.`);
    return;
  }

  const columnsSql = columns.join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  
  const pgSql = translateSql(`
    INSERT INTO ${tableName} (${columnsSql}) 
    VALUES (${placeholders}) 
    ON CONFLICT (${pkeyName}) 
    DO UPDATE SET ${columns.filter(c => c !== pkeyName).map(c => `${c} = EXCLUDED.${c}`).join(', ')}
  `);

  let count = 0;
  for (const row of rows) {
    const values = columns.map(col => row[col]);
    const res = await pgPool.query(pgSql, values);
    if (res.rowCount > 0) {
      count++;
    }
  }
  
  console.log(`[migration] Tabla ${tableName}: se migraron/actualizaron ${count}/${rows.length} filas.`);
  
  // Si tiene clave autoincrementable (SERIAL), actualizar la secuencia
  if (tableName === 'machine_events' || tableName === 'webhook_logs') {
    await pgPool.query(`SELECT setval(pg_get_serial_sequence('${tableName}', '${pkeyName}'), COALESCE(MAX(${pkeyName}), 1)) FROM ${tableName}`);
    console.log(`[migration] Secuencia de ${tableName} actualizada.`);
  }
}

async function run() {
  // Orden correcto de dependencias
  const tables = [
    { name: 'clients', pkey: 'id' },
    { name: 'users', pkey: 'id' },
    { name: 'memberships', pkey: 'id' },
    { name: 'machines', pkey: 'id' },
    { name: 'payments', pkey: 'id' },
    { name: 'pulse_queue', pkey: 'id' },
    { name: 'machine_events', pkey: 'id' },
    { name: 'mp_connections', pkey: 'client_id' },
    { name: 'webhook_logs', pkey: 'id' },
    { name: 'config', pkey: 'key' }
  ];

  console.log('[migration] Vaciando tablas en la base de datos PostgreSQL de destino...');
  const tablesToTruncate = tables.map(t => t.name).reverse().join(', ');
  await pgPool.query(`TRUNCATE TABLE ${tablesToTruncate} CASCADE`);
  console.log('[migration] Tablas vaciadas.');

  for (const t of tables) {
    await migrateTable(t.name, t.pkey);
  }

  console.log('[migration] ¡Migración de datos completada con éxito!');
  await pgPool.end();
  process.exit(0);
}

run().catch(e => {
  console.error('[migration] Error durante la migración:', e);
  process.exit(1);
});
