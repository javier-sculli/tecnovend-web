// Envío de mails vía Resend (HTTP API, sin SMTP).
//
// Config por env:
//   RESEND_API_KEY  → clave de la cuenta de Resend. Si falta, NO se envía nada
//                     (se loguea y se sigue): así el server arranca igual en dev.
//   MAIL_FROM       → remitente, ej: "VendPoint <avisos@tudominio.com>".
//                     Debe ser de un dominio verificado en Resend.
//
// sendMail nunca lanza: cualquier error se loguea y se devuelve { ok: false }.
// Los llamadores (barridos de fondo) no deben caerse porque falle un mail.
export async function sendMail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);

  if (recipients.length === 0) return { ok: false, skipped: 'sin destinatarios' };
  if (!apiKey || !from) {
    console.warn(`[mailer] RESEND_API_KEY/MAIL_FROM sin configurar — mail NO enviado a ${recipients.join(', ')} ("${subject}")`);
    return { ok: false, skipped: 'sin config' };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: recipients, subject, html, text }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[mailer] Resend respondió ${resp.status}: ${body}`);
      return { ok: false, status: resp.status };
    }
    const data = await resp.json().catch(() => ({}));
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[mailer] Error enviando mail:', e.message);
    return { ok: false, error: e.message };
  }
}
