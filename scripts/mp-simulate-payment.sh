#!/usr/bin/env bash
# Simula un pago en MP test usando órdenes tipo "point" (soportan /events)
# El webhook se dispara igual que con QR — sirve para probar el ciclo completo
# Uso: ./mp-simulate-payment.sh [monto_en_ars]
set -euo pipefail

MP_ACCESS_TOKEN="${MP_ACCESS_TOKEN:-APP_USR-2396544005836083-052311-0c58d6d0ac7e0a53778588c3fe556f34-3100407460}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDS_FILE="$SCRIPT_DIR/../mp-test-ids.json"
AMOUNT="${1:-500}"
EXT_REF="TECNOVEND-SIM-$(date +%s)"

echo "=== Tecnovend — Simular pago (via Point order) ==="
echo "   monto : \$$AMOUNT ARS"
echo "   ref   : $EXT_REF"
echo ""

# ─── 1. Crear order tipo point ────────────────────────────────────────────────
echo "1/3  Creando order tipo 'point'..."
ORDER_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.mercadopago.com/v1/orders" \
  -H "Authorization: Bearer $MP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')" \
  -d "{
    \"type\": \"point\",
    \"total_amount\": \"$AMOUNT\",
    \"external_reference\": \"$EXT_REF\",
    \"transactions\": {
      \"payments\": [{
        \"amount\": \"$AMOUNT\"
      }]
    }
  }")
ORDER_HTTP=$(echo "$ORDER_RESP" | tail -1)
ORDER_BODY=$(echo "$ORDER_RESP" | head -1)
echo "   HTTP $ORDER_HTTP — $ORDER_BODY"

ORDER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$ORDER_BODY" 2>/dev/null || true)
if [[ -z "$ORDER_ID" ]]; then
  echo "ERROR: No se pudo crear la order."
  exit 1
fi
echo "   ✓ Order creada: $ORDER_ID"
echo ""

# ─── 2. Simular pago via /events ──────────────────────────────────────────────
echo "2/3  Simulando pago aprobado..."
SIM_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.mercadopago.com/v1/orders/$ORDER_ID/events" \
  -H "Authorization: Bearer $MP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "processed",
    "payment_method_type": "credit_card",
    "installments": 1,
    "payment_method_id": "visa",
    "status_detail": "accredited"
  }')
SIM_HTTP=$(echo "$SIM_RESP" | tail -1)
SIM_BODY=$(echo "$SIM_RESP" | head -1)
echo "   HTTP $SIM_HTTP — $SIM_BODY"

if [[ "$SIM_HTTP" == "204" ]] || [[ "$SIM_HTTP" == "200" ]]; then
  echo "   ✓ SIMULACIÓN OK — pago aprobado (visa crédito)"
  echo "   El webhook debería dispararse en segundos."
else
  echo "   ✗ Error en simulación. Ver respuesta arriba."
fi
echo ""

# ─── 3. Consultar estado final ────────────────────────────────────────────────
echo "3/3  Consultando estado de la order..."
STATUS_RESP=$(curl -s -w "\n%{http_code}" \
  "https://api.mercadopago.com/v1/orders/$ORDER_ID" \
  -H "Authorization: Bearer $MP_ACCESS_TOKEN")
STATUS_HTTP=$(echo "$STATUS_RESP" | tail -1)
STATUS_BODY=$(echo "$STATUS_RESP" | head -1)
echo "   HTTP $STATUS_HTTP"

python3 - "$STATUS_BODY" "$ORDER_ID" "$EXT_REF" "$AMOUNT" "$IDS_FILE" <<'PYEOF'
import json, sys

body, order_id, ext_ref, amount, ids_file = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
try:
    d = json.loads(body)
except Exception:
    print("   Respuesta no JSON:", body)
    sys.exit(0)

status = d.get("status", "?")
print(f"   order_id      : {order_id}")
print(f"   status        : {status}")
print(f"   status_detail : {d.get('status_detail','')}")
print(f"   type          : {d.get('type','')}")

payments = d.get("transactions", {}).get("payments", [])
for p in payments:
    print(f"   payment_id    : {p.get('id','')}")
    print(f"   pay_status    : {p.get('status','')}")
    ref = p.get("reference", {})
    if ref:
        print(f"   mp_payment_id : {ref.get('id','')}")

print()
if status in ("processed", "approved"):
    print("  ✓ APROBADO — el webhook debería dispararse")
else:
    print(f"  Estado: {status}")

try:
    ids = json.load(open(ids_file))
    ids.setdefault("test_payments", []).append({
        "external_reference": ext_ref,
        "order_id": order_id,
        "amount": int(amount),
        "status": status,
    })
    json.dump(ids, open(ids_file, "w"), indent=2, ensure_ascii=False)
    print(f"   ✓ Guardado en mp-test-ids.json")
except Exception as e:
    print(f"   Aviso: no se pudo guardar — {e}")
PYEOF
