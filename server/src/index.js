import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './routes/auth.js';
import machinesRouter from './routes/machines.js';
import clientsRouter from './routes/clients.js';
import { requireAuth } from './middleware/auth.js';
import webhooksRouter from './routes/webhooks.js';
import arduinoRouter from './routes/arduino.js';
import mpRouter from './routes/mp.js';
import debugRouter from './routes/debug.js';
import docsRouter from './routes/docs.js';

// Inicializar BD (crea tablas y ejecuta migraciones)
import { initDb } from './db/schema.js';
import { expireStalePulses, findPaymentsMissingPulses } from './services/pulses.js';
import { flagPaymentsForRefund, processPendingRefunds } from './services/refunds.js';
import { reconcileAll } from './services/reconcile.js';
import { sweepOfflineAlerts } from './services/offline-alerts.js';

await initDb();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Railway termina TLS en el proxy
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/auth', authRouter);
// NOTA: la validación de sesión en estos endpoints está desactivada por ahora
// (el login de la web funciona, pero la API no exige token). Reactivar cuando
// la web nueva esté estable: app.use('/api/machines', requireAuth, ...)
app.use('/api/machines', machinesRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/mp', mpRouter);
app.use('/arduino', arduinoRouter);
app.use('/api/debug', debugRouter);
app.use('/api/docs', docsRouter);

// Web de gestión: el mismo Express sirve el build de React (client/dist copiado
// a server/public con `npm run build:web` desde la raíz). Va DESPUÉS de las
// rutas API; el fallback devuelve index.html para las rutas del SPA.
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/arduino') || req.path.startsWith('/health')) return next();
  res.sendFile(path.join(publicDir, 'index.html'), (err) => { if (err) next(); });
});

app.listen(PORT, () => {
  console.log(`VendPoint API corriendo en http://localhost:${PORT}`);
  if (!process.env.MP_ACCESS_TOKEN) {
    console.warn('⚠  MP_ACCESS_TOKEN no configurado — copiá .env.example a .env y completalo');
  }
});

// Barrido periódico: expira los pulsos sin ACK pasados los 3 min, marca sus
// pagos para reembolso y procesa los reembolsos pendientes (incluye reintentos
// de los que fallaron). Corre aunque ningún Arduino esté polleando.
let _sweeping = false;
setInterval(async () => {
  if (_sweeping) return; // evitar solapamiento si un reembolso tarda
  _sweeping = true;
  try {
    const expired = await expireStalePulses();
    if (expired.length > 0) {
      console.log(`[pulses] ${expired.length} pulso(s) expirado(s) sin ACK`);
      await flagPaymentsForRefund(expired.map(p => p.payment_id));
    }
    // Pagos con pulsos calculados pero sin fila en la cola (limbo): marcar a reembolso.
    const missing = await findPaymentsMissingPulses();
    if (missing.length > 0) {
      console.warn(`[pulses] ${missing.length} pago(s) con pulsos calculados pero sin cola → reembolso`);
      await flagPaymentsForRefund(missing);
    }
    await processPendingRefunds();
  } catch (e) {
    console.error('[sweep]', e.message);
  } finally {
    _sweeping = false;
  }
}, 60_000);

// Reconciliación de fondo: rescata pagos que entraron a la cuenta de MP pero no
// generaron webhook (ej: monto tipeado en QR estático). Corre cada 2 min sobre
// todas las cuentas conectadas. Es la red de seguridad; el poll del Arduino
// además fuerza un refresco on-demand de su máquina (ver services/reconcile.js).
let _reconciling = false;
setInterval(async () => {
  if (_reconciling) return;
  _reconciling = true;
  try {
    await reconcileAll();
  } catch (e) {
    console.error('[reconcile]', e.message);
  } finally {
    _reconciling = false;
  }
}, 120_000);

// Avisos de máquina offline: detecta la transición a "perdida" (sin heartbeat
// hace más de 1h) y manda un mail a la cuenta, una sola vez por corte. Ver
// services/offline-alerts.js.
let _alertingOffline = false;
setInterval(async () => {
  if (_alertingOffline) return;
  _alertingOffline = true;
  try {
    await sweepOfflineAlerts();
  } catch (e) {
    console.error('[offline-alert]', e.message);
  } finally {
    _alertingOffline = false;
  }
}, 60_000);
