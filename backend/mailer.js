const nodemailer = require("nodemailer");

const smtpOptions = () => {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT debe ser un puerto válido.");
  }
  return {
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    from: SMTP_FROM
  };
};

const sendPendingEmail = async (pool) => {
  const options = smtpOptions();
  if (!options) return false;
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: options.auth
  });
  const client = await pool.connect();
  let email;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, destinatario, asunto, cuerpo, intentos
       FROM email_outbox
       WHERE enviado_en IS NULL AND disponible_en <= now()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    email = result.rows[0];
    if (!email) {
      await client.query("COMMIT");
      return true;
    }
    await transport.sendMail({
      from: options.from,
      to: email.destinatario,
      subject: email.asunto,
      text: email.cuerpo
    });
    await client.query(
      "UPDATE email_outbox SET enviado_en = now(), intentos = intentos + 1, ultimo_error = NULL, cuerpo = '' WHERE id = $1",
      [email.id]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    if (email) {
      await pool.query(
        `UPDATE email_outbox
         SET intentos = intentos + 1, ultimo_error = $2,
            disponible_en = now() + make_interval(mins => least(60, power(2, intentos)::integer))
         WHERE id = $1`,
        [email.id, String(error.message || "SMTP error").slice(0, 1000)]
      );
    }
    throw error;
  } finally {
    client.release();
    transport.close();
  }
};

module.exports = { sendPendingEmail, smtpOptions };
