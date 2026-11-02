# Technical Plan: 001 - Descuento para Empleados vía QR Web

**Feature:** [001-employee-qr-discounts](spec.md)  
**Status:** Approved  

---

## 1. Resumen de Arquitectura

El flujo reemplaza la inferencia pasiva de datos en MP por un checkout asistido web para empleados.

```
[QR Físico de Empleados] 
         │ 
         ▼ Escaneo en móvil
[Webapp Móvil /e/:machineId]
         │
         ├── ¿Tiene sesión válida? (Cookie HttpOnly / LocalToken)
         │       ├── NO ──> Ingresa Email ──> OTP 4 dígitos al correo ──> Valida y setea sesión
         │       └── SÍ ──> Continúa
         ▼
[Pantalla de Cobro con Descuento]
         │
         ├── Máquina Fixed: Muestra precio lista vs bonificado
         └── Máquina Dynamic: Empleado ingresa precio lista de la máquina
         │
         ▼ Clic "Pagar con Mercado Pago"
[Servidor VendPoint] ──> Crea Preference/Order en MP por el monto BONIFICADO ($800)
         │
         ▼ Redirección a App de MP o Checkout Web
[Pago Aprobado en MP]
         │
         ▼ Webhook MP
[Webhook VendPoint]
         ├── Reconoce orden propia de empleado (prefijo 'tv_emp_')
         ├── Calcula pulsos sobre el VALOR DE LISTA ($1.000 / pulse_value)
         ├── Encola pulsos completos en 'pulse_queue'
         └── Registra log de auditoría en 'employee_discount_logs'
         │
         ▼ Polling de placa ESP32
[Arduino Firmware] ──> Dispensa producto en la máquina física
```

---

## 2. Modelo de Datos (Data Model & Migrations)

### 2.1. Nueva columna en `machines`
```sql
ALTER TABLE machines ADD COLUMN IF NOT EXISTS employee_discount_enabled INTEGER NOT NULL DEFAULT 0;
```

### 2.2. Tabla de OTPs de Empleados (`employee_auth_otps`)
```sql
CREATE TABLE IF NOT EXISTS employee_auth_otps (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES client_employees(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_emp_otps_lookup ON employee_auth_otps(client_id, LOWER(email), created_at);
```

### 2.3. Tabla de Sesiones de Empleados (`employee_sessions`)
```sql
CREATE TABLE IF NOT EXISTS employee_sessions (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL REFERENCES client_employees(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  expires_at   TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_emp_sessions_token ON employee_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_emp_sessions_employee ON employee_sessions(employee_id);
```

### 2.4. Tabla de Órdenes Pendientes de Empleado (`employee_payment_intents`)
Permite reconciliar con exactitud los pulsos al recibir la notificación de MP:
```sql
CREATE TABLE IF NOT EXISTS employee_payment_intents (
  id              TEXT PRIMARY KEY,          -- 'tv_emp_' + randomId
  machine_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES client_employees(id) ON DELETE CASCADE,
  list_amount     INTEGER NOT NULL,          -- Ej: $1000
  discount_pct    INTEGER NOT NULL,          -- Ej: 20%
  discount_amount INTEGER NOT NULL,          -- Ej: $200
  charge_amount   INTEGER NOT NULL,          -- Ej: $800
  mp_preference_id TEXT,
  mp_payment_id   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed')),
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at         TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_emp_intents_machine ON employee_payment_intents(machine_id, status);
```

---

## 3. Contratos de API (Endpoints)

### 3.1. Consulta Pública de Máquina (`GET /api/emp/machine/:machineId`)
* **Propósito:** La webapp móvil consulta el contexto al escanear el QR.
* **Respuesta:**
  ```json
  {
    "id": "machine_001",
    "name": "Cafetera Comedor Piso 2",
    "clientName": "Acme Corp",
    "enabled": true,
    "status": "active",
    "qrMode": "fixed",
    "fixedAmount": 1000,
    "pulseValue": 250,
    "minPayment": 200
  }
  ```

