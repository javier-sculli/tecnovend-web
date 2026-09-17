# Reglas de Proyecto (tecnovend-web)

## Despliegue en Railway
- Los despliegues a producción en Railway **no** se realizan mediante triggers automáticos de GitHub.
- Siempre se deben desplegar manualmente ejecutando la CLI de Railway desde el directorio `server/`.
- Comando de despliegue:
  ```bash
  cd server && railway up --service tecnovend-api --ci
  ```
## Conectividad de Hardware Arduino
- Las placas físicas ESP32 (v0.0.23) están programadas para comunicarse por HTTP plano a través del Railway TCP Proxy: `http://yamabiko.proxy.rlwy.net:58436`.
- NUNCA apagar el servicio `tecnovend-api` en Railway ni desactivar el puerto TCP Proxy `58436`, ya que es el único canal por el que los Arduinos reciben pulsos e informan estado.
