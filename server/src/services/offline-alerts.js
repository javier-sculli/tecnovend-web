import db from '../db/schema.js';
import { sendMail } from './mailer.js';
import { OFFLINE_AFTER_MIN } from './machine-state.js';

// Aviso por mail cuando una máquina queda "perdida" (offline): sin heartbeat
// hace más de OFFLINE_AFTER_MIN minutos — el mismo umbral que la web pinta en
// rojo. NO se dispara con la baja por heartbeat (in_service:false → out_of_service,
// la máquina sigue conectada): eso es un estado operativo, no una desconexión.
//
// Se avisa una sola vez por corte: al mandar el mail se marca offline_notified_at,
// y ese flag se limpia recién cuando la máquina vuelve a latir. Así un nuevo corte
// (reconecta y se vuelve a caer) vuelve a avisar.
//
// Como el estado offline se calcula al leer (no hay un evento en el momento exacto
// en que expira), esta detección vive en un barrido periódico (ver index.js).

// Destinatarios de la cuenta dueña de la máquina: usuarios miembros + el
// contact_email del cliente, sin duplicados.
async function recipientsForClient(clientId, contactEmail) {
  const rows = await db.prepare(`
    SELECT u.email
    FROM memberships mem
    JOIN users u ON u.id = mem.user_id
    WHERE mem.client_id = ?
  `).all(clientId);

  const set = new Set();
  for (const r of rows) if (r.email) set.add(r.email.trim().toLowerCase());
  if (contactEmail) set.add(contactEmail.trim().toLowerCase());
  return [...set];
}

// Copy simple, sin jerga técnica (nada de "heartbeat" ni de cuánto tiempo
// pasó): solo qué máquina y cuándo fue su última conexión.
function buildAlert(machine) {
  const subject = `Máquina desconectada: ${machine.name}`;
  const ubic = machine.location ? ` (${machine.location})` : '';
  const desde = machine.last_seen_at ? `${machine.last_seen_at} UTC` : 'nunca';
  const text = [
    `La máquina "${machine.name}"${ubic} se desconectó.`,
    ``,
    `Última conexión: ${desde}.`,
    ``,
    `Te vamos a avisar de nuevo solo si vuelve a conectarse y se desconecta otra vez.`,
    ``,
    `— VendPoint`,
  ].join('\n');
  const html = `
    <p>La máquina <strong>${machine.name}</strong>${ubic} se desconectó.</p>
    <p>Última conexión: ${desde}.</p>
    <p>Te vamos a avisar de nuevo solo si vuelve a conectarse y se desconecta otra vez.</p>
    <p>— VendPoint</p>
  `.trim();
  return { subject, text, html };
}

export async function sweepOfflineAlerts() {
  // 1) Reconexión: limpiar el flag de las que volvieron a latir, para que un
  //    futuro corte vuelva a avisar.
  await db.prepare(`
    UPDATE machines SET offline_notified_at = NULL
    WHERE offline_notified_at IS NOT NULL
      AND last_seen_at IS NOT NULL
      AND last_seen_at >= datetime('now', '-${OFFLINE_AFTER_MIN} minutes')
  `).run();

  // 2) Recién offline: máquinas que latieron alguna vez, hace más del umbral, y
  //    todavía no avisamos. Exigir last_seen_at NOT NULL evita spamear por
  //    máquinas recién dadas de alta que nunca se instalaron (nunca conectaron).
  const machines = await db.prepare(`
    SELECT m.id, m.name, m.location, m.last_seen_at, m.client_id, c.contact_email
    FROM machines m
    JOIN clients c ON c.id = m.client_id
    WHERE m.offline_notified_at IS NULL
      AND m.last_seen_at IS NOT NULL
      AND m.last_seen_at < datetime('now', '-${OFFLINE_AFTER_MIN} minutes')
  `).all();

  for (const machine of machines) {
    const to = await recipientsForClient(machine.client_id, machine.contact_email);
    if (to.length === 0) {
      console.warn(`[offline-alert] ${machine.id} offline pero la cuenta no tiene mails cargados — no se avisa`);
    } else {
      const { subject, text, html } = buildAlert(machine);
      const r = await sendMail({ to, subject, text, html });
      if (r.ok) console.log(`[offline-alert] ${machine.id} offline → aviso enviado a ${to.join(', ')}`);
      else console.warn(`[offline-alert] ${machine.id} offline → no se pudo enviar (${r.skipped || r.error || r.status})`);
    }
    // Marcamos el corte como avisado pase lo que pase con el envío: así avisamos
    // una sola vez y no reintentamos cada minuto. El flag se limpia al reconectar.
    await db.prepare(`UPDATE machines SET offline_notified_at = datetime('now') WHERE id = ?`).run(machine.id);
  }
}