### 3.2. Solicitud de Código OTP (`POST /api/emp/auth/request-otp`)
* **Body:** `{ "machineId": "machine_001", "email": "juan.perez@empresa.com" }`
* **Lógica:**
  1. Resuelve `client_id` de la máquina.
  2. Valida que `email` esté en `client_employees` con `status = 'active'`.
  3. Si no existe: devuelve `404` con mensaje amigable.
  4. Genera código de 4 dígitos (ej. `4921`), guarda hash SHA-256 en `employee_auth_otps`.
  5. Envía correo vía `mailer.js` (Resend).
  6. Devuelve `{ "ok": true, "message": "Código enviado a tu correo" }`.

### 3.3. Verificación de OTP (`POST /api/emp/auth/verify-otp`)
* **Body:** `{ "machineId": "machine_001", "email": "juan.perez@empresa.com", "code": "4921" }`
* **Lógica:**
  1. Compara hash del código y valida `expires_at > NOW()` y `used_at IS NULL`.
  2. Genera token de sesión de 32 bytes aleatorios.
  3. Setea cookie HTTP-Only:
     `Set-Cookie: emp_session=<token>; Max-Age=15552000; Path=/; SameSite=Lax; Secure; HttpOnly`
  4. Devuelve perfil del empleado: `{ "ok": true, "token": "<token>", "employee": { "name": "Juan Perez", "discountPct": 20 } }`.

### 3.4. Estado de Sesión Actual (`GET /api/emp/auth/me?machineId=xxx`)
* **Headers/Cookies:** Lee `emp_session` (o header `Authorization: Bearer <token>`).
* **Lógica:**
  1. Valida existencia en `employee_sessions` y que el empleado siga `active` en la empresa de esa máquina.
  2. Si es válido: actualiza `last_used_at` y devuelve datos del empleado y su descuento aplicable.
  3. Si caducó o fue dado de baja: responde `401`.

### 3.5. Creación de Orden con Descuento (`POST /api/emp/checkout/create-order`)
* **Autenticado vía sesión de empleado.**
* **Body:** `{ "machineId": "machine_001", "listAmount": 1000 }`
* **Lógica:**
  1. Verifica que la máquina esté `active` y habilitada para descuentos.
  2. Calcula: `discountPct` (específico del empleado o default de la empresa).
  3. Monto a cobrar: `chargeAmount = Math.round(listAmount * (1 - discountPct / 100))`.
  4. Crea Preference / Orden en Mercado Pago usando las credenciales del cliente dueño de la máquina:
     * `external_reference`: `tv_emp_<intentId>`
     * `amount`: `chargeAmount`
     * `title`: `Compra con beneficio en ${machine.name}`
     * `back_urls`: URLs de retorno a `/e/:machineId?status=success|failure|pending`
     * `auto_return`: condicionado a HTTPS (`'approved'` si `back_urls.success` es HTTPS; omitido en desarrollo local `http://localhost` para cumplir con la validación estricta de MP).
  5. Guarda en `employee_payment_intents`.
  6. Devuelve URL de pago: `{ "checkoutUrl": preference.init_point }`.

---

## 4. Estrategia de Webhook y Pulsos

En `server/src/routes/webhooks.js`:
1. Cuando llega un pago/order aprobado con `external_reference` que empieza con `tv_emp_`:
2. Busca el intent en `employee_payment_intents`.
3. Calcula los pulsos en base al **monto de lista original**:
   ```javascript
   const pulses = Math.floor(intent.list_amount / machine.pulse_value);
   ```
4. Encola los pulsos completos en `pulse_queue` para la máquina.
5. Actualiza el intent a `status = 'paid'`.
6. Inserta el registro en `employee_discount_logs` para alimentar el dashboard de auditoría.

---

## 5. UI en Web de Gestión (Admin)

1. **Pantalla Máquinas (`Maquinas.jsx`):**
   * En la configuración básica, switch: *"Habilitar beneficio de empleados en esta máquina"*.
   * En la solapa Pagos: tarjeta para visualizar y descargar el **QR de Empleados** junto al QR de MP.
2. **Pantalla Descuentos (`Descuentos.jsx`):**
   * Listado de máquinas con selector rápido para activar/desactivar en lote.
   * Dashboard con historial de compras con descuento (monto abonado, descuento subsidiado, empleado, fecha y máquina).
