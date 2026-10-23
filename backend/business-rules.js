const { createSessionToken, hashSessionToken, hashPassword } = require("./security");

const emailLocalPart = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ".")
  .replace(/^\.+|\.+$/g, "");

const isValidDomain = (value) => typeof value === "string"
  && value.length <= 253
  && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);

const createInstitutionalEmail = async (pool, institutionId, nombre, apellido) => {
  const institution = await pool.query(
    "SELECT dominio FROM instituciones WHERE id = $1",
    [institutionId]
  );
  const domain = institution.rows[0]?.dominio;
  if (!isValidDomain(domain)) {
    throw Object.assign(new Error("La institución debe configurar un dominio válido antes de crear usuarios."), { status: 400 });
  }

  const base = [emailLocalPart(nombre), emailLocalPart(apellido)].filter(Boolean).join(".");
  if (!base) throw Object.assign(new Error("El nombre no permite generar un correo institucional válido."), { status: 400 });
  let candidate = `${base}@${domain.toLowerCase()}`;
  let suffix = 1;
  while (true) {
    const existing = await pool.query(
      "SELECT 1 FROM usuarios WHERE lower(email) = lower($1) LIMIT 1",
      [candidate]
    );
    if (!existing.rowCount) return candidate;
    candidate = `${base}${suffix++}@${domain.toLowerCase()}`;
  }
};

const issueActivation = async (pool, userId) => {
  const token = createSessionToken();
  await pool.query("DELETE FROM activaciones_cuenta WHERE usuario_id = $1 AND usado_en IS NULL", [userId]);
  await pool.query(
    `INSERT INTO activaciones_cuenta (token_hash, usuario_id, vence_en)
     VALUES ($1, $2, now() + interval '24 hours')`,
    [hashSessionToken(token), userId]
  );
  return token;
};

const activateAccount = async (pool, token, password) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activation = await client.query(
      `SELECT a.usuario_id
       FROM activaciones_cuenta a
       JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.token_hash = $1 AND a.usado_en IS NULL AND a.vence_en > now()
         AND u.password_hash IS NULL
       FOR UPDATE OF a, u`,
      [hashSessionToken(token)]
    );
    const userId = activation.rows[0]?.usuario_id;
    if (!userId) {
      await client.query("ROLLBACK");
      return null;
    }
    const passwordHash = await hashPassword(password);
    await client.query(
      "UPDATE usuarios SET password_hash = $2, primer_ingreso = FALSE WHERE id = $1",
      [userId, passwordHash]
    );
    await client.query(
      "UPDATE activaciones_cuenta SET usado_en = now() WHERE token_hash = $1",
      [hashSessionToken(token)]
    );
    await client.query(
      "DELETE FROM activaciones_cuenta WHERE usuario_id = $1 AND token_hash <> $2",
      [userId, hashSessionToken(token)]
    );
    await client.query("COMMIT");
    return userId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const calculateRequiredGrade = ({ passingGrade, maximumGrade, completed, remainingWeight }) => {
  if (!Number.isFinite(passingGrade) || !Number.isFinite(maximumGrade)
    || !Number.isFinite(remainingWeight) || remainingWeight <= 0
    || remainingWeight > 100 || passingGrade < 0 || maximumGrade <= 0) {
    throw new RangeError("Los parámetros para calcular la nota requerida no son válidos.");
  }
  const earnedPoints = completed.reduce((total, item) => {
    if (!Number.isFinite(item.grade) || !Number.isFinite(item.weight)
      || item.grade < 0 || item.weight <= 0 || item.weight > 100) {
      throw new RangeError("Las notas y ponderaciones registradas no son válidas.");
    }
    return total + item.grade * item.weight / 100;
  }, 0);
  const required = (passingGrade - earnedPoints) * 100 / remainingWeight;
  return {
    required: Number(required.toFixed(2)),
    mathematicallyLost: required > maximumGrade,
    earnedPoints: Number(earnedPoints.toFixed(2))
  };
};

const logAudit = async (pool, { institutionId, userId, action, entity, entityId, changes = {} }) => {
  await pool.query(
    `INSERT INTO audit_log (institucion_id, usuario_id, accion, entidad, entidad_id, cambios)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [institutionId || null, userId || null, action, entity, entityId || null, JSON.stringify(changes)]
  );
};

const enqueueEmail = async (pool, { recipient, subject, body }) => {
  await pool.query(
    "INSERT INTO email_outbox (destinatario, asunto, cuerpo) VALUES ($1, $2, $3)",
    [recipient, subject, body]
  );
};

module.exports = {
  activateAccount,
  calculateRequiredGrade,
  createInstitutionalEmail,
  enqueueEmail,
  isValidDomain,
  issueActivation,
  logAudit
};
