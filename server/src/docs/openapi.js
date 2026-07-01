// Especificación OpenAPI 3.0 de la API de VendPoint.
// Hecha a mano (sin dependencias) para documentar todos los endpoints.
// Se sirve como JSON en /api/openapi.json y con Swagger UI en /api/docs.

const json = (schema) => ({ 'application/json': { schema } });

const ok = (description, schema) => ({
  description,
  ...(schema ? { content: json(schema) } : {}),
});

// ── Esquemas reutilizables ──────────────────────────────────────────────────
const Machine = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'machine_001' },
    name: { type: 'string', example: 'Expendedora Hall A' },
    location: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    model: { type: 'string', nullable: true },
    arduino_id: { type: 'string', nullable: true, example: '3C71BF4A2B08', description: 'Serial de la placa = identificador del Arduino. El firmware lo manda en todos los endpoints /arduino/* para identificar la máquina. `device_serial` guarda el mismo valor (son lo mismo).' },
    device_serial: { type: 'string', nullable: true, description: 'Espejo de `arduino_id` (el serial de placa). Se mantienen iguales.' },
    client_id: { type: 'string', nullable: true, example: 'cli_a1b2c3' },
    pos_id: { type: 'string', nullable: true, description: 'ID del QR/caja de MP (Fase 1)' },
    terminal_id: { type: 'string', nullable: true, description: 'ID del Point de MP (Fase 2)' },
    mp_pos_id: { type: 'string', nullable: true },
    mp_store_id: { type: 'string', nullable: true },
    pulse_value: { type: 'integer', example: 200, description: 'ARS por pulso' },
    pulse_duration_ms: { type: 'integer', example: 200, description: 'Tiempo del pulso eléctrico (ms)' },
    pulse_gap_ms: { type: 'integer', example: 200, description: 'Distancia entre pulsos consecutivos (ms)' },
    min_payment: { type: 'integer', example: 200 },
    wifi_ssid: { type: 'string', nullable: true, description: 'Red WiFi propia de la máquina (la lee el firmware en /arduino/config)' },
    wifi_user: { type: 'string', nullable: true, description: 'Usuario WiFi (WPA-Enterprise), opcional' },
    wifi_password: { type: 'string', nullable: true, description: 'Clave WiFi' },
    qr_mode: { type: 'string', enum: ['dynamic', 'fixed'], description: "Precio del QR de MP: 'dynamic' = el cliente tipea el monto; 'fixed' = el QR queda cargado con una orden por qr_fixed_amount (se re-arma tras cada pago)" },
    qr_fixed_amount: { type: 'integer', nullable: true, minimum: 15, description: 'ARS del precio fijo del QR (requerido si qr_mode=fixed; mínimo $15 de MP)' },
    channels_config: { type: 'array', items: { type: 'object' } },
    status: { type: 'string', enum: ['active', 'inactive', 'maintenance'] },
    state: {
      type: 'string',
      enum: ['online', 'out_of_service', 'offline'],
      description: 'Estado consolidado: online = latió en la última hora y en servicio; out_of_service = avisó que está fuera de servicio; offline = sin heartbeat hace +1h',
    },
    last_seen_at: { type: 'string', nullable: true, description: 'Último contacto (UTC)' },
    payments_week: { type: 'integer', description: 'Pagos aprobados en los últimos 7 días' },
    revenue_week: { type: 'integer', description: 'Recaudación (ARS) de los últimos 7 días' },
    created_at: { type: 'string' },
  },
};

