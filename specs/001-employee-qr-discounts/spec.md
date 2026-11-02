# Feature Specification: 001 - Descuento para Empleados vía QR Web

**Feature Branch:** `feature/001-employee-qr-discounts`  
**Status:** Approved  
**Created:** 2026-11-02  
**Author:** Javier Sculli  

---

## 1. Contexto & Problema

### Problema Actual
El modelo anterior intentaba identificar a los empleados mediante los datos de pagador que Mercado Pago supuestamente enviaba en el webhook (`payer.email` o `payer.identification.number`) para luego realizar un reembolso parcial automático vía API de MP.  
En la práctica, Mercado Pago anonimiza u omite los datos del pagador en pagos presenciales por QR, provocando que los cruces fallen sistemáticamente y ningún empleado reciba el descuento prometido.

### Solución Propuesta
Reemplazar el cruce posterior a ciegas por un **QR físico exclusivo para empleados** en la máquina:
1. El empleado escanea el QR con su celular y accede a una webapp mobile (`https://vendpoint.com.ar/e/:machineId`).
2. Valida su identidad mediante su **email corporativo precargado** y un **código OTP de 4 dígitos** enviado a su correo.
3. La sesión queda guardada por **180 días** (tanto en navegadores nativos como en in-app browsers tipo WhatsApp).
4. El empleado paga **directamente el monto neto con descuento** mediante una orden explícita de Mercado Pago.
5. Al aprobarse el pago, el backend despacha los **pulsos completos** del producto a la máquina vía Arduino.

### Objetivos de Producto & Negocio
* **Transparencia total para el empleado:** Paga el precio bonificado de antemano (sin esperar reintegros).
* **Fricción mínima:** Login de 1 sola vez cada 6 meses.
* **Control por máquina:** Cada empresa elige en qué máquinas habilitar el beneficio y descarga el QR listo para imprimir.

---

## 2. Historias de Usuario (User Stories)

### US-1: Empleado - Registro / Login por primera vez
* **Como** empleado de una empresa cliente de VendPoint,  
* **Quiero** escanear el QR de la máquina e ingresar mi email laboral para recibir un código de acceso rápido,  
* **Para** autenticarme en segundos sin tener que recordar contraseñas largas.

### US-2: Empleado - Compra ágil y recordada
* **Como** empleado que ya se autenticó previamente,  
* **Quiero** escanear el QR y que la web me reconozca de inmediato con mi descuento aplicado,  
* **Para** pagar directamente con Mercado Pago y retirar mi café/snack sin volver a loguearme.

### US-3: Empleado - Compra en máquina de monto libre
* **Como** empleado frente a una máquina multicanal o libre,  
* **Quiero** ingresar el precio de lista que veo en la máquina para que el sistema calcule mi descuento exacto,  
* **Para** generar una orden por el monto final bonificado y recibir el producto correspondiente.

### US-4: Administrador de Empresa - Habilitar beneficio y obtener cartelería
* **Como** administrador de una empresa en VendPoint,  
* **Quiero** activar el beneficio de empleados solo en las máquinas seleccionadas (ej. comedor interno) y descargar el QR para imprimir,  
* **Para** colocar el cartelito al lado del QR público de Mercado Pago.

### US-5: Administrador / Finanzas - Auditoría de Consumo
* **Como** administrador de la empresa,  
* **Quiero** consultar en el dashboard el detalle de compras realizadas con descuento (empleado, monto, ahorro acumulado),  
* **Para** monitorear el uso del beneficio sin imponer trabas iniciales a los empleados.

---

## 3. Requisitos Funcionales

* [ ] **RF-1 (Validación contra Nómina):** Solo pueden acceder al beneficio aquellos emails que estén registrados con estado `active` en `client_employees` para la empresa dueña de la máquina.
* [ ] **RF-2 (Autenticación OTP de 4 dígitos):** 
  * Al ingresar el email, el servidor genera un código numérico aleatorio de 4 dígitos con validez de 10 minutos.
  * Se envía mediante el servicio de correo existente (`mailer.js` vía Resend).
  * Rate-limit: máximo 3 envíos por email cada 15 minutos para evitar abuso de correo.
* [ ] **RF-3 (Persistencia de Sesión Ultra-Larga):**
  * Al validar el código OTP, se expide una cookie HTTP-Only segura (`SameSite=Lax`, `maxAge = 180 días`) y un token local para hidratación de interfaz.
  * Válida tanto en navegadores nativos (Safari, Chrome) como en navegadores embebidos (WhatsApp, Telegram, etc.).
