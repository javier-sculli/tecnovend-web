# API del Arduino — Tecnovend

**Base URL:** `https://<tu-dominio-railway>.up.railway.app`

---

## Autenticación

Todas las requests del Arduino deben incluir el header:
```
X-Api-Key: <api_key_de_la_maquina>
```

Si la máquina no tiene API key configurada (durante desarrollo), el header se ignora.

---

## 1. Consultar pulsos pendientes

```
GET /arduino/poll/:machineId
```

El Arduino llama este endpoint periódicamente (cada ~3 segundos). Devuelve los pulsos que tiene que ejecutar.

**Ejemplo:**
```
GET /arduino/poll/machine_001
X-Api-Key: tv_live_xxxx
```

**Respuesta — hay pulsos:**
```json
{
  "machine_id": "machine_001",
  "pending_pulses": [
    { "pulse_id": "p_8f3a", "channel": 1, "count": 2 }
  ]
}
```

**Respuesta — sin pulsos:**
```json
{
  "machine_id": "machine_001",
  "pending_pulses": []
}
```

- `channel`: canal de la máquina a activar (1–5)
- `count`: cantidad de pulsos eléctricos a enviar por ese canal
- `pulse_id`: ID que hay que confirmar con el ACK

> Al recibir pulsos, el servidor los marca como `delivered`. Si el Arduino no hace ACK en 10 minutos, expiran automáticamente.

---

## 2. Confirmar ejecución (ACK)

```
POST /arduino/ack/:machineId/:pulseId
X-Api-Key: tv_live_xxxx
```

El Arduino llama este endpoint **después de ejecutar el pulso** (activar el canal y dispensar el producto).

**Respuesta:**
```json
{ "ok": true }
```

---

## Flujo completo

```
1. Arduino hace GET /arduino/poll/machine_001 cada 3 segundos
2. Si pending_pulses está vacío → esperar y volver a consultar
3. Si hay pulsos → para cada uno:
      a. Activar el canal indicado (channel) con la cantidad (count) de pulsos
      b. POST /arduino/ack/machine_001/<pulse_id>
4. Repetir desde 1
```

---

## Comportamiento recomendado del firmware

| Situación | Acción |
|---|---|
| Poll exitoso sin pulsos | Esperar 3s, reintentar |
| Poll con pulsos | Ejecutar inmediatamente, luego ACK |
| Error de red / timeout | Reintentar 3 veces, luego backoff de 30s |
| ACK fallido | Reintentar el ACK (el pulso no se duplica, el servidor lo ignora si ya fue acked) |

---

## IDs de máquina

El `machineId` se configura una vez desde la web de gestión. Formato: `machine_001`, `machine_002`, etc.
