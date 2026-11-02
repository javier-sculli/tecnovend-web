# Implementation Tasks: 001 - Descuento para Empleados vía QR Web

**Feature:** [001-employee-qr-discounts](spec.md) | [Plan](plan.md)  
**Status:** Completed (Fases 1 a 5 listas y verificadas)  

---

## Fase 1: Limpieza del Modelo Anterior (Completado)
- [x] **Task 1.1**: Remover llamadas a `processEmployeeDiscount` en `server/src/routes/webhooks.js`.
- [x] **Task 1.2**: Remover llamadas a `processEmployeeDiscount` en `server/src/services/reconcile.js`.
- [x] **Task 1.3**: Limpiar métodos obsoletos de búsqueda por pagador y reembolsos en `server/src/services/employee-discounts.js`.

---

## Fase 2: Base de Datos & Migraciones (Completado)
- [x] **Task 2.1**: Agregar columna `employee_discount_enabled` en tabla `machines` en `server/src/db/schema.js`.
- [x] **Task 2.2**: Crear tabla `employee_auth_otps` con índices por email y client en `server/src/db/schema.js`.
- [x] **Task 2.3**: Crear tabla `employee_sessions` con token persistente e índices en `server/src/db/schema.js`.
- [x] **Task 2.4**: Crear tabla `employee_payment_intents` para asociar la orden bonificada con los pulsos de lista.

---

## Fase 3: Backend & APIs de Empleados (Completado)
- [x] **Task 3.1**: Crear servicio de autenticación OTP y sesiones de empleados (`server/src/services/employee-auth.js`).
- [x] **Task 3.2**: Crear middleware de autenticación de sesión de empleado (`server/src/middleware/employee-auth.js`).
- [x] **Task 3.3**: Crear router público para empleados (`server/src/routes/employee-portal.js` montado en `/api/emp`):
  - `GET /machine/:machineId`: info pública de la máquina y estado de descuento.
  - `POST /auth/request-otp`: validación contra `client_employees` y envío de código de 4 dígitos.
  - `POST /auth/verify-otp`: verificación de código y emisión de cookie de 180 días.
  - `GET /auth/me`: comprobación de sesión activa y porcentaje de descuento.
  - `POST /checkout/create-order`: creación de preference de MP con `external_reference` (`tv_emp_...`).
- [x] **Task 3.4**: Integrar webhook en `server/src/routes/webhooks.js` para detectar órdenes `tv_emp_...`, despachar pulsos del valor de lista completo y asentar log en `employee_discount_logs`.

---

## Fase 4: Frontend Móvil del Empleado (/e/:machineId) (Completado)
- [x] **Task 4.1**: Diseñar pantalla mobile-first `/e/:machineId` (`client/src/pages/PortalEmpleado.jsx`):
  - Estado de carga y validación de máquina (alerta si la máquina está fuera de servicio).
  - Estructura visual unificada idéntica a la cartelería QR: Logo VendPoint + Badge Beneficio + Cliente + Máquina.
  - Flujo de ingreso de email directo (sin banners redundantes) + verificación de código OTP de 4 dígitos.
  - Cartel de recomendación si se detecta un In-App Browser (WhatsApp, Instagram, etc.).
  - Pantalla principal: saludo al empleado, porcentaje de descuento, monto a pagar y botón "Pagar con Mercado Pago".
  - Pantalla de éxito post-pago: "¡Pago aprobado! Retirá tu producto en la máquina" con polling activo de confirmación de despacho.

---

## Fase 5: Frontend de Gestión (Admin VendPoint) (Completado)
- [x] **Task 5.1**: Actualizar `client/src/pages/Maquinas.jsx` para incluir switch `employee_discount_enabled`.
- [x] **Task 5.2**: Agregar componente de previsualización y descarga del **QR de Empleados** junto al QR de Mercado Pago en la solapa de Pagos de la máquina, con botón de impresión de **Cartel Combinado**.
- [x] **Task 5.3**: Actualizar `client/src/pages/Descuentos.jsx`:
  - Solapa de **Máquinas Habilitadas y QRs** para activar/desactivar beneficios por máquina y descargar cartelería.
  - Dashboard de auditoría actualizado con compras con descuento y métricas de ahorro.

---

## Fase 6: Despliegue (Completado)
- [x] **Task 6.1**: Despliegue a producción en Railway (`cd server && railway up --service tecnovend-api --ci`).
- [x] **Task 6.2**: Despliegue de frontend a Fly.io (`npm run build:web && cd server && fly deploy`).
