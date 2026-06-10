#!/usr/bin/env bash
# Crea un par de usuarios de prueba en MP (vendedor + comprador)
# Los guarda en mp-test-users.json para uso posterior
set -euo pipefail

MP_ACCESS_TOKEN="${MP_ACCESS_TOKEN:-APP_USR-2396544005836083-052311-0c58d6d0ac7e0a53778588c3fe556f34-3100407460}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$SCRIPT_DIR/../mp-test-users.json"

echo "=== Tecnovend — Crear usuarios de prueba ==="
echo ""

create_user() {
  local site_id="$1"
  curl -s -X POST \
    "https://api.mercadopago.com/users/test_user" \
    -H "Authorization: Bearer $MP_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"site_id\": \"$site_id\"}"
}

echo "1/2  Creando usuario VENDEDOR (site MLA)..."
SELLER=$(create_user "MLA")
echo "   $SELLER"
echo ""

echo "2/2  Creando usuario COMPRADOR (site MLA)..."
BUYER=$(create_user "MLA")
echo "   $BUYER"
echo ""

python3 - <<EOF
import json
seller = $SELLER
buyer  = $BUYER
data = {
  "seller": {
    "id":       seller.get("id"),
    "email":    seller.get("email"),
    "password": seller.get("password"),
    "nickname": seller.get("nickname"),
  },
  "buyer": {
    "id":       buyer.get("id"),
    "email":    buyer.get("email"),
    "password": buyer.get("password"),
    "nickname": buyer.get("nickname"),
  }
}
with open("$OUTPUT", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("=== Usuarios creados ===")
print(f"  VENDEDOR  email: {data['seller']['email']}  password: {data['seller']['password']}")
print(f"  COMPRADOR email: {data['buyer']['email']}   password: {data['buyer']['password']}")
print(f"\nGuardados en: $OUTPUT")
print("\nUso:")
print("  - Loguéate en la app MP con el usuario COMPRADOR")
print("  - Escaneá el QR generado por mp-simulate-payment.sh")
print("  - O usá las tarjetas de prueba: https://www.mercadopago.com.ar/developers/es/docs/additional-content/your-integrations/test-cards")
EOF
