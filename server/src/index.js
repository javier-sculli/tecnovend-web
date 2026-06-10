import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import machinesRouter from './routes/machines.js';
import clientsRouter from './routes/clients.js';
import webhooksRouter from './routes/webhooks.js';
import arduinoRouter from './routes/arduino.js';
import mpRouter from './routes/mp.js';
import debugRouter from './routes/debug.js';
import docsRouter from './routes/docs.js';

// Inicializar BD (crea tablas y ejecuta migraciones)
import './db/schema.js';
import { expireStalePulses } from './services/pulses.js';
import { flagPaymentsForRefund, processPendingRefunds } from './services/refunds.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Railway termina TLS en el proxy
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/machines', machinesRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/mp', mpRouter);
app.use('/arduino', arduinoRouter);
app.use('/api/debug', debugRouter);
app.use('/api/docs', docsRouter);

app.listen(PORT, () => {
  console.log(`Tecnovend API corriendo en http://localhost:${PORT}`);
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
    const expired = expireStalePulses();
    if (expired.length > 0) {
      console.log(`[pulses] ${expired.length} pulso(s) expirado(s) sin ACK`);
      flagPaymentsForRefund(expired.map(p => p.payment_id));
    }
    await processPendingRefunds();
  } catch (e) {
    console.error('[sweep]', e.message);
  } finally {
    _sweeping = false;
  }
}, 60_000);