* [ ] **RF-4 (Creación Determinista de Orden):**
  * **Máquina con precio fijo (`fixed`):** La web toma `qr_fixed_amount`, aplica el porcentaje de descuento del empleado (o el default de la empresa), y genera la orden de MP por el monto bonificado.
  * **Máquina con monto libre (`dynamic`):** El empleado ingresa el monto de lista; la web valida `monto >= min_payment`, calcula el descuento y genera la orden de MP por el monto neto bonificado.
* [ ] **RF-5 (Despacho de Pulsos Completos):**
  * Al recibir la notificación de pago aprobado de MP para una orden de empleado, el servidor calcula los pulsos sobre el **monto de lista original** (`pulses = floor(monto_lista / pulse_value)`).
  * Encola los pulsos completos en `pulse_queue` para el Arduino de la máquina.
* [ ] **RF-6 (Control de Máquinas Habilitadas):**
  * Nueva bandera en la máquina: `employee_discount_enabled` (booleano).
  * Si la máquina no tiene la bandera activa, el QR de empleados informa que el beneficio no aplica en esa ubicación.
* [ ] **RF-7 (Generación de QR y Cartelería en Admin):**
  * En la solapa de la máquina y en la solapa Descuentos, se visualiza el QR exclusivo de empleados apuntando a `https://www.vendpoint.com.ar/e/:machineId`.
  * Opción de descarga individual y diseño listo para imprimir junto al QR de MP.
* [ ] **RF-8 (Bloqueo Preventivo si la Máquina está Offline):**
  * Antes de permitir el pago, la web consulta el estado en tiempo real de la máquina. Si está `inactive`, en mantenimiento o sin latido reciente, avisa al usuario e impide el cobro para evitar retener dinero.
* [ ] **RF-9 (Reconciliación Activa y Confirmación de Crédito):**
  * Al volver de Mercado Pago o al ingresar a la máquina habiendo pagado en los últimos 5 minutos, la web consulta proactivamente a MP para acreditar el pago en tiempo real sin depender de latencias o fallos de webhooks.
  * Muestra la confirmación visual de crédito entregado, instrucciones hacia la máquina (*"Elegí tu producto en la botonera o retiralo de la bandeja"*), y el botón `+ Hacer otro pago` para compras adicionales.

---

## 4. Requisitos No Funcionales (NFRs)

* **Seguridad:** Los códigos OTP se almacenan con hash criptográfico y expiración en base de datos. Si un empleado es dado de baja en `client_employees`, su sesión se invalida en tiempo real al verificar el token.
* **Compatibilidad Móvil:** Interfaz web ultraliviana (React mobile-first o vanilla dialog) sin dependencias pesadas, carga en < 1.5s en 4G.
* **Tolerancia a Sandboxes de Navegadores:** Cartel de ayuda si se detecta un In-App Browser (ej. WhatsApp): *"Para guardar tu sesión permanentemente, abrí este enlace en Safari o Chrome"*.

---

## 5. Casos de Borde y Manejo de Errores

| Caso de Borde | Comportamiento Esperado |
|---|---|
| Email no está en la nómina de la empresa | Mensaje amigable: *"Tu email no figura en la nómina de [Empresa]. Podés pagar escaneando el QR principal de Mercado Pago."* |
| Empleado desvinculado (inactivo) | Al intentar pagar o entrar, el backend detecta `status != 'active'`, borra la sesión y le avisa que el beneficio ya no está disponible. |
| Máquina offline / sin heartbeat | La web muestra un banner de advertencia y deshabilita el botón de pago. |
| Empleado ingresa un monto menor al mínimo | La web valida contra `machine.min_payment` antes de llamar a MP. |
| Pago rechazado en Mercado Pago | La web de VendPoint recibe el error y permite reintentar sin perder la sesión. |

---

## 6. Criterios de Aceptación (Definition of Done)

- [ ] Un empleado no autenticado escanea el QR de la máquina, ingresa su correo, recibe el código OTP de 4 dígitos y se loguea.
- [ ] Al cerrar el navegador y volver a escanear el QR, ingresa directo a la pantalla de pago sin pedir código nuevamente.
- [ ] El pago en MP se cobra por el monto bonificado (ej. $800 sobre un café de $1.000).
- [ ] El Arduino recibe los pulsos equivalentes al producto completo ($1.000) y dispensa con normalidad.
- [ ] En el panel de gestión, el administrador puede activar/desactivar máquinas y descargar el QR de empleados.
- [ ] La transacción queda asentada con auditoría completa en el historial de descuentos.