const Payment = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    machine_id: { type: 'string' },
    mp_payment_id: { type: 'string', description: 'ID de MP, clave de deduplicación' },
    amount: { type: 'integer', description: 'ARS' },
    method: { type: 'string', enum: ['qr', 'card', 'other'] },
    status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'error'] },
    pulses_calculated: { type: 'integer' },
    created_at: { type: 'string' },
    mp_id_kind: { type: 'string', enum: ['order', 'payment'], nullable: true, description: 'Si mp_payment_id es id de order (QR) o de payment (legacy) — define por dónde se reembolsa' },
    refund_status: { type: 'string', enum: ['pending', 'done', 'failed'], nullable: true, description: 'Reembolso en MP: se dispara solo si el pulso expiró sin ACK o el pago fue a una máquina fuera de servicio' },
    refunded_at: { type: 'string', nullable: true, description: 'Cuándo se reembolsó (UTC)' },
    refund_error: { type: 'string', nullable: true, description: 'Último error de reembolso, si falló (se reintenta)' },
  },
};

const Client = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'cli_a1b2c3' },
    name: { type: 'string' },
    contact_name: { type: 'string', nullable: true },
    contact_email: { type: 'string', nullable: true },
    contact_phone: { type: 'string', nullable: true },
    notes: { type: 'string', nullable: true },
    machine_count: { type: 'integer' },
    created_at: { type: 'string' },
  },
};

const Event = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['heartbeat', 'config', 'service', 'ack', 'payment'] },
    kind: { type: 'string', enum: ['ok', 'warn', 'bad'] },
    title: { type: 'string' },
    desc: { type: 'string' },
    at: { type: 'string', description: 'Fecha del evento (UTC)' },
  },
};

const PulseQueue = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'p_8f3a' },
    machine_id: { type: 'string' },
    payment_id: { type: 'string', format: 'uuid', nullable: true },
    channel: { type: 'integer', description: 'Canal 1-5' },
    count: { type: 'integer', description: 'Cantidad de pulsos' },
    status: {
      type: 'string',
      enum: ['pending', 'delivered', 'acked', 'expired'],
      description: "pending = en cola; delivered = entregado al Arduino, esperando ACK; acked = acreditado; expired = sin ACK en 3 min, no acreditó",
    },
    created_at: { type: 'string' },
    acked_at: { type: 'string', nullable: true },
    expires_at: { type: 'string', description: 'Vencimiento de la ventana de ACK (UTC)' },
  },
};

const Error = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

const apiKeyHeader = {
  name: 'x-api-key',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description: 'API key de la máquina (prefijo tv_live_ / tv_test_). Se valida contra el hash guardado.',
};

