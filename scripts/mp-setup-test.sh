#!/usr/bin/env bash
# Crea sucursal + caja en MP (credenciales de prueba) y guarda los IDs en mp-test-ids.json
set -euo pipefail

# ─── Credenciales ────────────────────────────────────────────────────────────
MP_ACCESS_TOKEN="${MP_ACCESS_TOKEN:-APP_USR-2396544005836083-052311-0c58d6d0ac7e0a53778588c3fe556f34-3100407460}"
USER_ID="3100407460"
EXISTING_STORE_ID="${EXISTING_STORE_ID:-82791230}"   # store_id ya creado
EXISTING_POS_ID="${EXISTING_POS_ID:-132422177}"       # pos_id ya creado
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$SCRIPT_DIR/../mp-test-ids.json"

echo "=== Tecnovend — Setup MP test ==="
echo ""

# ─── 1. Crear sucursal (o reusar existente) ──────────────────────────────────
echo "1/3  Creando sucursal..."
STORE_RESPONSE=$(curl -s -X POST \
  "https://api.mercadopago.com/users/$USER_ID/stores" \
  -H "Authorization: Bearer $MP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tecnovend - Local 001",
    "business_hours": {
      "monday":    [{"open":"08:00","close":"22:00"}],
      "tuesday":   [{"open":"08:00","close":"22:00"}],
      "wednesday": [{"open":"08:00","close":"22:00"}],
      "thursday":  [{"open":"08:00","close":"22:00"}],
      "friday":    [{"open":"08:00","close":"22:00"}],
      "saturday":  [{"open":"09:00","close":"20:00"}]
    },
    "location": {
      "street_number": "1000",
      "street_name": "Av. Corrientes",
      "city_name": "Avellaneda",
      "state_name": "Buenos Aires",
      "latitude": -34.6037,
      "longitude": -58.3816
    },
    "external_id": "TECNOVEND-LOCAL-001"
  }')

echo "Respuesta sucursal: $STORE_RESPONSE"
STORE_ID=$(echo "$STORE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])" 2>/dev/null || true)

# Si ya existe, usar el ID conocido
if [[ -z "$STORE_ID" ]]; then
  echo "   La sucursal ya existe, usando store_id conocido: $EXISTING_STORE_ID"
  STORE_ID="$EXISTING_STORE_ID"
  STORE_RESPONSE="{\"id\":$STORE_ID,\"external_id\":\"TECNOVEND-LOCAL-001\",\"name\":\"Tecnovend - Local 001\"}"
fi

if [[ -z "$STORE_ID" ]]; then
  echo "ERROR: No se pudo crear ni encontrar la sucursal."
  echo "Respuesta: $STORE_RESPONSE"
  exit 1
fi
echo "   ✓ Sucursal lista — store_id: $STORE_ID"
echo ""

# ─── 2. Crear caja (POS) ─────────────────────────────────────────────────────
echo "2/3  Creando caja (POS)..."
POS_RESPONSE=$(curl -s -X POST \
  "https://api.mercadopago.com/pos" \
  -H "Authorization: Bearer $MP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Tecnovend - Caja 001\",
    \"fixed_amount\": false,
    \"category\": 473000,
    \"store_id\": $STORE_ID,
    \"external_store_id\": \"TECNOVEND-LOCAL-001\",
    \"external_id\": \"TECNOVENDPOS001\"
  }")

echo "Respuesta caja: $POS_RESPONSE"
POS_ID=$(echo "$POS_RESPONSE"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])"       2>/dev/null || true)
POS_NAME=$(echo "$POS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name',''))" 2>/dev/null || true)
QR_DATA=$(echo "$POS_RESPONSE"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('qr',{}).get('image','N/A'))" 2>/dev/null || true)

if [[ -z "$POS_ID" ]]; then
  echo "   La caja ya existe, usando pos_id conocido: $EXISTING_POS_ID"
  POS_ID="$EXISTING_POS_ID"
  POS_RESPONSE="{\"id\":$POS_ID,\"name\":\"Tecnovend - Caja 001\",\"external_id\":\"TECNOVENDPOS001\",\"store_id\":\"$STORE_ID\",\"qr\":{}}"
  POS_NAME="Tecnovend - Caja 001"
  QR_DATA="N/A"
fi
echo "   ✓ Caja lista — pos_id: $POS_ID"
echo ""

# ─── 3. Guardar IDs ──────────────────────────────────────────────────────────
echo "3/3  Guardando IDs en $OUTPUT ..."
# Exportar variables para que Python las lea como env vars (evita embeber JSON en código Python)
export _STORE_JSON="$STORE_RESPONSE"
export _POS_JSON="$POS_RESPONSE"
python3 - "$OUTPUT" "$USER_ID" "$STORE_ID" "$POS_ID" <<'PYEOF'
import json, sys, os

output, user_id, store_id, pos_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
store = json.loads(os.environ["_STORE_JSON"])
pos   = json.loads(os.environ["_POS_JSON"])

data = {
  "environment": "test",
  "user_id": user_id,
  "store": {
    "id": store_id,
    "external_id": "TECNOVEND-LOCAL-001",
    "name": store.get("name", "Tecnovend - Local 001"),
    "response": store
  },
  "pos": {
    "id": pos_id,
    "external_id": "TECNOVENDPOS001",
    "name": pos.get("name", ""),
    "qr_image": pos.get("qr", {}).get("image", ""),
    "response": pos
  }
}
with open(output, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print("   ✓ IDs guardados")
PYEOF

echo ""
echo "=== Listo ==="
echo "   store_id : $STORE_ID"
echo "   pos_id   : $POS_ID"
echo "   QR image : $QR_DATA"
echo ""
echo "Próximo paso: corré scripts/mp-simulate-payment.sh para simular un pago."
