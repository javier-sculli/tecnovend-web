import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not configured in environment variables');
}

// Configurar pool de conexiones a Postgres
const pool = new pg.Pool({
  connectionString
});

// Sobrescribir parsers de pg para retornar TIMESTAMP y TIMESTAMPTZ como string
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, val => val);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, val => val);

export async function initDb() {
  console.log('[db] Inicializando base de datos PostgreSQL...');
  
  // 1. Crear funciones personalizadas de fecha para emular datetime() de SQLite
  await pool.query(`
    CREATE OR REPLACE FUNCTION datetime(arg1 text)
    RETURNS timestamp AS $$
    BEGIN
      IF arg1 = 'now' THEN
        RETURN CURRENT_TIMESTAMP;
      ELSE
        RETURN arg1::timestamp;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION datetime(arg1 text, arg2 text)
    RETURNS timestamp AS $$
    DECLARE
      base_ts timestamp;
    BEGIN
      IF arg1 = 'now' THEN
        base_ts := CURRENT_TIMESTAMP;
      ELSE
        base_ts := arg1::timestamp;
      END IF;
      -- arg2 es como '+3 minutes', '-7 days', etc.
      RETURN base_ts + CAST(replace(arg2, '+', '') AS interval);
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 2. Crear tablas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      contact_name   TEXT,
      contact_email  TEXT,
      contact_phone  TEXT,
      notes          TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK(role IN ('administrador','operativo')),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_user_client ON memberships(user_id, client_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS machines (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      location        TEXT,
      terminal_id     TEXT,
      pos_id          TEXT,
      pulse_value     INTEGER NOT NULL DEFAULT 200,
      pulse_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      min_payment     INTEGER NOT NULL DEFAULT 200,
      channels_config TEXT NOT NULL DEFAULT '[]',
      api_key_hash    TEXT,
      status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance')),
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      mp_pos_id       TEXT,
      mp_store_id     TEXT,
      mp_store_name   TEXT,
      model           TEXT,
      address         TEXT,
      device_serial   TEXT,
      api_key         TEXT,
      last_seen_at    TIMESTAMP,
      firmware_version TEXT,
      last_rssi       INTEGER,
      last_uptime     INTEGER,
      client_id       TEXT REFERENCES clients(id) ON DELETE SET NULL,
      arduino_id      TEXT,
      pulse_duration_ms INTEGER NOT NULL DEFAULT 200,
      pulse_gap_ms    INTEGER NOT NULL DEFAULT 200,
      wifi_ssid       TEXT,
      wifi_user       TEXT,
      wifi_password   TEXT,
      qr_mode         TEXT NOT NULL DEFAULT 'dynamic',
      qr_fixed_amount INTEGER
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_arduino_id ON machines(arduino_id) WHERE arduino_id IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id              TEXT PRIMARY KEY,
      machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      mp_payment_id   TEXT UNIQUE,
      amount          INTEGER NOT NULL,
      method          TEXT NOT NULL DEFAULT 'qr' CHECK(method IN ('qr','card','other')),
      status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','error')),
      pulses_calculated INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      mp_id_kind      TEXT,
      refund_status   TEXT,
      refunded_at     TIMESTAMP,
      refund_error    TEXT,
      refunded_amount INTEGER
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pulse_queue (
      id          TEXT PRIMARY KEY,
      machine_id  TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      payment_id  TEXT REFERENCES payments(id) ON DELETE SET NULL,
      channel     INTEGER NOT NULL,
      count       INTEGER NOT NULL DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','acked','expired')),
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acked_at    TIMESTAMP,
      expires_at  TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS machine_events (
      id         SERIAL PRIMARY KEY,
      machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      detail     TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_machine_events_machine ON machine_events(machine_id, created_at);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mp_connections (
      client_id     TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      access_token  TEXT NOT NULL,
      refresh_token TEXT,
      expires_at    TIMESTAMP,
      mp_user_id    TEXT,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mp_connections_user ON mp_connections(mp_user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id           SERIAL PRIMARY KEY,
      received_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      type         TEXT,
      action       TEXT,
      data_id      TEXT,
      raw_body     TEXT,
      mp_response  TEXT,
      pos_id_found TEXT,
      machine_found TEXT,
      result       TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Backfill equivalencia arduino_id
  await pool.query(`
    UPDATE machines 
    SET arduino_id = device_serial 
    WHERE (arduino_id IS NULL OR arduino_id = '') 
      AND device_serial IS NOT NULL 
      AND device_serial != ''
  `);

  console.log('[db] Base de datos PostgreSQL inicializada con éxito.');
}

// Función auxiliar para traducir placeholders ? a $1, $2, $3...
function translateSql(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// Adaptador central de base de datos
const db = {
  async exec(sql) {
    return pool.query(sql);
  },
  prepare(sql) {
    const pgSql = translateSql(sql);
    return {
      async get(...params) {
        const res = await pool.query(pgSql, params);
        return res.rows[0] || null;
      },
      async all(...params) {
        const res = await pool.query(pgSql, params);
        return res.rows;
      },
      async run(...params) {
        const res = await pool.query(pgSql, params);
        return { changes: res.rowCount };
      }
    };
  }
};

export default db;
