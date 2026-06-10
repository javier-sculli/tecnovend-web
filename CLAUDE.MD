# Tecnovend — Contexto del Proyecto

## Qué es esto
Sistema propio de pagos para máquinas expendedoras. Reemplaza 5 proveedores externos por integración directa con **Mercado Pago** usando credenciales propias. El hardware embebido es un **Arduino (ESP32)** que se comunica con un servidor web propio.

**Stakeholders:**
- **Javier Sculli** — desarrollador, responsable de API y web de gestión
- **Pablo** — socio operativo, maneja credenciales MP y acceso a plataforma actual

**Referencias:**
- Notion: https://www.notion.so/Tecnovend-368617fc369280e7b853ce3a0a33a3fc
- Reunión original: https://notes.granola.ai/t/5075d69f-aef9-4cf0-9693-7e16188195e6
- Documento de arquitectura: `Tecnovend_Arquitectura_v1.docx` (en este directorio)
- **Pagos, pulsos, reembolsos y estados de la máquina:** `docs/pagos-y-estados.md`
- API que consume el firmware: `docs/api-arduino.md`

---

## Arquitectura del sistema

### Componentes
| Componente | Descripción | Stack |
|---|---|---|
| **API Server** | Backend central. Webhook MP → valida pago → encola pulsos | Node.js + Express (o Python + FastAPI) |
| **Web de Gestión** | Dashboard: configurar máquinas, ver transacciones, tagear terminales | React + Tailwind CSS |
| **Arduino Firmware** | Polling al servidor, recibe pulsos, activa canales de la máquina | ESP32 + WiFi / SIM7600 (4G) |
| **Mercado Pago** | Procesador de pagos: QR (Fase 1) y Point tarjeta (Fase 2) | MP API REST |

### Flujo de pago (Fase 1 — QR)
1. Cliente escanea QR → paga en app MP
2. MP notifica al servidor via webhook IPN
3. Servidor valida (monto, pos_id, deduplicación) → **siempre registra el pago en `payments`**
4. Si corresponden pulsos: los encola en `pulse_queue`
5. Arduino hace polling (`GET /arduino/poll/:machineId`) → recibe pulsos
6. Arduino activa canal → dispensa producto → confirma con ACK

### Flujo de pago (Fase 2 — Point/tarjeta)
1. Arduino detecta actividad → informa al servidor
2. Servidor crea payment intent en el Point via MP API
3. Cliente pasa tarjeta → MP notifica → continúa igual que QR desde paso 3

---

## Pagos y Pulsos — separación de responsabilidades

> **Principio fundamental:** el pago es la entidad primaria. Los pulsos se construyen *sobre* el pago, no al revés.

- **Todo pago aprobado por MP se registra en `payments`**, sin excepción. No importa si el monto alcanza para un pulso o no.
- El estado del pago refleja lo que pasó en MP (`approved` = MP confirmó el cobro, `rejected` = monto insuficiente para pulsos).
- La lógica de pulsos es independiente: calcula cuántos pulsos corresponden y los encola en `pulse_queue`. Si el monto es insuficiente, `pulses_calculated = 0` y no se encolan — pero el pago queda registrado igual.
- **Nunca mezclar ambas lógicas.** Si hay que cambiar cómo se calculan pulsos, no tocar el registro del pago. Si hay que cambiar cómo se registran pagos, no tocar la lógica de pulsos.

## Sistema de Pulsos

Un pulso = señal eléctrica que activa un canal en la máquina. Permite cambiar precios sin tocar el firmware.

```
pulsos = floor(monto_pagado / pulse_value)
```

**Parámetros configurables por máquina (en la web de gestión):**
- `pulse_value`: valor monetario por pulso (default $200–250 ARS)
- `pulse_multiplier`: multiplicador opcional (default 1.0)
- `min_payment`: monto mínimo aceptado (default $200 ARS)
- `channels_config`: configuración de los 5 canales disponibles
- `pulse_duration_ms`: duración del pulso eléctrico (default 200ms)

---

## API del Servidor

**URLs de producción (Railway):**
- API: `https://tecnovend-api-production.up.railway.app/`
- Web de gestión: `https://tecnovend-web-production.up.railway.app/`

### Webhooks
```
POST /api/webhooks/mercadopago   ← recibe IPN de MP
```

### Gestión de máquinas
```
GET    /api/machines              ← lista máquinas
POST   /api/machines              ← registrar máquina
GET    /api/machines/:id          ← detalle + transacciones
PUT    /api/machines/:id          ← actualizar config
GET    /api/machines/:id/payments ← historial de pagos
```

### Arduino
```
GET  /arduino/poll/:machineId          ← polling de pulsos pendientes
POST /arduino/ack/:machineId/:pulseId  ← ACK de pulso ejecutado
```

**Polling del Arduino:** cada 3s, timeout 5s, 3 reintentos, luego backoff 30s.
**ACK timeout:** pulso expira si no hay ACK en 10 minutos.

### Respuesta de ejemplo — poll
```json
{
  "machine_id": "machine_001",
  "pending_pulses": [
    { "pulse_id": "p_8f3a", "channel": 1, "count": 2 }
  ]
}
```

---

## Base de Datos

**PostgreSQL** en producción, **SQLite** para el MVP local.

