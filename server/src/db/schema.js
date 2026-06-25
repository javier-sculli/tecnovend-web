import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.DATABASE_URL || './tecnovend.db';
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    location        TEXT,
    terminal_id     TEXT,
    pos_id          TEXT,
    pulse_value     INTEGER NOT NULL DEFAULT 200,
    pulse_multiplier REAL NOT NULL DEFAULT 1.0,
    min_payment     INTEGER NOT NULL DEFAULT 200,
    channels_config TEXT NOT NULL DEFAULT '[]',
    api_key_hash    TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id              TEXT PRIMARY KEY,
    machine_id      TEXT NOT NULL REFERENCES machines(id),
    mp_payment_id   TEXT UNIQUE,
    amount          INTEGER NOT NULL,
    method          TEXT NOT NULL DEFAULT 'qr' CHECK(method IN ('qr','card','other')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','error')),
    pulses_calculated INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pulse_queue (
    id          TEXT PRIMARY KEY,
    machine_id  TEXT NOT NULL REFERENCES machines(id),
    payment_id  TEXT REFERENCES payments(id),
    channel     INTEGER NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','acked','expired')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    acked_at    TEXT,
    expires_at  TEXT NOT NULL
  );
`);

// Clientes — dueños/operadores de máquinas. Datos de contacto y notas.
// La config WiFi vive ahora a nivel máquina, no acá.
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    contact_name   TEXT,
    contact_email  TEXT,
    contact_phone  TEXT,
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Usuarios y membresías a organizaciones (clients).
// Un usuario puede pertenecer a varias organizaciones, con un rol por cada una.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    client_id  TEXT NOT NULL REFERENCES clients(id),
    role       TEXT NOT NULL CHECK(role IN ('administrador','operativo')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_user_client ON memberships(user_id, client_id);
`);

// Eventos de la máquina (heartbeat, config, fuera/dentro de servicio).
// Los ACK y pagos NO se duplican acá: se derivan de pulse_queue y payments.
db.exec(`
  CREATE TABLE IF NOT EXISTS machine_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id TEXT NOT NULL,
    type       TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_machine_events_machine ON machine_events(machine_id, created_at)`);

// Conexión de Mercado Pago por cliente. Cada cliente conecta su propia cuenta
// (OAuth) y su local/cajas viven ahí. mp_user_id es la cuenta colectora de MP,
// que el webhook usa para rutear cada pago al cliente dueño.
db.exec(`
  CREATE TABLE IF NOT EXISTS mp_connections (
    client_id     TEXT PRIMARY KEY REFERENCES clients(id),
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TEXT,
    mp_user_id    TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mp_connections_user ON mp_connections(mp_user_id)`);

// Tabla de logs de webhooks entrantes (para debug)
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    type       TEXT,
    action     TEXT,
    data_id    TEXT,
    raw_body   TEXT,
    mp_response TEXT,
    pos_id_found TEXT,
    machine_found TEXT,
    result     TEXT
  );
`);

// Migraciones — agregar columnas nuevas si no existen
for (const ddl of [
  'ALTER TABLE machines ADD COLUMN mp_pos_id TEXT',
  'ALTER TABLE machines ADD COLUMN mp_store_id TEXT',
  `CREATE TABLE IF NOT EXISTS config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'ALTER TABLE machines ADD COLUMN model TEXT',
  'ALTER TABLE machines ADD COLUMN address TEXT',
  'ALTER TABLE machines ADD COLUMN device_serial TEXT',
  'ALTER TABLE machines ADD COLUMN api_key TEXT',
  'ALTER TABLE machines ADD COLUMN mp_store_name TEXT',
  'ALTER TABLE machines ADD COLUMN last_seen_at TEXT',
  'ALTER TABLE machines ADD COLUMN firmware_version TEXT',
  'ALTER TABLE machines ADD COLUMN last_rssi INTEGER',
  'ALTER TABLE machines ADD COLUMN last_uptime INTEGER',
  'ALTER TABLE machines ADD COLUMN client_id TEXT REFERENCES clients(id)',
  'ALTER TABLE machines ADD COLUMN arduino_id TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_arduino_id ON machines(arduino_id) WHERE arduino_id IS NOT NULL',
  'ALTER TABLE machines ADD COLUMN pulse_duration_ms INTEGER NOT NULL DEFAULT 200',
  'ALTER TABLE machines ADD COLUMN pulse_gap_ms INTEGER NOT NULL DEFAULT 200',
  // WiFi por máquina: cada equipo guarda su propia red (antes vivía en el cliente).
  'ALTER TABLE machines ADD COLUMN wifi_ssid TEXT',
  'ALTER TABLE machines ADD COLUMN wifi_user TEXT',
  'ALTER TABLE machines ADD COLUMN wifi_password TEXT',
  // Precio del QR de MP: 'dynamic' = el cliente tipea el monto en la app;
  // 'fixed' = el QR queda cargado con una orden por qr_fixed_amount.
  "ALTER TABLE machines ADD COLUMN qr_mode TEXT NOT NULL DEFAULT 'dynamic'",
  'ALTER TABLE machines ADD COLUMN qr_fixed_amount INTEGER',
  // Reembolsos en MP cuando el pulso expira o la máquina está fuera de servicio.
  // mp_id_kind: si mp_payment_id es un id de 'order' (QR, API nueva) o de 'payment' (legacy).
  // refund_status: null = sin reembolso; 'pending' | 'done' | 'failed'.
  "ALTER TABLE payments ADD COLUMN mp_id_kind TEXT",
  "ALTER TABLE payments ADD COLUMN refund_status TEXT",
  "ALTER TABLE payments ADD COLUMN refunded_at TEXT",
  "ALTER TABLE payments ADD COLUMN refund_error TEXT",
  // Monto reembolsado acumulado (ARS). Soporta reembolsos PARCIALES: cuando el
  // cliente paga de más en QR libre (ej. $400 con pulse_value $250) se le devuelve
  // el excedente ($150) y el pago queda refund_status='partial'. 0/null = nada.
  "ALTER TABLE payments ADD COLUMN refunded_amount INTEGER",
  // arduino_id (identificador del Arduino) y device_serial (serial de placa) son
  // lo mismo. Backfill: las máquinas viejas cargaban el serial en device_serial y
  // arduino_id quedaba vacío → copiamos para que el serial identifique los requests.
  "UPDATE machines SET arduino_id = device_serial WHERE (arduino_id IS NULL OR arduino_id = '') AND device_serial IS NOT NULL AND device_serial != ''",
]) {
  try { db.exec(ddl); } catch { /* ya existe */ }
}

export default db;
