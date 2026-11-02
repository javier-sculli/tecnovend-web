# VendPoint Engineering Constitution

## Principios Fundamentales
1. **El pago es la entidad primaria**: Los pulsos se construyen sobre el pago, nunca al revés.
2. **Determinismo en pulsos**: Cada orden tiene un monto explícito y genera pulsos exactos en base a `pulse_value`.
3. **No romper conectividad de hardware**: El puerto TCP Proxy `yamabiko.proxy.rlwy.net:58436` y el servicio `tecnovend-api` en Railway deben mantenerse operativos para las placas ESP32.
4. **Despliegues controlados**: Railway se despliega manual vía CLI en `server/`; Fly.io para web (`vendpoint.com.ar`).
