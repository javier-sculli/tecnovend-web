# Reglas de Proyecto (tecnovend-web)

## Despliegue en Railway
- Los despliegues a producción en Railway **no** se realizan mediante triggers automáticos de GitHub.
- Siempre se deben desplegar manualmente ejecutando la CLI de Railway desde el directorio `server/`.
- Comando de despliegue:
  ```bash
  cd server && railway up --service tecnovend-api --ci
  ```