### `machines`
```sql
id              VARCHAR(50) PRIMARY KEY
name            VARCHAR(100)
location        VARCHAR(200)
terminal_id     VARCHAR(100)   -- ID del Point de MP (Fase 2)
pos_id          VARCHAR(100)   -- ID del QR/caja de MP (Fase 1)
pulse_value     INTEGER        -- ARS por pulso
pulse_multiplier FLOAT          -- default 1.0
min_payment     INTEGER        -- ARS mínimo
channels_config JSON           -- [{channel:1, denomination:250}, ...]
api_key_hash    VARCHAR(64)    -- SHA-256 de la API key del Arduino
status          ENUM('active','inactive','maintenance')
created_at      TIMESTAMP
```

### `payments`
```sql
id              UUID PRIMARY KEY
machine_id      VARCHAR REFERENCES machines(id)
mp_payment_id   VARCHAR UNIQUE  -- clave de deduplicación
amount          INTEGER         -- ARS
method          ENUM('qr','card','other')
status          ENUM('pending','approved','rejected','error')
pulses_calculated INTEGER
created_at      TIMESTAMP
```

### `pulse_queue`
```sql
id          VARCHAR PRIMARY KEY   -- ej: p_8f3a
machine_id  VARCHAR REFERENCES machines(id)
payment_id  UUID REFERENCES payments(id)
channel     INTEGER               -- 1-5
count       INTEGER
status      ENUM('pending','delivered','acked','expired')
created_at  TIMESTAMP
acked_at    TIMESTAMP NULL
expires_at  TIMESTAMP             -- pulso fantasma prevention
```

---

## Integración Mercado Pago

**Credenciales:** propias de Tecnovend (Access Token del portal de developers de MP).

### Endpoints de MP a usar
```
POST /point/integration-api/devices/{deviceId}/payment-intents  ← Fase 2: crear cobro en Point
GET  /point/integration-api/payment-intents/{intentId}          ← Fase 2: consultar estado
GET  /point/integration-api/payment-intents/events              ← Fase 2: eventos recientes
GET  /v1/payments/{id}                                          ← Fase 1+2: detalle de pago
GET  /v1/payments/search?pos_id=X                               ← Fase 1+2: buscar pagos por QR
POST /v1/orders                                                 ← Fase 1: QR dinámico
```

### Procesamiento del Webhook IPN
```
1. Verificar firma HMAC-SHA256 (header x-signature)
2. GET /v1/payments/{id} → obtener detalles
3. Verificar status == 'approved'
4. Verificar pos_id o terminal_id coincide con una máquina registrada
5. Verificar mp_payment_id no existe en BD → 409 si duplicado
6. Calcular pulsos → INSERT en pulse_queue
7. Responder HTTP 200 (en < 5 segundos)
```

### Tageo de terminales
Proceso único por máquina: asociar `terminal_id` (impreso en el Point) o `pos_id` (del QR) a una máquina en la BD, desde la web de gestión.

---

## Seguridad

| Riesgo | Mitigación |
|---|---|
| Pago de centavos | Validar `amount >= min_payment` antes de encolar |
| Replay attack | `mp_payment_id` UNIQUE en BD, responder 409 si existe |
| Webhook falso | Verificar HMAC-SHA256 en `x-signature` |
| Arduino acredita en máquina equivocada | API key por máquina, validar `machine_id` en servidor |
| Cancelación no autorizada en Point | Solo el servidor crea payment intents |
| Tráfico sin cifrar | HTTPS obligatorio + validar SSL en firmware |
| Firmware robado | Solo guardar hash SHA-256 de API key; keys revocables |

---

## Roadmap

| Fase | Estado | Descripción |
|---|---|---|
| Fase 0 | ⏳ Bloqueado por Pablo | Credenciales MP, pos_id QR, device_id Point |
| Fase 1A | Pendiente | Backend: webhook + BD |
| Fase 1B | Pendiente | Firmware Arduino + polling/ACK |
| Fase 1C | Pendiente | Web de gestión básica |
| Fase 1 Go-Live | Pendiente | 1 máquina piloto en producción |
| Fase 2 | Pendiente | Integración Point (tarjeta física) |
| Fase 3 | Pendiente | Multi-máquina, multi-cliente, SaaS |

**Prerequisitos bloqueantes (de Pablo):**
- [ ] Access Token MP de la cuenta de Tecnovend
- [ ] `pos_id` o `store_id` del QR actual
- [ ] Acceso a la plataforma del proveedor actual
- [ ] `device_id` del Point para pruebas

---

## Stack tecnológico

| Capa | Recomendado | Alternativa |
|---|---|---|
| API Server | Node.js + Express | Python + FastAPI |
| Base de datos | PostgreSQL (prod) | SQLite (MVP local) |
| Web de gestión | React + Tailwind CSS | Vue.js |
| Firmware | Arduino IDE + HTTPClient | MicroPython (ESP32) |
| Hosting API | Railway / Render | VPS propio |
| Hardware | ESP32 + WiFi | ESP32 + SIM7600 (4G) |

---

## Variables de entorno requeridas

```env
# Mercado Pago
MP_ACCESS_TOKEN=...
MP_WEBHOOK_SECRET=...

# Servidor
DATABASE_URL=...
PORT=3000
NODE_ENV=development

# Seguridad
JWT_SECRET=...
```

---

## Convenciones del proyecto

- IDs de máquinas: formato `machine_XXX` (ej: `machine_001`)
- IDs de pulsos: formato `p_XXXX` (ej: `p_8f3a`)
- Montos: siempre en **ARS enteros** (no usar centavos ni floats)
- Fechas: siempre **UTC** en la BD, convertir a zona local solo en el frontend
- API keys del Arduino: prefijo `tv_live_` en producción, `tv_test_` en sandbox