const machineIdParam = {
  name: 'machineId', in: 'path', required: true, schema: { type: 'string' }, example: 'machine_001',
};
const arduinoIdParam = {
  name: 'arduinoId', in: 'path', required: true, schema: { type: 'string' }, example: 'ARD-7F3A9C',
  description: 'ID alfanumérico del Arduino (grabado en el firmware). El servidor resuelve a qué máquina pertenece.',
};
const idParam = (desc) => ({ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: desc });

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'VendPoint API',
    version: '1.0.0',
    description:
      'API del sistema de pagos para máquinas expendedoras de VendPoint.\n\n' +
      'Integra Mercado Pago (QR Fase 1, Point Fase 2) con firmware ESP32. ' +
      'El flujo es: MP notifica un pago por webhook → el servidor lo registra y encola pulsos → ' +
      'el Arduino hace polling y los ejecuta.\n\n' +
      '**Principio:** todo pago aprobado por MP se registra siempre; el monto solo define cuántos pulsos se encolan.',
  },
  servers: [
    { url: 'https://www.vendpoint.com.ar', description: 'Producción' },
    { url: 'http://localhost:3000', description: 'Local' },
  ],
  tags: [
    { name: 'Salud', description: 'Estado del servicio' },
    { name: 'Máquinas', description: 'Alta, configuración y monitoreo de máquinas expendedoras' },
    { name: 'Clientes', description: 'Dueños/operadores de las máquinas (datos de contacto)' },
    { name: 'Arduino', description: 'Endpoints que consume el firmware ESP32 (polling, ACK, config, heartbeat)' },
    { name: 'Mercado Pago', description: 'OAuth, stores, cajas (POS), órdenes QR y pagos' },
    { name: 'Webhooks', description: 'Notificaciones IPN entrantes de Mercado Pago' },
  ],
  components: {
    schemas: { Machine, Payment, Client, Event, PulseQueue, Error },
  },
  paths: {
    // ── Salud ────────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Salud'],
        summary: 'Healthcheck',
        description: 'Verifica que el servidor esté vivo. Lo usa Railway para el monitoreo.',
        responses: { 200: ok('Servicio operativo', { type: 'object', properties: { status: { type: 'string', example: 'ok' }, ts: { type: 'string' } } }) },
      },
    },

    // ── Máquinas ─────────────────────────────────────────────────────────────
    '/api/machines': {
      get: {
        tags: ['Máquinas'],
        summary: 'Listar máquinas',
        description: 'Devuelve todas las máquinas con su estado consolidado (`state`) y métricas de la última semana (pagos y recaudación).',
        responses: { 200: ok('Lista de máquinas', { type: 'array', items: { $ref: '#/components/schemas/Machine' } }) },
      },
      post: {
        tags: ['Máquinas'],
        summary: 'Registrar máquina',
        description: 'Da de alta una máquina. `id` y `name` son obligatorios. El resto de los campos son opcionales y tienen defaults (pulse_value 200, min_payment 200). Al crearla, el servidor provisiona automáticamente en MP **en la cuenta del cliente** (`client_id`): usa (o crea) el local default `tv_default` y le crea una caja QR propia (`external_id` = id de la máquina), asociándola. Es best-effort: si MP falla (p.ej. el cliente no conectó su cuenta), la máquina queda creada igual y la respuesta trae `mp_error`.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id: { type: 'string', example: 'machine_001' },
              name: { type: 'string', example: 'Expendedora Hall A' },
              location: { type: 'string' },
              address: { type: 'string' },
              arduino_id: { type: 'string', description: 'Serial de placa = identificador del Arduino. Se guarda en `arduino_id` y `device_serial` (son lo mismo). También se acepta `device_serial`.', example: '3C71BF4A2B08' },
              client_id: { type: 'string' },
              pulse_value: { type: 'integer', default: 200 },
              min_payment: { type: 'integer', default: 200 },
              channels_config: { type: 'array', items: { type: 'object' } },
              wifi_ssid: { type: 'string' }, wifi_user: { type: 'string' }, wifi_password: { type: 'string' },
            },
          }),
        },
        responses: {
          201: ok('Creada', { type: 'object', properties: { id: { type: 'string' }, mp: { type: 'object', nullable: true, description: 'Datos de la caja provisionada en MP (pos_id, mp_pos_id, store_id, qr_code…). null si la provisión falló.' }, mp_error: { type: 'string', nullable: true, description: 'Mensaje de error si no se pudo provisionar la caja en MP.' } } }),
          400: ok('Faltan id o name', Error),
        },
      },
    },
    '/api/machines/{id}': {
      get: {
        tags: ['Máquinas'],
        summary: 'Detalle de máquina',
        description: 'Devuelve la máquina con su `state`, configuración de canales y los últimos 20 pagos.',
        parameters: [idParam('ID de la máquina')],
        responses: { 200: ok('Detalle', { $ref: '#/components/schemas/Machine' }), 404: ok('No encontrada', Error) },
      },
      put: {
        tags: ['Máquinas'],
        summary: 'Actualizar configuración',
        description: 'Actualiza campos de la máquina (solo los enviados; el resto se mantiene). Principal uso desde la web: editar `pulse_value`, vincular cliente, cambiar `status` o configurar el precio del QR (`qr_mode`/`qr_fixed_amount`). Si queda en precio fijo, carga la orden en el QR y devuelve `qr_armed` (true/false según MP).',
        parameters: [idParam('ID de la máquina')],
        requestBody: { content: json({ $ref: '#/components/schemas/Machine' }) },
        responses: { 200: ok('Actualizada', { type: 'object', properties: { ok: { type: 'boolean' }, qr_armed: { type: 'boolean', description: 'Solo si se tocó la config del QR: true = orden cargada en MP' } } }), 400: ok('qr_mode/qr_fixed_amount inválidos', Error), 404: ok('No encontrada', Error) },
      },
      delete: {
        tags: ['Máquinas'],
        summary: 'Eliminar máquina',
        description: 'Borra la máquina y todo lo que cuelga de ella (pagos, pulsos y eventos). No toca la caja en Mercado Pago: el local/caja quedan en la cuenta del cliente. Acción irreversible.',
        parameters: [idParam('ID de la máquina')],
        responses: { 200: ok('Eliminada', { type: 'object', properties: { ok: { type: 'boolean' } } }), 404: ok('No encontrada', Error), 500: ok('Error al eliminar', Error) },
      },
    },
    '/api/machines/{id}/payments': {
      get: {
        tags: ['Máquinas'],
        summary: 'Historial de pagos',
        description: 'Todos los pagos de la máquina, ordenados del más reciente al más antiguo.',
        parameters: [idParam('ID de la máquina')],
        responses: { 200: ok('Pagos', { type: 'array', items: { $ref: '#/components/schemas/Payment' } }) },
      },
    },
    '/api/machines/{id}/events': {
      get: {
        tags: ['Máquinas'],
        summary: 'Feed de eventos',
        description: 'Feed unificado y ordenado por fecha que junta: heartbeats, pedidos de config y avisos de servicio del firmware; ACK de pulsos confirmados; y pagos aprobados/rechazados.',
        parameters: [
          idParam('ID de la máquina'),
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 60, maximum: 500 } },
        ],
        responses: { 200: ok('Eventos', { type: 'array', items: { $ref: '#/components/schemas/Event' } }) },
      },
    },
    '/api/machines/{id}/pulses': {
      get: {
        tags: ['Máquinas'],
        summary: 'Cola de pulsos',
        description: 'Pulsos de la máquina, con los pendientes y entregados (en vuelo) arriba. La expiración de vencidos (más de 3 min sin ACK → `expired`, no acreditaron) la maneja un barrido periódico del servidor, no este endpoint.',
        parameters: [
          idParam('ID de la máquina'),
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } },
        ],
        responses: { 200: ok('Pulsos', { type: 'array', items: { $ref: '#/components/schemas/PulseQueue' } }) },
      },
    },
    '/api/machines/{id}/pulses/{pulseId}': {
      delete: {
        tags: ['Máquinas'],
        summary: 'Eliminar pulso de la cola',
        description: 'Cancelación manual desde la web: borra el pulso de la cola (no se va a acreditar en la máquina).',
        parameters: [
          idParam('ID de la máquina'),
          { name: 'pulseId', in: 'path', required: true, schema: { type: 'string' }, example: 'p_8f3a' },
        ],
        responses: { 200: ok('Eliminado', { type: 'object', properties: { ok: { type: 'boolean' } } }), 404: ok('No encontrado', Error) },
      },
    },

    // ── Clientes ─────────────────────────────────────────────────────────────
    '/api/clients': {
      get: {
        tags: ['Clientes'],
        summary: 'Listar clientes',
        description: 'Clientes (operadores) con la cantidad de máquinas vinculadas a cada uno.',
        responses: { 200: ok('Clientes', { type: 'array', items: { $ref: '#/components/schemas/Client' } }) },
      },
      post: {
        tags: ['Clientes'],
        summary: 'Crear cliente',
        description: 'Da de alta un cliente. `name` es obligatorio. La config WiFi ahora vive a nivel máquina, no del cliente.',
        requestBody: {
          required: true,
          content: json({
            type: 'object', required: ['name'],
            properties: {
              name: { type: 'string' }, contact_name: { type: 'string' }, contact_email: { type: 'string' }, contact_phone: { type: 'string' },
              notes: { type: 'string' },
            },
          }),
        },
        responses: { 201: ok('Creado', { type: 'object', properties: { id: { type: 'string' } } }), 400: ok('Falta name', Error) },
      },
    },
    '/api/clients/{id}': {
      get: {
        tags: ['Clientes'],
        summary: 'Detalle de cliente',
        description: 'Datos del cliente más la lista de sus máquinas.',
        parameters: [idParam('ID del cliente')],
        responses: { 200: ok('Detalle', { $ref: '#/components/schemas/Client' }), 404: ok('No encontrado', Error) },
      },
      put: {
        tags: ['Clientes'],
        summary: 'Actualizar cliente',
        description: 'Actualiza datos de contacto y notas del cliente.',
        parameters: [idParam('ID del cliente')],
        requestBody: { content: json({ $ref: '#/components/schemas/Client' }) },
        responses: { 200: ok('Actualizado', { type: 'object', properties: { ok: { type: 'boolean' } } }), 404: ok('No encontrado', Error) },
      },
    },

    // ── Arduino ──────────────────────────────────────────────────────────────
    '/arduino/poll/{arduinoId}': {
      get: {
        tags: ['Arduino'],
        summary: 'Polling de pulsos pendientes',
        description: 'El firmware llama cada ~3s con su `arduino_id`. El servidor resuelve la máquina, expira pulsos vencidos (más de 3 min sin ACK), entrega los pendientes (los pasa a `delivered`) y los devuelve. Si la máquina está **fuera de servicio** no entrega pulsos (devuelve la lista vacía). Requiere `x-api-key` si la máquina tiene clave configurada. **No** actualiza `last_seen_at`: la señal de vida la marca únicamente `POST /arduino/heartbeat/{arduinoId}`.',
        parameters: [arduinoIdParam, apiKeyHeader],
        responses: {
          200: ok('Pulsos pendientes', {
            type: 'object',
            properties: {
              machine_id: { type: 'string' },
              pending_pulses: { type: 'array', items: { type: 'object', properties: { pulse_id: { type: 'string', example: 'p_8f3a' }, channel: { type: 'integer' }, count: { type: 'integer' } } } },
            },
          }),
          401: ok('API key inválida', Error), 404: ok('Arduino no registrado', Error),
        },
      },
    },
    '/arduino/ack/{arduinoId}/{pulseId}': {
      post: {
        tags: ['Arduino'],
        summary: 'Confirmar pulso ejecutado',
        description: 'El Arduino confirma que ejecutó un pulso. Lo marca como `acked` con timestamp. Si no llega el ACK en 3 minutos, el pulso expira (no acredita, prevención de pulso fantasma). Rechaza el ACK si la máquina está fuera de servicio o si el pulso ya expiró.',
        parameters: [arduinoIdParam, { name: 'pulseId', in: 'path', required: true, schema: { type: 'string' }, example: 'p_8f3a' }, apiKeyHeader],
        responses: { 200: ok('Confirmado', { type: 'object', properties: { ok: { type: 'boolean' } } }), 401: ok('API key inválida', Error), 404: ok('Arduino no registrado o pulso no encontrado', Error), 409: ok('Máquina fuera de servicio o pulso expirado', Error) },
      },
    },
    '/arduino/refund/{arduinoId}/{pulseId}': {
      post: {
        tags: ['Arduino'],
        summary: 'Reportar traba y devolver el pago',
        description: 'El Arduino avisa que NO pudo dispensar (se trabó operando ese pulso) y pide devolver el pago. Inverso del ACK: marca el pulso como `expired` (no acreditó) y reembolsa el pago asociado en MP. Idempotente. Rechaza si el pulso ya fue confirmado (`acked`).',
        parameters: [arduinoIdParam, { name: 'pulseId', in: 'path', required: true, schema: { type: 'string' }, example: 'p_8f3a' }, apiKeyHeader],
        responses: {
          200: ok('Procesado', { type: 'object', properties: { ok: { type: 'boolean' }, pulse_id: { type: 'string' }, refunded: { type: 'boolean', description: 'true si MP confirmó el reembolso; si false quedó pendiente de reintento' }, refund_error: { type: 'string', nullable: true } } }),
          401: ok('API key inválida', Error),
          404: ok('Arduino no registrado o pulso no encontrado', Error),
          409: ok('El pulso ya fue confirmado (acreditado)', Error),
        },
      },
    },
    '/arduino/config/{arduinoId}': {
      get: {
        tags: ['Arduino'],
        summary: 'Configuración de la máquina',
        description: 'Devuelve la config que necesita el firmware: credenciales WiFi propias de la máquina y parámetros de pulso (`pulse_value`, `pulse_duration_ms`, `pulse_gap_ms`). Registra un evento `config`.',
        parameters: [arduinoIdParam, apiKeyHeader],
        responses: {
          200: ok('Config', {
            type: 'object',
            properties: {
              machine_id: { type: 'string' },
              wifi: { type: 'object', properties: { ssid: { type: 'string', nullable: true }, user: { type: 'string', nullable: true }, password: { type: 'string', nullable: true } } },
              config: { type: 'object', properties: { pulse_value: { type: 'integer', nullable: true }, pulse_duration_ms: { type: 'integer', nullable: true }, pulse_gap_ms: { type: 'integer', nullable: true } } },
            },
          }),
          401: ok('API key inválida', Error), 404: ok('Arduino no registrado', Error),
        },
      },
    },
    '/arduino/heartbeat/{arduinoId}': {
      post: {
        tags: ['Arduino'],
        summary: 'Heartbeat (señal de vida)',
        description: 'El Arduino late en background aunque nadie opere la máquina. Actualiza `last_seen_at` y opcionalmente RSSI, uptime y versión de firmware. Es el único input del estado de la máquina: si trae `in_service` (opcional), también ajusta el status (`true` → `active`, `false` → `maintenance`) y registra un evento `service`. Registra un evento `heartbeat`.',
        parameters: [arduinoIdParam, apiKeyHeader],
        requestBody: {
          content: json({
            type: 'object',
            properties: {
              rssi: { type: 'integer', example: -62, description: 'dBm de señal WiFi' },
              uptime: { type: 'integer', description: 'segundos encendido' },
              fw: { type: 'string', description: 'versión de firmware' },
              in_service: { type: 'boolean', description: 'opcional: true = active, false = maintenance. Si se omite, no cambia el status' },
              reason: { type: 'string', description: 'opcional: motivo por el cual la máquina reporta fuera de servicio o error (ej: sale_timeout)' },
              affected_pulse_id: { type: 'string', description: 'opcional: ID del pulso afectado que causó la falla para disparar reembolso automático' },
            },
          }),
        },
        responses: { 200: ok('OK', { type: 'object', properties: { ok: { type: 'boolean' }, machine_id: { type: 'string' }, status: { type: 'string', description: 'estado actual de la máquina; el firmware solo debería poolear cuando es active' } } }), 401: ok('API key inválida', Error), 404: ok('Arduino no registrado', Error) },
      },
    },

    // ── Mercado Pago ─────────────────────────────────────────────────────────
    '/api/mp/auth': {
      get: {
        tags: ['Mercado Pago'],
        summary: 'Iniciar OAuth (por cliente)',
        description: 'Redirige al portal de Mercado Pago para que el cliente indicado (`?org=<clientId>`) autorice SU cuenta. El local y las cajas de sus máquinas viven en esa cuenta. Genera y guarda un `state` anti-CSRF junto con el cliente que conecta.',
        parameters: [{ name: 'org', in: 'query', required: true, schema: { type: 'string' }, description: 'client_id de la organización que conecta su cuenta MP' }],
        responses: { 302: { description: 'Redirección a auth.mercadopago.com' }, 400: { description: 'Falta org' } },
      },
    },
    '/api/mp/auth/callback': {
      get: {
        tags: ['Mercado Pago'],
        summary: 'Callback de OAuth',
        description: 'MP redirige acá con el `code`. Verifica el `state`, intercambia el code por access/refresh token y los guarda. Redirige a la web con `?mp_connected=1`.',
        parameters: [
          { name: 'code', in: 'query', schema: { type: 'string' } },
          { name: 'state', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 302: { description: 'Redirección a la web' }, 400: { description: 'Falta code o state inválido' } },
      },
    },
    '/api/mp/auth/disconnect': {
      post: {
        tags: ['Mercado Pago'],
        summary: 'Desvincular cuenta MP del cliente activo',
        description: 'Borra la conexión MP (token + refresh + user_id) del cliente activo (header `x-org-id`).',
        responses: { 200: ok('Desvinculado', { type: 'object', properties: { ok: { type: 'boolean' } } }), 400: ok('Falta org', Error) },
      },
    },
    '/api/mp/status': {
      get: {
        tags: ['Mercado Pago'],
        summary: 'Estado de la conexión (del cliente activo)',
        description: '`connected` indica si el cliente activo (header `x-org-id`) tiene SU propia cuenta de MP conectada (no usa el token global). Lo usa el gate de alta de máquinas.',
        responses: { 200: ok('Estado', { type: 'object', properties: { connected: { type: 'boolean' }, user_id: { type: 'integer' }, oauth: { type: 'boolean' }, error: { type: 'string' } } }) },
      },
    },
    '/api/mp/stores': {
      get: { tags: ['Mercado Pago'], summary: 'Listar stores', description: 'Locales (stores) de la cuenta de MP.', responses: { 200: ok('Stores', { type: 'array', items: { type: 'object' } }) } },
    },
    '/api/mp/stores/{id}': {
      get: { tags: ['Mercado Pago'], summary: 'Detalle de store', parameters: [idParam('ID del store en MP')], responses: { 200: ok('Store', { type: 'object' }), 404: ok('No encontrado', Error) } },
    },
    '/api/mp/pos': {
      get: {
        tags: ['Mercado Pago'], summary: 'Listar cajas (POS)',
        description: 'Cajas/POS de la cuenta. Si se pasa `storeId`, filtra por ese local.',
        parameters: [{ name: 'storeId', in: 'query', schema: { type: 'string' } }],
        responses: { 200: ok('POS', { type: 'array', items: { type: 'object' } }) },
      },
    },
    '/api/mp/pos/{machineId}': {
      post: {
        tags: ['Mercado Pago'], summary: 'Crear (o reutilizar) la caja de una máquina',
        description: 'Provisiona la caja (POS) de la máquina dentro del local default `tv_default` **en la cuenta MP del cliente de la máquina** (lo crea si no existe) y guarda `pos_id`/`mp_pos_id`/`mp_store_id`. Idempotente: si la máquina ya tiene su caja, la reutiliza. Devuelve el QR generado. Es la misma lógica que corre al dar de alta una máquina.',
        parameters: [machineIdParam],
        responses: {
          200: ok('Creado', { type: 'object', properties: { ok: { type: 'boolean' }, pos_id: {}, mp_pos_id: {}, store_id: {}, store_name: { type: 'string' }, qr_code: { type: 'string' }, qr_code_base64: { type: 'string' } } }),
          404: ok('Máquina no encontrada', Error), 500: ok('Error de MP', Error),
        },
      },
      get: {
        tags: ['Mercado Pago'], summary: 'Datos del POS + QR de una máquina',
        description: 'Obtiene el POS asociado a la máquina (incluye el QR). Requiere que la máquina tenga `mp_pos_id`.',
        parameters: [machineIdParam],
        responses: { 200: ok('POS', { type: 'object' }), 404: ok('Sin POS configurado', Error) },
      },
    },
    '/api/mp/pos/{machineId}/order': {
      put: {
        tags: ['Mercado Pago'], summary: 'Cargar orden al QR',
        description: 'Crea una orden QR dinámica por un monto. El mínimo de MP es $15. Devuelve la referencia externa y el order_id. Rechaza si la máquina está fuera de servicio.',
        parameters: [machineIdParam],
        requestBody: { required: true, content: json({ type: 'object', required: ['amount'], properties: { amount: { type: 'integer', minimum: 15 }, description: { type: 'string' } } }) },
        responses: { 200: ok('Orden creada', { type: 'object', properties: { ok: { type: 'boolean' }, external_reference: { type: 'string' }, order_id: {} } }), 400: ok('Monto inválido', Error), 404: ok('Sin POS', Error), 409: ok('Máquina fuera de servicio', Error) },
      },
      delete: {
        tags: ['Mercado Pago'], summary: 'Limpiar orden del QR',
        description: 'Limpia la orden del QR estático. Con la nueva API de orders es no-op (las órdenes expiran solas).',
        parameters: [machineIdParam],
        responses: { 200: ok('OK', { type: 'object', properties: { ok: { type: 'boolean' } } }), 404: ok('Sin POS', Error) },
      },
    },
    '/api/mp/orders/{orderId}': {
      get: {
        tags: ['Mercado Pago'], summary: 'Estado de una orden',
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: ok('Orden', { type: 'object', properties: { id: {}, status: { type: 'string' }, total_amount: {} } }), 500: ok('Error', Error) },
      },
    },
    '/api/mp/payments': {
      get: {
        tags: ['Mercado Pago'], summary: 'Pagos recientes (BD local)',
        description: 'Pagos guardados en la BD local. Filtros opcionales por máquina, fecha y límite.',
        parameters: [
          { name: 'machineId', in: 'query', schema: { type: 'string' } },
          { name: 'since', in: 'query', schema: { type: 'string' }, description: 'created_at > since' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: ok('Pagos', { type: 'array', items: { $ref: '#/components/schemas/Payment' } }) },
      },
    },
    '/api/mp/payments/{id}/refund': {
      post: {
        tags: ['Mercado Pago'], summary: 'Reembolsar pago (manual)',
        description: 'Reembolsa el total del pago en MP (botón "Devolver" de la web: test o corrección a mano). Idempotente: si ya estaba reembolsado responde ok sin volver a llamar a MP.',
        parameters: [idParam('ID interno del pago (UUID en la BD)')],
        responses: {
          200: ok('Reembolsado', { type: 'object', properties: { ok: { type: 'boolean' }, already: { type: 'boolean' } } }),
          404: ok('Pago no encontrado', Error),
          409: ok('El pago no está aprobado', Error),
          502: ok('MP rechazó el reembolso', Error),
        },
      },
    },

    // ── Webhooks ─────────────────────────────────────────────────────────────
    '/api/webhooks/mercadopago': {
      post: {
        tags: ['Webhooks'],
        summary: 'IPN de Mercado Pago',
        description:
          'Recibe las notificaciones de MP (órdenes y pagos). Responde 200 de inmediato (MP exige <5s) y procesa en background: ' +
          'verifica la firma HMAC, consulta el detalle en MP, valida que esté aprobado, ubica la máquina por `pos_id`, deduplica por `mp_payment_id`, ' +
          'registra el pago SIEMPRE y encola los pulsos si el monto alcanza. Todo queda logueado en `webhook_logs`.',
        requestBody: { content: json({ type: 'object', properties: { type: { type: 'string', example: 'payment' }, action: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'string' } } } } }) },
        responses: { 200: ok('Recibido', { type: 'object', properties: { ok: { type: 'boolean' } } }) },
      },
    },
  },
};
