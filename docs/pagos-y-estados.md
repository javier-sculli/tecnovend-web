# Pagos, pulsos y estados de la máquina

Referencia concisa de toda la lógica de cobro, acreditación, reembolsos y estados.
Fuente de verdad: `server/src/routes/{webhooks,arduino,machines,mp}.js`,
`server/src/services/{pulses,refunds,mp}.js`, `server/src/index.js`.

---

## 1. Estados de la máquina

Hay **dos** conceptos distintos:

### `status` — lo que se persiste (`machines.status`)
| Valor | Significado | Quién lo setea |
|---|---|---|
| `active` | En servicio | Alta (default), heartbeat `in_service:true`, web (reactivar) |
| `maintenance` | Fuera de servicio (mantenimiento) | Heartbeat `in_service:false`, web (poner en mantenimiento) |
| `inactive` | Fuera de servicio (dada de baja) | Manual |

> Operativamente, **"fuera de servicio" = `status !== 'active'`** (cubre `maintenance` e `inactive`).

### `state` — lo que se deriva y se muestra (`machineState()` en `machines.js`)
Combina el `status` con la última señal de vida (`last_seen_at`):

| `state` | Regla | Color |
|---|---|---|
| `offline` | Sin heartbeat hace **≥ 60 min** (o nunca) | rojo |
| `out_of_service` | Latió hace <60 min pero `status !== 'active'` | amarillo |
| `online` | Latió hace <60 min y `status === 'active'` | verde |

**La conexión manda:** sin heartbeat reciente la máquina es `offline` aunque su
`status` sea `active`. El heartbeat es el único input del estado de conexión.

---

## 2. Ciclo de un pulso (`pulse_queue.status`)

Un pago aprobado con monto suficiente encola **un** pulso (1 fila, `channel 1`,
`count = N pulsos`). Su ciclo:

```
            poll (máquina activa)        ACK del Arduino
 pending ───────────────────────► delivered ───────────────► acked   (acreditó)
    │                                  │
    │  3 min sin ACK / NACK / traba    │  3 min sin ACK / NACK / traba
    └──────────────┬───────────────────┘
                   ▼
                expired   (no acreditó → dispara reembolso)
```

| Estado | Significado |
|---|---|
| `pending` | Encolado, todavía no entregado al Arduino |
| `delivered` | Entregado en un poll, esperando ACK (no se reenvía) |
| `acked` | El Arduino confirmó que dispensó → **acreditado** |
| `expired` | No acreditó (timeout, NACK o traba) → **se reembolsa** |

**Ventana de ACK: 3 minutos** (`expires_at = creación + 3 min`).
La expiración la ejecuta **un solo lugar**: el barrido periódico de `index.js`
cada **60 s** (`expireStalePulses()`). Efecto neto: un pulso se marca `expired`
entre los 3:00 y los 4:00 de creado.

---

## 3. Flujo de pago (webhook MP)

`POST /api/webhooks/mercadopago` → responde 200 en <5 s y procesa en background:

1. Verifica firma HMAC (salvo webhooks de `order`).
2. Busca la máquina por `pos_id`/`mp_pos_id` — **sin filtrar por status**.
3. **Registra siempre el pago** (`payments`, `status='approved'`). El pago es la
   entidad primaria: si MP cobró, queda registrado, pase lo que pase.
4. Calcula pulsos y decide reembolso según el caso (tabla siguiente).

### Casos posibles

| Caso | Condición | Pago | Pulsos | Reembolso |
|---|---|---|---|---|
| **Normal** | Máquina `active`, `monto ≥ pulse_value` | `approved` | `floor(monto/pulse_value)`, encola pulso | No (salvo que el pulso expire) |
| **Monto insuficiente** | Máquina `active`, `monto < pulse_value` | `approved` | `0`, no encola | **No** ⚠️ (queda aprobado sin pulsos) |
| **Fuera de servicio** | `status !== 'active'` | `approved` | `0`, no encola | **Sí, automático** (no recibió nada) |
| **Pulso no acredita** | Pulso encolado expira a los 3 min | `approved` | `expired` | **Sí, automático** |
| **Traba al dispensar** | Arduino reporta NACK (ver §5) | `approved` | `expired` | **Sí, automático** |
| **Duplicado** | `mp_payment_id` ya existe | — (se ignora) | — | — |
| **Sin máquina** | `pos_id` no matchea ninguna | — (solo log) | — | — |

> ⚠️ **Monto insuficiente NO se reembolsa hoy**: el pago queda `approved` con 0
> pulsos. Si se quiere devolver también esos, hay que agregarlo.

---

## 4. Cómo el estado de la máquina impacta el cobro

| Acción | Máquina `active` | Fuera de servicio (`status != active`) |
|---|---|---|
| Generar QR dinámico (`PUT /api/mp/pos/:id/order`) | OK | **409** — bloqueado |
| Pago entrante (webhook) | Acredita pulsos | Se registra y **se reembolsa** (0 pulsos) |
| Poll (`GET /arduino/poll/:id`) | Entrega pulsos | Devuelve lista vacía (no dispensa) |
| ACK (`POST /arduino/ack/...`) | Acredita | **409** — rechazado |

> El firmware decide si poolear según el `status` que devuelve el heartbeat: si
> no es `active`, no debería pedir pulsos (solo mantener el heartbeat). Los
> chequeos del servidor son la red de seguridad.

---

## 5. Reembolsos en MP

Reembolso **total** del pago. Idempotente: gate `payments.refunded_at` +
`X-Idempotency-Key` determinístico por id → nunca devuelve dos veces.

### Disparadores
| Disparador | Dónde | Tipo |
|---|---|---|
| Pulso expira sin ACK | barrido de `index.js` | automático |
| Pago a máquina fuera de servicio | webhook | automático |
| Traba al dispensar (NACK del Arduino) | `POST /arduino/refund/:arduinoId/:pulseId` | automático |
| Botón "Devolver" en la web | `POST /api/mp/payments/:id/refund` | manual (test / a mano) |

### Estado del reembolso (`payments.refund_status`)
`null` (sin reembolso) → `pending` → `done` (con `refunded_at`) / `failed` (con
`refund_error`, se reintenta solo en el próximo barrido).

### Endpoint MP según el origen del pago (`payments.mp_id_kind`)
- `order` (QR, API nueva `/v1/orders`) → `POST /v1/orders/{id}/refund`
- `payment` (API legacy `/v1/payments`) → `POST /v1/payments/{id}/refunds`

### Contrato del firmware ante un pulso
- Dispensó OK → `POST /arduino/ack/:arduinoId/:pulseId`
- Se trabó / no salió → `POST /arduino/refund/:arduinoId/:pulseId` (marca
  `expired` + reembolsa)
- No llama a ninguno → a los 3 min expira solo y también se reembolsa

---

## 6. Principios (no romper)

- **El pago es primario.** Todo pago aprobado por MP se registra siempre, sin
  excepción. El monto y el estado de la máquina solo definen pulsos/reembolso.
- **Pulsos y pago son lógicas separadas.** Cambiar el cálculo de pulsos no toca
  el registro del pago, y viceversa.
- **Una sola fuente de expiración:** el barrido de `index.js`. No reintroducir
  expiración en el poll ni en lecturas.
- **Reembolsos idempotentes.** Cualquier disparo extra es inofensivo.
