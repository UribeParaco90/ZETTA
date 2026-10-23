const path = require("node:path");
const express = require("express");
const { closePool, getPool } = require("./db");
const { entities, getEntity, publicEntities } = require("./entities");
const {
  SESSION_TTL_SECONDS,
  createSessionToken,
  hashSessionToken,
  hashPassword,
  verifyPassword
} = require("./security");
const {
  activateAccount,
  calculateRequiredGrade,
  createInstitutionalEmail,
  enqueueEmail,
  isValidDomain,
  issueActivation,
  logAudit
} = require("./business-rules");
const { sendPendingEmail, smtpOptions } = require("./mailer");

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.NODE_ENV === "production"
  ? "0.0.0.0"
  : process.env.HOST || "127.0.0.1";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://${host}:${port}`;
const root = path.join(__dirname, "..");
const landingPage = path.join(root, "landing_page");
const sessionCookie = "zetta_session";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validRoles = ["SuperAdmin", "Admin", "Profesor", "Estudiante", "Acudiente"];
const loginAttempts = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "400kb", type: "application/json" }));
app.use((request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.origin) {
    try {
      if (new URL(request.headers.origin).host !== request.get("host")) {
        return sendError(response, 403, "El origen de la solicitud no está permitido.");
      }
    } catch {
      return sendError(response, 403, "El origen de la solicitud no está permitido.");
    }
  }
  next();
});

const sendError = (response, status, message) => response.status(status).json({ error: message });

const parseCookies = (header = "") => Object.fromEntries(
  header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [null, null];
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      return [key, decodeURIComponent(rawValue)];
    } catch {
      return [key, ""];
    }
  }).filter(([key, value]) => key && value !== null)
);

const cookieOptions = (maxAge) => [
  `${sessionCookie}=`,
  "Path=/",
  "HttpOnly",
  "SameSite=Strict",
  `Max-Age=${maxAge}`,
  ...(process.env.NODE_ENV === "production" ? ["Secure"] : [])
].join("; ");

const setSessionCookie = (response, token) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );
};

const clearSessionCookie = (response) => {
  response.setHeader("Set-Cookie", cookieOptions(0));
};

const getSessionUser = async (request) => {
  const token = parseCookies(request.headers.cookie)[sessionCookie];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await getPool().query(
    `SELECT u.id, u.institucion_id, u.nombre, u.apellido, u.email, u.rol
     FROM zetta_sessions s
     JOIN usuarios u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     LIMIT 1`,
    [hashSessionToken(token)]
  );
  const user = result.rows[0];
  if (!user) return null;
  return {
    id: user.id,
    institutionId: user.institucion_id,
    name: `${user.nombre} ${user.apellido}`.trim(),
    email: user.email,
    role: user.rol
  };
};

const issueSession = async (response, user) => {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await getPool().query("DELETE FROM zetta_sessions WHERE expires_at <= now()");
  await getPool().query(
    "INSERT INTO zetta_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashSessionToken(token), user.id, expiresAt]
  );
  setSessionCookie(response, token);
};

const requireAuth = async (request, response, next) => {
  try {
    request.user = await getSessionUser(request);
    if (!request.user) {
      clearSessionCookie(response);
      return sendError(response, 401, "Inicia sesión para continuar.");
    }
    next();
  } catch (error) {
    next(error);
  }
};

const requirePageRoles = (roles) => async (request, response, next) => {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      response.redirect(302, "/login.html");
      return;
    }
    if (!roles.includes(user.role)) {
      response.redirect(302, "/dashboard.html");
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

const publicUser = (user) => ({
  id: user.id,
  institutionId: user.institutionId,
  name: user.name,
  email: user.email,
  role: user.role
});

const institutionQueryForRole = (user, userAlias = "u") => {
  if (user.role === "Admin") return { sql: `${userAlias}.institucion_id = $1`, values: [user.institutionId] };
  if (user.role === "Profesor") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM matriculas m
        JOIN asignaturas a ON a.curso_id = m.curso_id
        WHERE m.estudiante_id = ${userAlias}.id AND a.profesor_id = $1
      )`,
      values: [user.id]
    };
  }
  if (user.role === "Estudiante") return { sql: `${userAlias}.id = $1`, values: [user.id] };
  if (user.role === "Acudiente") {
    return {
      sql: `(EXISTS (
        SELECT 1 FROM acudientes_estudiantes ae
        WHERE ae.estudiante_id = ${userAlias}.id AND ae.acudiente_id = $1
      ) OR EXISTS (
        SELECT 1 FROM matriculas m
        WHERE m.estudiante_id = ${userAlias}.id AND m.acudiente_id = $1
      ))`,
      values: [user.id]
    };
  }
  return { sql: "FALSE", values: [] };
};

app.get("/api/academico/estudiantes", requireAuth, async (request, response, next) => {
  const scope = institutionQueryForRole(request.user);
  try {
    const result = await getPool().query(
      `SELECT u.id, u.nombre, u.apellido, u.documento, c.nombre AS curso
       FROM usuarios u
       LEFT JOIN matriculas m ON m.estudiante_id = u.id
       LEFT JOIN cursos c ON c.id = m.curso_id
       WHERE u.rol = 'Estudiante' AND ${scope.sql}
       ORDER BY u.apellido, u.nombre LIMIT 500`,
      scope.values
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/academico/calificaciones/:studentId", requireAuth, async (request, response, next) => {
  const studentId = request.params.studentId;
  const period = Number(request.query.periodo);
  if (!uuidPattern.test(studentId) || !Number.isInteger(period) || period < 1 || period > 12) {
    return sendError(response, 400, "Selecciona un estudiante y periodo válidos.");
  }
  if (!["Admin", "Estudiante", "Acudiente"].includes(request.user.role)) {
    return sendError(response, 403, "Este perfil no puede consultar certificados.");
  }
  try {
    const scope = institutionQueryForRole(request.user, "u");
    const result = await getPool().query(
      `SELECT i.nombre AS institucion, u.id AS estudiante_id, m.id AS matricula_id,
              a.id AS asignatura_id, u.nombre, u.apellido,
              u.documento, c.nombre AS curso, c.periodo_lectivo,
              COALESCE(cfg.escala_min, 0) AS escala_min,
              COALESCE(cfg.escala_max, 5) AS escala_max,
              a.nombre AS asignatura,
              round(COALESCE(actividad.nota, legado.nota)::numeric, 2) AS nota
       FROM usuarios u
       JOIN matriculas m ON m.estudiante_id = u.id
       JOIN cursos c ON c.id = m.curso_id
       JOIN instituciones i ON i.id = c.institucion_id
       LEFT JOIN configuracion_institucional cfg ON cfg.institucion_id = c.institucion_id
       JOIN asignaturas a ON a.curso_id = m.curso_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(cfg.escala_min, 0)
           + (sum(n.nota * ac.peso_porcentaje) / NULLIF(sum(ac.peso_porcentaje), 0) / 100)
             * (COALESCE(cfg.escala_max, 5) - COALESCE(cfg.escala_min, 0)) AS nota
         FROM actividades ac
         JOIN notas_actividades n ON n.actividad_id = ac.id AND n.matricula_id = m.id
         LEFT JOIN configuracion_institucional cfg ON cfg.institucion_id = c.institucion_id
         WHERE ac.asignatura_id = a.id AND ac.periodo = $${scope.values.length + 1}
         GROUP BY cfg.escala_min, cfg.escala_max
         HAVING COUNT(n.id) = (
           SELECT count(*) FROM actividades ax
           WHERE ax.asignatura_id = a.id AND ax.periodo = $${scope.values.length + 1}
         ) AND abs(COALESCE(sum(ac.peso_porcentaje), 0) - 100) < 0.001
       ) actividad ON TRUE
       LEFT JOIN LATERAL (
         SELECT sum(g.nota * g.porcentaje) / NULLIF(sum(g.porcentaje), 0) AS nota
         FROM calificaciones g
         WHERE g.matricula_id = m.id AND g.asignatura_id = a.id
           AND g.periodo = $${scope.values.length + 1}
         HAVING abs(COALESCE(sum(g.porcentaje), 0) - 100) < 0.001
       ) legado ON TRUE
       WHERE u.id = $${scope.values.length + 2} AND u.rol = 'Estudiante' AND ${scope.sql}
         AND COALESCE(actividad.nota, legado.nota) IS NOT NULL
       ORDER BY a.nombre`,
      [...scope.values, period, studentId]
    );
    if (result.rowCount === 0) {
      return sendError(response, 404, "No hay calificaciones para el estudiante y periodo seleccionados.");
    }
    response.json({ student: result.rows[0], grades: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/academico/lista", requireAuth, async (request, response, next) => {
  if (!["Admin", "Profesor"].includes(request.user.role)) {
    return sendError(response, 403, "Solo el administrador o el profesor asignado pueden tomar asistencia.");
  }
  const subjectId = request.query.asignaturaId;
  const date = request.query.fecha;
  if (!uuidPattern.test(subjectId || "") || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return sendError(response, 400, "Selecciona una asignatura y fecha válidas.");
  }
  try {
    const scope = request.user.role === "Admin"
      ? { sql: "c.institucion_id = $3", values: [request.user.institutionId] }
      : { sql: "a.profesor_id = $3", values: [request.user.id] };
    const result = await getPool().query(
      `SELECT m.id AS matricula_id, u.id AS estudiante_id, u.nombre, u.apellido,
              u.documento, x.estado
       FROM asignaturas a
       JOIN cursos c ON c.id = a.curso_id
       JOIN matriculas m ON m.curso_id = c.id
       JOIN usuarios u ON u.id = m.estudiante_id AND u.rol = 'Estudiante'
       LEFT JOIN asistencia x ON x.matricula_id = m.id AND x.asignatura_id = a.id AND x.fecha = $2
       WHERE a.id = $1 AND ${scope.sql}
       ORDER BY u.apellido, u.nombre`,
      [subjectId, date, ...scope.values]
    );
    response.json({ records: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/academico/asistencias", requireAuth, async (request, response, next) => {
  if (!["Admin", "Profesor"].includes(request.user.role)) {
    return sendError(response, 403, "Este perfil no puede consultar registros globales de asistencia.");
  }
  const { desde, hasta } = request.query;
  const validDate = (value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(desde) || !validDate(hasta)) {
    return sendError(response, 400, "El rango de fechas no es válido.");
  }
  const scope = request.user.role === "Admin"
    ? "c.institucion_id = $3"
    : "a.profesor_id = $3";
  try {
    const result = await getPool().query(
      `SELECT x.id, x.fecha, x.estado, x.asignatura_id, m.id AS matricula_id,
              u.nombre AS estudiante_nombre, u.apellido AS estudiante_apellido,
              u.documento, a.nombre AS asignatura,
              g.nombre AS acudiente_nombre, g.apellido AS acudiente_apellido
       FROM asistencia x
       JOIN matriculas m ON m.id = x.matricula_id
       JOIN usuarios u ON u.id = m.estudiante_id
       JOIN asignaturas a ON a.id = x.asignatura_id AND a.curso_id = m.curso_id
       JOIN cursos c ON c.id = a.curso_id
       LEFT JOIN usuarios g ON g.id = m.acudiente_id
       WHERE ${scope}
         AND ($1::date IS NULL OR x.fecha >= $1::date)
         AND ($2::date IS NULL OR x.fecha <= $2::date)
       ORDER BY x.fecha DESC, u.apellido, u.nombre LIMIT 1000`,
      [desde || null, hasta || null, request.user.role === "Admin" ? request.user.institutionId : request.user.id]
    );
    response.json({ records: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/academico/asistencia", requireAuth, async (request, response, next) => {
  const { asignaturaId, fecha, records } = request.body ?? {};
  if (!["Admin", "Profesor"].includes(request.user.role)) {
    return sendError(response, 403, "Solo el administrador o el profesor asignado pueden guardar asistencia.");
  }
  if (!uuidPattern.test(asignaturaId || "") || typeof fecha !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Array.isArray(records)
    || records.length < 1 || records.length > 200) {
    return sendError(response, 400, "Los datos de asistencia no son válidos.");
  }
  if (records.some((record) => !uuidPattern.test(record.matriculaId || "")
    || !["Presente", "Ausente", "Excusado", "Retardo"].includes(record.estado))) {
    return sendError(response, 400, "Cada matrícula debe tener un estado de asistencia válido.");
  }
  let client;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    for (const record of records) {
      const result = await client.query(
        `INSERT INTO asistencia (matricula_id, asignatura_id, fecha, estado)
         SELECT m.id, a.id, $3, $4
         FROM matriculas m
         JOIN asignaturas a ON a.id = $2 AND a.curso_id = m.curso_id
         JOIN cursos c ON c.id = a.curso_id
         WHERE m.id = $1 AND ${
           request.user.role === "Admin" ? "c.institucion_id = $5" : "a.profesor_id = $5"
         }
         ON CONFLICT (matricula_id, asignatura_id, fecha)
         DO UPDATE SET estado = EXCLUDED.estado
         RETURNING id`,
        [
          record.matriculaId,
          asignaturaId,
          fecha,
          record.estado,
          request.user.role === "Admin" ? request.user.institutionId : request.user.id
        ]
      );
      if (!result.rowCount) {
        throw Object.assign(new Error("Una matrícula no corresponde a esta asignatura o perfil."), {
          status: 403
        });
      }
      await logAudit(client, {
        institutionId: request.user.institutionId,
        userId: request.user.id,
        action: "upsert",
        entity: "asistencia",
        entityId: result.rows[0].id,
        changes: { fecha, estado: record.estado, matriculaId: record.matriculaId, asignaturaId }
      });
      if (record.estado === "Ausente") {
        const guardians = await client.query(
          `SELECT DISTINCT COALESCE(g.email_personal, g.email) AS email
           FROM matriculas m
           LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = m.estudiante_id
           JOIN usuarios g ON g.id = COALESCE(ae.acudiente_id, m.acudiente_id)
           WHERE m.id = $1`,
          [record.matriculaId]
        );
        for (const guardian of guardians.rows) {
          await enqueueEmail(client, {
            recipient: guardian.email,
            subject: "Alerta de inasistencia · ZETTA",
            body: `Se registró una inasistencia el ${fecha}. Ingresa a ZETTA para revisar los detalles y, si corresponde, presentar una excusa.`
          });
        }
      }
    }
    await client.query("COMMIT");
    response.json({ saved: records.length });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Attendance rollback failed.", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

const rateLimit = (key, now = Date.now()) => {
  if (loginAttempts.size > 5000) {
    for (const [entryKey, entry] of loginAttempts) {
      if (entry.expiresAt <= now) loginAttempts.delete(entryKey);
    }
  }
  const entry = loginAttempts.get(key);
  if (!entry || entry.expiresAt <= now) {
    loginAttempts.set(key, { count: 1, expiresAt: now + 15 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
};

const normalizedEmail = (value) => typeof value === "string"
  && value.length <= 150
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

app.get("/api/health", async (request, response, next) => {
  try {
    const result = await getPool().query("SELECT current_database() AS database");
    response.json({ status: "connected", database: result.rows[0].database });
  } catch (error) {
    next(error);
  }
});

app.get("/api/public/institutions", async (request, response, next) => {
  try {
    const result = await getPool().query(
      "SELECT id, nombre AS name FROM instituciones ORDER BY nombre LIMIT 500"
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/activate", async (request, response, next) => {
  const { token, password } = request.body ?? {};
  if (!rateLimit(`activate:${request.ip || "unknown"}`)) {
    return sendError(response, 429, "Demasiados intentos de activación. Espera unos minutos.");
  }
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || typeof password !== "string" || password.length < 8 || password.length > 200) {
    return sendError(response, 400, "El enlace o la contraseña no son válidos. Usa una contraseña de al menos 8 caracteres.");
  }
  try {
    const userId = await activateAccount(getPool(), token, password);
    if (!userId) return sendError(response, 400, "El enlace de activación venció o ya fue utilizado.");
    const result = await getPool().query(
      "SELECT id, institucion_id, nombre, apellido, email, rol FROM usuarios WHERE id = $1",
      [userId]
    );
    const row = result.rows[0];
    await logAudit(getPool(), {
      institutionId: row.institucion_id,
      userId: row.id,
      action: "activate",
      entity: "usuarios",
      entityId: row.id
    });
    const user = {
      id: row.id,
      institutionId: row.institucion_id,
      name: `${row.nombre} ${row.apellido}`.trim(),
      email: row.email,
      role: row.rol
    };
    await issueSession(response, user);
    response.status(200).json(publicUser(user));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", async (request, response, next) => {
  const { institutionId, documento, nombre, apellido, email, password } = request.body ?? {};
  const ip = request.ip || "unknown";
  if (!rateLimit(`register:${ip}`)) {
    return sendError(response, 429, "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.");
  }
  if (!uuidPattern.test(institutionId || "")
    || typeof documento !== "string" || documento.trim().length < 3 || documento.trim().length > 30
    || typeof nombre !== "string" || nombre.trim().length < 2 || nombre.trim().length > 80
    || typeof apellido !== "string" || apellido.trim().length < 2 || apellido.trim().length > 80
    || !normalizedEmail(email)
    || typeof password !== "string" || password.length < 8 || password.length > 200) {
    return sendError(response, 400, "Completa correctamente los datos requeridos. La contraseña debe tener al menos 8 caracteres.");
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await getPool().query(
      `INSERT INTO usuarios (institucion_id, documento, nombre, apellido, email, email_personal, password_hash, primer_ingreso, rol)
       SELECT id, $2, $3, $4, lower($5), lower($5), $6, FALSE, 'Acudiente'
       FROM instituciones WHERE id = $1
       RETURNING id, institucion_id, nombre, apellido, email, rol`,
      [
        institutionId,
        documento.trim(),
        nombre.trim(),
        apellido.trim(),
        email.trim(),
        passwordHash
      ]
    );
    if (!result.rows[0]) {
      return sendError(response, 400, "La institución seleccionada no existe.");
    }
    const user = {
      ...result.rows[0],
      institutionId: result.rows[0].institucion_id,
      name: `${result.rows[0].nombre} ${result.rows[0].apellido}`.trim(),
      role: result.rows[0].rol
    };
    await logAudit(getPool(), {
      institutionId: user.institutionId,
      userId: user.id,
      action: "register",
      entity: "usuarios",
      entityId: user.id,
      changes: { rol: user.role }
    });
    await issueSession(response, user);
    response.status(201).json(publicUser(user));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  const { email, password, role } = request.body ?? {};
  if (!normalizedEmail(email) || typeof password !== "string" || !validRoles.includes(role)) {
    return sendError(response, 400, "Ingresa correo, contraseña y un perfil válido.");
  }
  const key = `${request.ip || "unknown"}:${email.trim().toLowerCase()}`;
  if (!rateLimit(`login-ip:${request.ip || "unknown"}`) || !rateLimit(`login:${key}`)) {
    return sendError(response, 429, "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.");
  }

  try {
    const result = await getPool().query(
      `SELECT id, institucion_id, nombre, apellido, email, password_hash, rol
       FROM usuarios WHERE lower(email) = lower($1) LIMIT 1`,
      [email.trim()]
    );
    const user = result.rows[0];
    const valid = user && user.rol === role && await verifyPassword(password, user.password_hash);
    if (!valid) {
      return sendError(response, 401, "El perfil, correo o contraseña no coinciden con una cuenta registrada.");
    }
    const account = {
      id: user.id,
      institutionId: user.institucion_id,
      name: `${user.nombre} ${user.apellido}`.trim(),
      email: user.email,
      role: user.rol
    };
    await issueSession(response, account);
    response.json(publicUser(account));
  } catch (error) {
    next(error);
  }
});

app.use("/api", requireAuth);

app.get("/api/auth/me", (request, response) => response.json(publicUser(request.user)));

app.get("/api/academico/asignaturas-planilla", async (request, response, next) => {
  if (!["Admin", "Profesor"].includes(request.user.role)) {
    return sendError(response, 403, "Este perfil no puede consultar asignaturas para la planilla.");
  }
  try {
    const result = await getPool().query(
      `SELECT a.id, a.nombre, c.nombre AS curso, c.periodo_lectivo
       FROM asignaturas a
       JOIN cursos c ON c.id = a.curso_id
       WHERE ${request.user.role === "Admin" ? "c.institucion_id = $1" : "a.profesor_id = $1"}
       ORDER BY c.periodo_lectivo DESC, c.nombre, a.nombre`,
      [request.user.role === "Admin" ? request.user.institutionId : request.user.id]
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/academico/planilla", async (request, response, next) => {
  const { asignaturaId } = request.query;
  const period = Number(request.query.periodo);
  if (!["Admin", "Profesor"].includes(request.user.role)) {
    return sendError(response, 403, "Solo el administrador o el profesor pueden consultar la planilla.");
  }
  if (!uuidPattern.test(asignaturaId || "") || !Number.isInteger(period) || period < 1 || period > 12) {
    return sendError(response, 400, "Selecciona una asignatura y periodo válidos.");
  }
  try {
    const assignment = await getPool().query(
      `SELECT a.id, a.nombre, a.curso_id, c.nombre AS curso, c.institucion_id,
              c.periodo_lectivo, COALESCE(cfg.num_periodos, 4) AS num_periodos,
              p.id AS periodo_id, COALESCE(p.cerrado, FALSE) AS cerrado
       FROM asignaturas a
       JOIN cursos c ON c.id = a.curso_id
       LEFT JOIN configuracion_institucional cfg ON cfg.institucion_id = c.institucion_id
       LEFT JOIN periodos p ON p.institucion_id = c.institucion_id
         AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = $2
       WHERE a.id = $1 AND ${
         request.user.role === "Admin" ? "c.institucion_id = $3" : "a.profesor_id = $3"
       }`,
      [
        asignaturaId,
        period,
        request.user.role === "Admin" ? request.user.institutionId : request.user.id
      ]
    );
    const subject = assignment.rows[0];
    if (!subject) return sendError(response, 404, "No tienes acceso a esta asignatura.");
    if (period > Number(subject.num_periodos)) {
      return sendError(response, 400, "El periodo seleccionado no está configurado para esta institución.");
    }
    const [activities, students, grades] = await Promise.all([
      getPool().query(
        `SELECT id, nombre, peso_porcentaje
         FROM actividades WHERE asignatura_id = $1 AND periodo = $2
         ORDER BY creado_en, nombre`,
        [asignaturaId, period]
      ),
      getPool().query(
        `SELECT m.id AS matricula_id, u.id AS estudiante_id,
                u.nombre, u.apellido, u.documento
         FROM matriculas m
         JOIN usuarios u ON u.id = m.estudiante_id AND u.rol = 'Estudiante'
         WHERE m.curso_id = $1
         ORDER BY u.apellido, u.nombre`,
        [subject.curso_id]
      ),
      getPool().query(
        `SELECT n.matricula_id, n.actividad_id, n.nota
         FROM notas_actividades n
         JOIN actividades a ON a.id = n.actividad_id
         JOIN matriculas m ON m.id = n.matricula_id
         WHERE a.asignatura_id = $1 AND a.periodo = $2 AND m.curso_id = $3`,
        [asignaturaId, period, subject.curso_id]
      )
    ]);
    response.json({
      subject: { id: subject.id, name: subject.nombre, course: subject.curso },
      period,
      closed: subject.cerrado,
      periodConfigured: Boolean(subject.periodo_id),
      activities: activities.rows,
      students: students.rows,
      grades: grades.rows,
      activityWeightTotal: activities.rows.reduce((total, item) => total + Number(item.peso_porcentaje), 0)
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/academico/planilla", async (request, response, next) => {
  if (!["Admin", "Profesor"].includes(request.user.role)) {
    return sendError(response, 403, "Solo el administrador o el profesor pueden guardar calificaciones.");
  }
  const { asignaturaId, periodo, records } = request.body ?? {};
  const period = Number(periodo);
  if (!uuidPattern.test(asignaturaId || "") || !Number.isInteger(period) || period < 1 || period > 12
    || !Array.isArray(records) || records.length < 1 || records.length > 2500) {
    return sendError(response, 400, "Los datos de la planilla no son válidos.");
  }
  const pairs = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return sendError(response, 400, "Cada fila de calificación debe ser un objeto válido.");
    }
    if (typeof record.matriculaId !== "string" || !uuidPattern.test(record.matriculaId)
      || typeof record.actividadId !== "string" || !uuidPattern.test(record.actividadId)) {
      return sendError(response, 400, "Cada nota debe identificar una matrícula y actividad válidas.");
    }
    const grade = record.nota;
    const pair = `${record.matriculaId.toLowerCase()}:${record.actividadId.toLowerCase()}`;
    if (typeof grade !== "number" || !Number.isFinite(grade) || grade < 0 || grade > 100
      || Number(grade.toFixed(2)) !== grade
      || pairs.has(pair)) {
      return sendError(response, 400, "Cada nota debe ser única y estar entre 0 y 100 con máximo dos decimales.");
    }
    pairs.add(pair);
  }

  let client;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const assignment = await client.query(
      `SELECT a.id, a.curso_id, c.institucion_id, c.periodo_lectivo,
              COALESCE(cfg.num_periodos, 4) AS num_periodos
       FROM asignaturas a
       JOIN cursos c ON c.id = a.curso_id
       LEFT JOIN configuracion_institucional cfg ON cfg.institucion_id = c.institucion_id
       WHERE a.id = $1 AND ${
         request.user.role === "Admin" ? "c.institucion_id = $2" : "a.profesor_id = $2"
       }`,
      [asignaturaId, request.user.role === "Admin" ? request.user.institutionId : request.user.id]
    );
    const subject = assignment.rows[0];
    if (!subject) {
      await client.query("ROLLBACK");
      return sendError(response, 404, "No tienes acceso a esta asignatura.");
    }
    if (period > Number(subject.num_periodos)) {
      await client.query("ROLLBACK");
      return sendError(response, 400, "El periodo seleccionado no está configurado para esta institución.");
    }
    const periodState = await client.query(
      `SELECT id, cerrado FROM periodos
       WHERE institucion_id = $1 AND periodo_lectivo = $2 AND numero = $3
       FOR UPDATE`,
      [subject.institucion_id, subject.periodo_lectivo, period]
    );
    if (!periodState.rowCount) {
      await client.query("ROLLBACK");
      return sendError(response, 409, "Configura los pesos de los periodos antes de registrar calificaciones.");
    }
    if (periodState.rows[0].cerrado) {
      await client.query("ROLLBACK");
      return sendError(response, 409, "El periodo está cerrado y no acepta cambios.");
    }
    const activities = await client.query(
      `SELECT id, peso_porcentaje FROM actividades
       WHERE asignatura_id = $1 AND periodo = $2 FOR SHARE`,
      [asignaturaId, period]
    );
    const activityIds = new Set(activities.rows.map((item) => item.id));
    const weightTotal = activities.rows.reduce((total, item) => total + Number(item.peso_porcentaje), 0);
    if (Math.abs(weightTotal - 100) > 0.001) {
      await client.query("ROLLBACK");
      return sendError(response, 409, "Las actividades del periodo deben sumar exactamente 100 % antes de registrar notas.");
    }
    if (records.some((record) => !activityIds.has(record.actividadId))) {
      await client.query("ROLLBACK");
      return sendError(response, 400, "Una actividad no corresponde a la asignatura o periodo seleccionado.");
    }
    const enrollmentIds = [...new Set(records.map((record) => record.matriculaId))];
    const enrollments = await client.query(
      `SELECT m.id
       FROM matriculas m
       JOIN usuarios u ON u.id = m.estudiante_id AND u.rol = 'Estudiante'
       WHERE m.curso_id = $1 AND m.id = ANY($2::uuid[])`,
      [subject.curso_id, enrollmentIds]
    );
    if (enrollments.rowCount !== enrollmentIds.length) {
      await client.query("ROLLBACK");
      return sendError(response, 400, "Una matrícula no corresponde al curso de esta asignatura.");
    }
    await client.query(
      `INSERT INTO notas_actividades (actividad_id, matricula_id, nota)
       SELECT actividad_id, matricula_id, nota
       FROM unnest($1::uuid[], $2::uuid[], $3::numeric[])
         AS entries(actividad_id, matricula_id, nota)
       ON CONFLICT (actividad_id, matricula_id)
       DO UPDATE SET nota = EXCLUDED.nota, actualizado_en = now()`,
      [
        records.map((record) => record.actividadId),
        records.map((record) => record.matriculaId),
        records.map((record) => Number(record.nota))
      ]
    );
    await logAudit(client, {
      institutionId: subject.institucion_id,
      userId: request.user.id,
      action: "bulk_upsert",
      entity: "notas_actividades",
      changes: { asignaturaId, periodo: period, records }
    });
    await client.query("COMMIT");
    response.json({ saved: records.length });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Grade sheet rollback failed.", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

app.get("/api/perfil", async (request, response, next) => {
  try {
    const result = await getPool().query(
      `SELECT u.documento, u.email, u.email_personal, u.primer_ingreso,
              c.nombre AS curso
       FROM usuarios u
       LEFT JOIN matriculas m ON m.estudiante_id = u.id
       LEFT JOIN cursos c ON c.id = m.curso_id
       WHERE u.id = $1
       ORDER BY c.periodo_lectivo DESC NULLS LAST
       LIMIT 1`,
      [request.user.id]
    );
    response.json(result.rows[0] || {});
  } catch (error) {
    next(error);
  }
});

app.get("/api/configuracion-institucional", async (request, response, next) => {
  if (!["Admin", "Profesor", "Estudiante", "Acudiente"].includes(request.user.role)) {
    return sendError(response, 403, "Este perfil no puede consultar la configuración institucional.");
  }
  try {
    const [settings, year] = await Promise.all([
      getPool().query(
        "SELECT nota_minima_aprobacion, escala_min, escala_max, num_periodos FROM configuracion_institucional WHERE institucion_id = $1",
        [request.user.institutionId]
      ),
      getPool().query(
        "SELECT COALESCE(max(periodo_lectivo), EXTRACT(YEAR FROM current_date)::integer) AS periodo_lectivo FROM cursos WHERE institucion_id = $1",
        [request.user.institutionId]
      )
    ]);
    const periodResult = await getPool().query(
      `SELECT id, numero, peso_porcentaje, cerrado
       FROM periodos WHERE institucion_id = $1 AND periodo_lectivo = $2
       ORDER BY numero`,
      [request.user.institutionId, year.rows[0].periodo_lectivo]
    );
    response.json({
      settings: settings.rows[0] || {
        nota_minima_aprobacion: 3,
        escala_min: 0,
        escala_max: 5,
        num_periodos: 4
      },
      periodoLectivo: year.rows[0].periodo_lectivo,
      periodos: periodResult.rows
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/configuracion-institucional", async (request, response, next) => {
  if (request.user.role !== "Admin") {
    return sendError(response, 403, "Solo el administrador puede modificar la configuración institucional.");
  }
  const {
    notaMinimaAprobacion,
    escalaMin,
    escalaMax,
    numPeriodos,
    periodoLectivo,
    pesosPeriodos
  } = request.body ?? {};
  const numbers = [notaMinimaAprobacion, escalaMin, escalaMax, numPeriodos, periodoLectivo];
  if (numbers.some((value) => !Number.isFinite(Number(value)))
    || !Number.isInteger(Number(numPeriodos)) || numPeriodos < 1 || numPeriodos > 12
    || !Number.isInteger(Number(periodoLectivo)) || periodoLectivo < 2000 || periodoLectivo > 2200
    || escalaMin < 0 || escalaMax > 5 || escalaMin >= escalaMax
    || notaMinimaAprobacion < escalaMin || notaMinimaAprobacion > escalaMax
    || !Array.isArray(pesosPeriodos) || pesosPeriodos.length !== Number(numPeriodos)
    || pesosPeriodos.some((weight) => !Number.isFinite(Number(weight)) || weight <= 0 || weight > 100)
    || Math.abs(pesosPeriodos.reduce((sum, weight) => sum + Number(weight), 0) - 100) > 0.001) {
    return sendError(response, 400, "La configuración es inválida: los pesos de los periodos deben sumar exactamente 100 %.");
  }
  let client;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const closed = await client.query(
      "SELECT 1 FROM periodos WHERE institucion_id = $1 AND periodo_lectivo = $2 AND cerrado LIMIT 1",
      [request.user.institutionId, periodoLectivo]
    );
    if (closed.rowCount) {
      await client.query("ROLLBACK");
      return sendError(response, 409, "No puedes cambiar la configuración mientras haya periodos cerrados.");
    }
    await client.query(
      `INSERT INTO configuracion_institucional
         (institucion_id, nota_minima_aprobacion, escala_min, escala_max, num_periodos)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (institucion_id) DO UPDATE SET
         nota_minima_aprobacion = EXCLUDED.nota_minima_aprobacion,
         escala_min = EXCLUDED.escala_min,
         escala_max = EXCLUDED.escala_max,
         num_periodos = EXCLUDED.num_periodos`,
      [request.user.institutionId, notaMinimaAprobacion, escalaMin, escalaMax, numPeriodos]
    );
    for (const [index, weight] of pesosPeriodos.entries()) {
      await client.query(
        `INSERT INTO periodos (institucion_id, periodo_lectivo, numero, peso_porcentaje)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (institucion_id, periodo_lectivo, numero)
         DO UPDATE SET peso_porcentaje = EXCLUDED.peso_porcentaje`,
        [request.user.institutionId, periodoLectivo, index + 1, weight]
      );
    }
    await client.query(
      "DELETE FROM periodos WHERE institucion_id = $1 AND periodo_lectivo = $2 AND numero > $3",
      [request.user.institutionId, periodoLectivo, numPeriodos]
    );
    await logAudit(client, {
      institutionId: request.user.institutionId,
      userId: request.user.id,
      action: "update",
      entity: "configuracion_institucional",
      entityId: request.user.institutionId,
      changes: { notaMinimaAprobacion, escalaMin, escalaMax, numPeriodos, pesosPeriodos }
    });
    await client.query("COMMIT");
    response.json({ saved: true });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Institution settings rollback failed.", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

app.post("/api/periodos/:id/cierre", async (request, response, next) => {
  if (request.user.role !== "Admin" || !uuidPattern.test(request.params.id)) {
    return sendError(response, 403, "Solo el administrador puede cerrar o reabrir periodos.");
  }
  const { accion } = request.body ?? {};
  if (!["cerrar", "reabrir"].includes(accion)) {
    return sendError(response, 400, "Indica si deseas cerrar o reabrir el periodo.");
  }
  let client;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const period = await client.query(
      `SELECT id, institucion_id, periodo_lectivo, numero
       FROM periodos WHERE id = $1 AND institucion_id = $2 FOR UPDATE`,
      [request.params.id, request.user.institutionId]
    );
    if (!period.rows[0]) {
      await client.query("ROLLBACK");
      return sendError(response, 404, "No se encontró el periodo en tu institución.");
    }
    const row = period.rows[0];
    if (accion === "cerrar") {
      const periodWeights = await client.query(
        `SELECT COALESCE(sum(peso_porcentaje), 0) AS total
         FROM periodos
         WHERE institucion_id = $1 AND periodo_lectivo = $2`,
        [row.institucion_id, row.periodo_lectivo]
      );
      if (Math.abs(Number(periodWeights.rows[0].total) - 100) > 0.001) {
        await client.query("ROLLBACK");
        return sendError(response, 409, "No se puede cerrar: los pesos de los periodos deben sumar 100 %.");
      }
      const invalidActivity = await client.query(
        `SELECT a.id
         FROM asignaturas a
         JOIN cursos c ON c.id = a.curso_id
         LEFT JOIN actividades ac ON ac.asignatura_id = a.id AND ac.periodo = $3
         WHERE c.institucion_id = $1 AND c.periodo_lectivo = $2
         GROUP BY a.id
         HAVING abs(COALESCE(sum(ac.peso_porcentaje), 0) - 100) > 0.001
         LIMIT 1`,
        [row.institucion_id, row.periodo_lectivo, row.numero]
      );
      if (invalidActivity.rowCount) {
        await client.query("ROLLBACK");
        return sendError(response, 409, "No se puede cerrar: cada asignatura debe tener actividades que sumen 100 %.");
      }
    }
    const closed = accion === "cerrar";
    await client.query(
      `UPDATE periodos SET cerrado = $2, cerrado_en = CASE WHEN $2 THEN now() ELSE NULL END,
         cerrado_por = CASE WHEN $2 THEN $3 ELSE NULL END
       WHERE id = $1`,
      [row.id, closed, request.user.id]
    );
    await logAudit(client, {
      institutionId: row.institucion_id,
      userId: request.user.id,
      action: accion,
      entity: "periodos",
      entityId: row.id,
      changes: { periodo: row.numero, periodoLectivo: row.periodo_lectivo }
    });
    await client.query("COMMIT");
    response.json({ cerrado: closed });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Period closure rollback failed.", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

app.get("/api/academico/nota-requerida", async (request, response, next) => {
  if (!["Admin", "Estudiante", "Acudiente"].includes(request.user.role)) {
    return sendError(response, 403, "Este perfil no puede consultar el avance académico.");
  }
  const { matriculaId, asignaturaId } = request.query;
  if (!uuidPattern.test(matriculaId || "") || !uuidPattern.test(asignaturaId || "")) {
    return sendError(response, 400, "Selecciona una matrícula y asignatura válidas.");
  }
  try {
    const institution = await getPool().query(
      `SELECT c.institucion_id, c.periodo_lectivo
       FROM matriculas m JOIN cursos c ON c.id = m.curso_id
       JOIN asignaturas a ON a.curso_id = c.id AND a.id = $2
       LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = m.estudiante_id
       WHERE m.id = $1 AND (
         $3::text = 'Admin' AND c.institucion_id = $4
         OR $3::text = 'Estudiante' AND m.estudiante_id = $5
         OR $3::text = 'Acudiente' AND (m.acudiente_id = $5 OR ae.acudiente_id = $5)
       )`,
      [matriculaId, asignaturaId, request.user.role, request.user.institutionId, request.user.id]
    );
    const detail = institution.rows[0];
    if (!detail) return sendError(response, 404, "No tienes acceso a esta matrícula o asignatura.");
    const [configuration, periods] = await Promise.all([
      getPool().query(
        "SELECT nota_minima_aprobacion, escala_max FROM configuracion_institucional WHERE institucion_id = $1",
        [detail.institucion_id]
      ),
      getPool().query(
        `SELECT p.numero, p.peso_porcentaje, COALESCE(actividad.nota, legado.nota) AS nota
         FROM periodos p
         LEFT JOIN LATERAL (
           SELECT COALESCE(cfg.escala_min, 0)
             + (sum(n.nota * ac.peso_porcentaje) / NULLIF(sum(ac.peso_porcentaje), 0) / 100)
               * (COALESCE(cfg.escala_max, 5) - COALESCE(cfg.escala_min, 0)) AS nota
           FROM actividades ac
           JOIN notas_actividades n ON n.actividad_id = ac.id AND n.matricula_id = $1
           LEFT JOIN configuracion_institucional cfg ON cfg.institucion_id = p.institucion_id
           WHERE ac.asignatura_id = $2 AND ac.periodo = p.numero
           GROUP BY cfg.escala_min, cfg.escala_max
           HAVING COUNT(n.id) = (
             SELECT count(*) FROM actividades ax
             WHERE ax.asignatura_id = $2 AND ax.periodo = p.numero
           ) AND abs(COALESCE(sum(ac.peso_porcentaje), 0) - 100) < 0.001
         ) actividad ON TRUE
         LEFT JOIN LATERAL (
           SELECT sum(g.nota * g.porcentaje) / NULLIF(sum(g.porcentaje), 0) AS nota
           FROM calificaciones g
           WHERE g.matricula_id = $1 AND g.asignatura_id = $2 AND g.periodo = p.numero
           HAVING abs(COALESCE(sum(g.porcentaje), 0) - 100) < 0.001
         ) legado ON TRUE
         WHERE p.institucion_id = $3 AND p.periodo_lectivo = $4
         ORDER BY p.numero`,
        [matriculaId, asignaturaId, detail.institucion_id, detail.periodo_lectivo]
      )
    ]);
    const settings = configuration.rows[0] || { nota_minima_aprobacion: 3, escala_max: 5 };
    const completed = periods.rows
      .filter((period) => period.nota !== null)
      .map((period) => ({ grade: Number(period.nota), weight: Number(period.peso_porcentaje) }));
    const remainingWeight = periods.rows
      .filter((period) => period.nota === null)
      .reduce((sum, period) => sum + Number(period.peso_porcentaje), 0);
    if (!periods.rows.length || Math.abs(periods.rows.reduce((sum, period) => sum + Number(period.peso_porcentaje), 0) - 100) > 0.001) {
      return sendError(response, 409, "Configura los pesos de los periodos para calcular el promedio anual.");
    }
    if (remainingWeight === 0) {
      const finalGrade = completed.reduce((sum, period) => sum + period.grade * period.weight / 100, 0);
      return response.json({
        completed,
        remainingWeight: 0,
        finalGrade: Number(finalGrade.toFixed(2)),
        passed: finalGrade >= Number(settings.nota_minima_aprobacion)
      });
    }
    const result = calculateRequiredGrade({
      passingGrade: Number(settings.nota_minima_aprobacion),
      maximumGrade: Number(settings.escala_max),
      completed,
      remainingWeight
    });
    response.json({ completed, remainingWeight, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/usuarios", async (request, response, next) => {
  const user = request.user;
  if (!["Admin", "SuperAdmin"].includes(user.role)) {
    return sendError(response, 403, "Solo el administrador institucional puede registrar usuarios.");
  }
  const {
    institucion_id: requestedInstitutionId,
    documento,
    nombre,
    apellido,
    email_personal: personalEmail,
    rol
  } = request.body ?? {};
  const institutionId = user.role === "Admin" ? user.institutionId : requestedInstitutionId;
  const allowedRoles = user.role === "SuperAdmin" ? ["Admin"] : ["Profesor", "Estudiante"];
  if (!uuidPattern.test(institutionId || "")
    || typeof documento !== "string" || documento.trim().length < 3 || documento.trim().length > 30
    || typeof nombre !== "string" || nombre.trim().length < 2 || nombre.trim().length > 80
    || typeof apellido !== "string" || apellido.trim().length < 2 || apellido.trim().length > 80
    || !allowedRoles.includes(rol)
    || (personalEmail && !normalizedEmail(personalEmail))) {
    return sendError(response, 400, "Completa los datos requeridos y selecciona un rol permitido.");
  }
  let client;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const email = await createInstitutionalEmail(client, institutionId, nombre.trim(), apellido.trim());
    const linkCode = rol === "Estudiante" ? createSessionToken() : null;
    const inserted = await client.query(
      `INSERT INTO usuarios (
         institucion_id, documento, nombre, apellido, email, email_personal,
         password_hash, primer_ingreso, codigo_vinculacion, rol
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULL, TRUE, $7, $8)
       RETURNING id`,
      [
        institutionId,
        documento.trim(),
        nombre.trim(),
        apellido.trim(),
        email,
        personalEmail ? personalEmail.trim().toLowerCase() : null,
        linkCode ? hashSessionToken(linkCode) : null,
        rol
      ]
    );
    const newUserId = inserted.rows[0].id;
    const activationToken = await issueActivation(client, newUserId);
    const activationUrl = new URL(
      `/activar.html?token=${encodeURIComponent(activationToken)}`,
      publicBaseUrl
    ).toString();
    await enqueueEmail(client, {
      recipient: personalEmail ? personalEmail.trim().toLowerCase() : email,
      subject: "Activa tu cuenta ZETTA",
      body: `Hola ${nombre.trim()},\n\nActiva tu cuenta antes de 24 horas usando este enlace:\n${activationUrl}\n\nSi no solicitaste esta cuenta, ignora este mensaje.`
    });
    await logAudit(client, {
      institutionId,
      userId: user.id,
      action: "create",
      entity: "usuarios",
      entityId: newUserId,
      changes: {
        rol,
        documento: documento.trim(),
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        email,
        email_personal: personalEmail ? personalEmail.trim().toLowerCase() : null
      }
    });
    await client.query("COMMIT");
    response.status(201).json({
      id: newUserId,
      email,
      activationUrl,
      ...(linkCode ? { codigoVinculacion: linkCode } : {})
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("User creation rollback failed.", rollbackError);
      }
    }
    next(error);
  } finally {
    client?.release();
  }
});

app.post("/api/usuarios/:id/activacion", async (request, response, next) => {
  if (!["Admin", "SuperAdmin"].includes(request.user.role) || !uuidPattern.test(request.params.id)) {
    return sendError(response, 403, "No tienes permiso para emitir este enlace de activación.");
  }
  try {
    const target = await getPool().query(
      `SELECT id, institucion_id, nombre, email, email_personal, rol, password_hash
       FROM usuarios
       WHERE id = $1 AND (
         ($2::text = 'Admin' AND institucion_id = $3 AND rol IN ('Profesor', 'Estudiante'))
         OR ($2::text = 'SuperAdmin' AND rol = 'Admin')
       )`,
      [request.params.id, request.user.role, request.user.institutionId]
    );
    const account = target.rows[0];
    if (!account) return sendError(response, 404, "No se encontró esa cuenta dentro de tu alcance.");
    if (account.password_hash) return sendError(response, 409, "La cuenta ya fue activada.");
    const token = await issueActivation(getPool(), account.id);
    const activationUrl = new URL(
      `/activar.html?token=${encodeURIComponent(token)}`,
      publicBaseUrl
    ).toString();
    const recipient = account.email_personal || account.email;
    await enqueueEmail(getPool(), {
      recipient,
      subject: "Activa tu cuenta ZETTA",
      body: `Hola ${account.nombre},\n\nActiva tu cuenta antes de 24 horas usando este enlace:\n${activationUrl}`
    });
    await logAudit(getPool(), {
      institutionId: account.institucion_id,
      userId: request.user.id,
      action: "reissue",
      entity: "activaciones_cuenta",
      entityId: account.id
    });
    response.status(201).json({ activationUrl });
  } catch (error) {
    next(error);
  }
});

app.post("/api/instituciones", async (request, response, next) => {
  if (request.user.role !== "SuperAdmin") {
    return sendError(response, 403, "Solo el SuperAdmin puede registrar instituciones.");
  }
  try {
    const normalized = await normalizeInput(getEntity("instituciones"), request.body, true);
    if (normalized.error) return sendError(response, 400, normalized.error);
    const values = normalized.values;
    if (values.dominio && !isValidDomain(values.dominio)) {
      return sendError(response, 400, "Ingresa un dominio institucional válido, sin @ ni rutas.");
    }
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const entries = Object.entries(values);
      const inserted = await client.query(
        `INSERT INTO instituciones (${entries.map(([key]) => safeColumn(key)).join(", ")})
         VALUES (${entries.map((_, index) => `$${index + 1}`).join(", ")})
         RETURNING id`,
        entries.map(([, value]) => value)
      );
      const institutionId = inserted.rows[0].id;
      await client.query(
        "INSERT INTO configuracion_institucional (institucion_id) VALUES ($1)",
        [institutionId]
      );
      await logAudit(client, {
        userId: request.user.id,
        action: "create",
        entity: "instituciones",
        entityId: institutionId,
        changes: { nombre: values.nombre, dominio: values.dominio, plan_suscripcion: values.plan_suscripcion }
      });
      await client.query("COMMIT");
      response.status(201).json({ id: institutionId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.patch("/api/perfil/correo", async (request, response, next) => {
  if (request.user.role !== "Estudiante") {
    return sendError(response, 403, "Solo un estudiante puede editar su correo institucional.");
  }
  const { email, email_personal: personalEmail } = request.body ?? {};
  if (!normalizedEmail(email) || (personalEmail && !normalizedEmail(personalEmail))) {
    return sendError(response, 400, "Ingresa correos electrónicos válidos.");
  }
  try {
    const result = await getPool().query(
      `UPDATE usuarios SET email = lower($2), email_personal = $3
       WHERE id = $1 AND rol = 'Estudiante' RETURNING email, email_personal`,
      [request.user.id, email.trim(), personalEmail ? personalEmail.trim().toLowerCase() : null]
    );
    await logAudit(getPool(), {
      institutionId: request.user.institutionId,
      userId: request.user.id,
      action: "update",
      entity: "usuarios",
      entityId: request.user.id,
      changes: {
        email: result.rows[0]?.email,
        email_personal: result.rows[0]?.email_personal
      }
    });
    response.json({ email: result.rows[0]?.email });
  } catch (error) {
    next(error);
  }
});

app.post("/api/perfil/codigo-vinculacion", async (request, response, next) => {
  if (request.user.role !== "Estudiante") {
    return sendError(response, 403, "Solo un estudiante puede emitir un código de vinculación.");
  }
  const code = createSessionToken();
  try {
    await getPool().query(
      "UPDATE usuarios SET codigo_vinculacion = $2 WHERE id = $1",
      [request.user.id, hashSessionToken(code)]
    );
    await logAudit(getPool(), {
      institutionId: request.user.institutionId,
      userId: request.user.id,
      action: "rotate",
      entity: "codigo_vinculacion",
      entityId: request.user.id
    });
    response.status(201).json({ codigoVinculacion: code });
  } catch (error) {
    next(error);
  }
});

app.post("/api/acudidos/vincular", async (request, response, next) => {
  if (request.user.role !== "Acudiente") {
    return sendError(response, 403, "Solo un acudiente puede vincular estudiantes.");
  }
  const { codigo } = request.body ?? {};
  if (typeof codigo !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(codigo)) {
    return sendError(response, 400, "El código de vinculación no es válido.");
  }
  try {
    const linked = await getPool().query(
      `INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id)
       SELECT $1, u.id
       FROM usuarios u
       WHERE u.codigo_vinculacion = $2 AND u.rol = 'Estudiante'
         AND u.institucion_id = $3
       ON CONFLICT DO NOTHING
       RETURNING estudiante_id`,
      [request.user.id, hashSessionToken(codigo), request.user.institutionId]
    );
    if (!linked.rowCount) return sendError(response, 404, "Código inválido o estudiante ya vinculado.");
    await logAudit(getPool(), {
      institutionId: request.user.institutionId,
      userId: request.user.id,
      action: "link",
      entity: "acudientes_estudiantes",
      entityId: linked.rows[0].estudiante_id
    });
    response.status(201).json({ linked: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/saas/metrics", async (request, response, next) => {
  if (request.user.role !== "SuperAdmin") {
    return sendError(response, 403, "Solo el SuperAdmin puede consultar métricas globales.");
  }
  try {
    const [totals, plans, institutions] = await Promise.all([
      getPool().query(
        `SELECT (SELECT count(*) FROM instituciones) AS instituciones,
                (SELECT count(*) FROM usuarios) AS usuarios,
                (SELECT count(*) FROM cursos) AS cursos`
      ),
      getPool().query(
        `SELECT plan_suscripcion, count(*) AS instituciones
         FROM instituciones GROUP BY plan_suscripcion ORDER BY plan_suscripcion`
      ),
      getPool().query(
        `SELECT i.id, i.nombre, i.plan_suscripcion,
                count(DISTINCT u.id) AS usuarios, count(DISTINCT c.id) AS cursos
         FROM instituciones i
         LEFT JOIN usuarios u ON u.institucion_id = i.id
         LEFT JOIN cursos c ON c.institucion_id = i.id
         GROUP BY i.id ORDER BY i.nombre LIMIT 500`
      )
    ]);
    response.json({ totals: totals.rows[0], plans: plans.rows, institutions: institutions.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (request, response, next) => {
  const token = parseCookies(request.headers.cookie)[sessionCookie];
  try {
    if (token) {
      await getPool().query("DELETE FROM zetta_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
    }
  } catch (error) {
    next(error);
    return;
  }
  clearSessionCookie(response);
  response.status(204).end();
});

const allowMethods = (entity, role, method) => {
  if (entity.table === "excusas" && role === "Acudiente") return method === "GET" || method === "POST";
  const allowed = method === "GET" ? entity.readRoles : entity.writeRoles;
  return allowed.includes(role);
};

const scopeFor = (entityKey, user) => {
  const userId = user.id;
  const institutionId = user.institutionId;
  const courseScope = (courseAlias) => {
    if (user.role === "Admin") return `${courseAlias}.institucion_id = $1`;
    if (user.role === "Profesor") {
      return `EXISTS (SELECT 1 FROM asignaturas sa WHERE sa.curso_id = ${courseAlias}.id AND sa.profesor_id = $1)`;
    }
    if (user.role === "Estudiante") {
      return `EXISTS (SELECT 1 FROM matriculas sm WHERE sm.curso_id = ${courseAlias}.id AND sm.estudiante_id = $1)`;
    }
    return `EXISTS (
      SELECT 1 FROM matriculas sm
      LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = sm.estudiante_id
      WHERE sm.curso_id = ${courseAlias}.id
        AND (sm.acudiente_id = $1 OR ae.acudiente_id = $1)
    )`;
  };
  switch (entityKey) {
    case "instituciones":
      return user.role === "SuperAdmin"
        ? { sql: "TRUE", values: [] }
        : { sql: "t.id = $1", values: [institutionId] };
    case "usuarios":
      if (user.role === "Admin") return { sql: "t.institucion_id = $1", values: [institutionId] };
      if (user.role === "SuperAdmin") return { sql: "TRUE", values: [] };
      if (user.role === "Profesor") {
        return {
          sql: `t.id = $1 OR (t.rol = 'Estudiante' AND EXISTS (
            SELECT 1 FROM matriculas m
            JOIN asignaturas a ON a.curso_id = m.curso_id
            WHERE m.estudiante_id = t.id AND a.profesor_id = $1
          ))`,
          values: [userId]
        };
      }
      return { sql: "FALSE", values: [] };
    case "cursos":
      return { sql: courseScope("t"), values: [user.role === "Admin" ? institutionId : userId] };
    case "asignaturas":
      if (user.role === "Admin") {
        return {
          sql: "EXISTS (SELECT 1 FROM cursos sc WHERE sc.id = t.curso_id AND sc.institucion_id = $1)",
          values: [institutionId]
        };
      }
      if (user.role === "Profesor") return { sql: "t.profesor_id = $1", values: [userId] };
      return {
        sql: user.role === "Estudiante"
          ? "EXISTS (SELECT 1 FROM matriculas sm WHERE sm.curso_id = t.curso_id AND sm.estudiante_id = $1)"
          : `EXISTS (
              SELECT 1 FROM matriculas sm
              LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = sm.estudiante_id
              WHERE sm.curso_id = t.curso_id AND
                (sm.acudiente_id = $1 OR ae.acudiente_id = $1)
            )`,
        values: [userId]
      };
    case "horarios":
      return user.role === "Admin"
        ? {
          sql: "EXISTS (SELECT 1 FROM asignaturas sa JOIN cursos sc ON sc.id = sa.curso_id WHERE sa.id = t.asignatura_id AND sc.institucion_id = $1)",
          values: [institutionId]
        }
        : { sql: "EXISTS (SELECT 1 FROM asignaturas sa WHERE sa.id = t.asignatura_id AND sa.profesor_id = $1)", values: [userId] };
    case "matriculas":
      if (user.role === "Admin") {
        return {
          sql: "EXISTS (SELECT 1 FROM cursos sc WHERE sc.id = t.curso_id AND sc.institucion_id = $1)",
          values: [institutionId]
        };
      }
      if (user.role === "Profesor") {
        return {
          sql: "EXISTS (SELECT 1 FROM asignaturas sa WHERE sa.curso_id = t.curso_id AND sa.profesor_id = $1)",
          values: [userId]
        };
      }
      return {
        sql: user.role === "Estudiante"
          ? "t.estudiante_id = $1"
          : "(t.acudiente_id = $1 OR EXISTS (SELECT 1 FROM acudientes_estudiantes ae WHERE ae.estudiante_id = t.estudiante_id AND ae.acudiente_id = $1))",
        values: [userId]
      };
    case "calificaciones":
    case "asistencia": {
      if (user.role === "Admin") {
        return {
          sql: `EXISTS (SELECT 1 FROM matriculas sm JOIN cursos sc ON sc.id = sm.curso_id WHERE sm.id = t.matricula_id AND sc.institucion_id = $1)`,
          values: [institutionId]
        };
      }
      if (user.role === "Profesor") {
        return {
          sql: "EXISTS (SELECT 1 FROM asignaturas sa WHERE sa.id = t.asignatura_id AND sa.profesor_id = $1)",
          values: [userId]
        };
      }
      const relationColumn = user.role === "Estudiante" ? "estudiante_id" : "acudiente_id";
      return {
        sql: user.role === "Estudiante"
          ? "EXISTS (SELECT 1 FROM matriculas sm WHERE sm.id = t.matricula_id AND sm.estudiante_id = $1)"
          : `EXISTS (
              SELECT 1 FROM matriculas sm
              LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = sm.estudiante_id
              WHERE sm.id = t.matricula_id AND (sm.acudiente_id = $1 OR ae.acudiente_id = $1)
            )`,
        values: [userId]
      };
    }
    case "periodos":
      return user.role === "SuperAdmin"
        ? { sql: "TRUE", values: [] }
        : { sql: "t.institucion_id = $1", values: [institutionId] };
    case "actividades":
      return user.role === "Admin"
        ? {
          sql: "EXISTS (SELECT 1 FROM asignaturas sa JOIN cursos sc ON sc.id = sa.curso_id WHERE sa.id = t.asignatura_id AND sc.institucion_id = $1)",
          values: [institutionId]
        }
        : user.role === "Profesor"
          ? {
            sql: "EXISTS (SELECT 1 FROM asignaturas sa WHERE sa.id = t.asignatura_id AND sa.profesor_id = $1)",
            values: [userId]
          }
          : {
            sql: `EXISTS (
              SELECT 1 FROM asignaturas sa
              JOIN matriculas sm ON sm.curso_id = sa.curso_id
              LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = sm.estudiante_id
              WHERE sa.id = t.asignatura_id AND
                (sm.estudiante_id = $1 OR sm.acudiente_id = $1 OR ae.acudiente_id = $1)
            )`,
            values: [userId]
          };
    case "notas_actividades":
      return user.role === "Admin"
        ? {
          sql: `EXISTS (SELECT 1 FROM actividades ac JOIN asignaturas sa ON sa.id = ac.asignatura_id JOIN cursos sc ON sc.id = sa.curso_id WHERE ac.id = t.actividad_id AND sc.institucion_id = $1)`,
          values: [institutionId]
        }
        : user.role === "Profesor"
          ? {
            sql: `EXISTS (SELECT 1 FROM actividades ac JOIN asignaturas sa ON sa.id = ac.asignatura_id WHERE ac.id = t.actividad_id AND sa.profesor_id = $1)`,
            values: [userId]
          }
          : {
            sql: `EXISTS (
              SELECT 1 FROM matriculas sm
              LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = sm.estudiante_id
              WHERE sm.id = t.matricula_id AND
                (sm.estudiante_id = $1 OR sm.acudiente_id = $1 OR ae.acudiente_id = $1)
            )`,
            values: [userId]
          };
    case "observaciones":
      if (user.role === "Admin") return { sql: "t.institucion_id = $1", values: [institutionId] };
      if (user.role === "Profesor") return { sql: "t.profesor_id = $1", values: [userId] };
      return {
        sql: user.role === "Estudiante"
          ? "t.estudiante_id = $1"
          : "EXISTS (SELECT 1 FROM acudientes_estudiantes ae WHERE ae.estudiante_id = t.estudiante_id AND ae.acudiente_id = $1)",
        values: [userId]
      };
    case "excusas":
      return user.role === "Admin"
        ? {
          sql: "EXISTS (SELECT 1 FROM asistencia a JOIN matriculas m ON m.id = a.matricula_id JOIN cursos c ON c.id = m.curso_id WHERE a.id = t.asistencia_id AND c.institucion_id = $1)",
          values: [institutionId]
        }
        : { sql: "t.acudiente_id = $1", values: [userId] };
    case "audit_log":
      return user.role === "SuperAdmin"
        ? { sql: "TRUE", values: [] }
        : { sql: "FALSE", values: [] };
    default:
      return { sql: "FALSE", values: [] };
  }
};

const normalizeInput = async (entity, body, isCreate) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Envía los datos del registro en formato JSON." };
  }
  const allowed = new Map(entity.fields.map((item) => [item.key, item]));
  const unknownFields = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknownFields.length) return { error: `Campos no permitidos: ${unknownFields.join(", ")}.` };
  const values = {};

  for (const item of entity.fields) {
    const hasValue = Object.hasOwn(body, item.key);
    let value = body[item.key];
    if (item.readOnly) continue;
    if (item.writeOnly && !isCreate && value === "") continue;
    if (!hasValue || value === "" || value === null) {
      if (item.required && (isCreate || hasValue)) return { error: `${item.label} es obligatorio.` };
      if (hasValue && !item.required && !item.writeOnly) values[item.key] = null;
      continue;
    }
    if (item.type === "password") {
      if (typeof value !== "string" || value.length < 8 || value.length > 200) {
        return { error: "La contraseña debe tener entre 8 y 200 caracteres." };
      }
      values.password_hash = await hashPassword(value);
      continue;
    }
    if (item.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value) || value < item.min || value > item.max) {
        return { error: `${item.label} debe estar entre ${item.min} y ${item.max}.` };
      }
      values[item.key] = value;
      continue;
    }
    if (item.type === "select" && !item.options.includes(value)) {
      return { error: `El valor de ${item.label} no está permitido.` };
    }
    if (item.type === "reference" && (typeof value !== "string" || !uuidPattern.test(value))) {
      return { error: `Selecciona un valor válido para ${item.label}.` };
    }
    if (item.type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      return { error: `La fecha de ${item.label} no es válida.` };
    }
    if (item.type === "time" && (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value))) {
      return { error: `La hora de ${item.label} no es válida.` };
    }
    if (typeof value !== "string" || (item.maxLength && value.length > item.maxLength)) {
      return { error: `${item.label} no es válido o supera el límite permitido.` };
    }
    if (item.type === "email" && !normalizedEmail(value)) {
      return { error: "Ingresa un correo electrónico válido." };
    }
    if (item.key === "dominio" && !isValidDomain(value.trim())) {
      return { error: "Ingresa un dominio válido, sin @ ni rutas." };
    }
    values[item.key] = ["email", "dominio"].includes(item.key)
      ? value.trim().toLowerCase()
      : value.trim();
  }
  return { values };
};

const hasLegacyGradeWeightRoom = async (values, recordId) => {
  const result = await getPool().query(
    `SELECT COALESCE(sum(porcentaje), 0) AS total
     FROM calificaciones
     WHERE matricula_id = $1 AND asignatura_id = $2 AND periodo = $3
       AND ($4::uuid IS NULL OR id <> $4)`,
    [values.matricula_id, values.asignatura_id, values.periodo, recordId]
  );
  return Number(result.rows[0].total) + Number(values.porcentaje) <= 100.0001;
};

const periodIsConfigured = async (institutionId, period) => {
  const result = await getPool().query(
    "SELECT num_periodos FROM configuracion_institucional WHERE institucion_id = $1",
    [institutionId]
  );
  return period >= 1 && period <= Number(result.rows[0]?.num_periodos || 4);
};

const validateWriteScope = async (entityKey, values, user, recordId = null) => {
  if (user.role === "SuperAdmin") return entityKey === "instituciones";
  if (user.role === "Admin") {
    if (entityKey === "instituciones") {
      if (values.id !== user.institutionId) return false;
      if (values.nombre !== undefined && values.nombre !== null) {
        const current = await getPool().query(
          "SELECT nombre, fecha_cambio_nombre FROM instituciones WHERE id = $1",
          [user.institutionId]
        );
        const row = current.rows[0];
        if (!row) return false;
        if (values.nombre !== row.nombre && row.fecha_cambio_nombre
          && Date.now() - new Date(row.fecha_cambio_nombre).getTime() < 60 * 24 * 60 * 60 * 1000) {
          return false;
        }
      }
      return true;
    }
    if (entityKey === "usuarios") {
      return values.institucion_id === user.institutionId && ["Profesor", "Estudiante"].includes(values.rol);
    }
    if (entityKey === "cursos") {
      if (values.institucion_id !== user.institutionId) return false;
      if (!values.director_grupo_id) return true;
      const director = await getPool().query(
        "SELECT 1 FROM usuarios WHERE id = $1 AND institucion_id = $2 AND rol = 'Profesor'",
        [values.director_grupo_id, user.institutionId]
      );
      return director.rowCount > 0;
    }
    if (entityKey === "horarios") {
      const result = await getPool().query(
        `SELECT 1 FROM asignaturas a
         JOIN cursos c ON c.id = a.curso_id
         WHERE a.id = $1 AND c.institucion_id = $2 AND $3::time > $4::time`,
        [values.asignatura_id, user.institutionId, values.hora_fin, values.hora_inicio]
      );
      return result.rowCount > 0;
    }
    if (entityKey === "asignaturas") {
      const result = await getPool().query(
        `SELECT 1 FROM cursos c JOIN usuarios u ON u.id = $2
         WHERE c.id = $1 AND c.institucion_id = $3 AND u.institucion_id = $3 AND u.rol = 'Profesor'`,
        [values.curso_id, values.profesor_id, user.institutionId]
      );
      return result.rowCount > 0;
    }
    if (entityKey === "matriculas") {
      const result = await getPool().query(
        `SELECT 1 FROM cursos c
         JOIN usuarios s ON s.id = $2 AND s.rol = 'Estudiante'
         LEFT JOIN usuarios g ON g.id = $3 AND g.rol = 'Acudiente'
         WHERE c.id = $1 AND c.institucion_id = $4
           AND s.institucion_id = $4 AND ($3::uuid IS NULL OR g.institucion_id = $4)`,
        [values.curso_id, values.estudiante_id, values.acudiente_id || null, user.institutionId]
      );
      return result.rowCount > 0;
    }
    if (["calificaciones", "asistencia"].includes(entityKey)) {
      if (entityKey === "calificaciones" && !await periodIsConfigured(user.institutionId, values.periodo)) return false;
      const result = await getPool().query(
        `SELECT 1 FROM matriculas m
         JOIN cursos c ON c.id = m.curso_id
         JOIN asignaturas a ON a.id = $2 AND a.curso_id = m.curso_id
         WHERE m.id = $1 AND c.institucion_id = $3`,
        [values.matricula_id, values.asignatura_id, user.institutionId]
      );
      if (!result.rowCount) return false;
      if (entityKey === "calificaciones") {
        const closed = await getPool().query(
          `SELECT p.cerrado
           FROM matriculas m
           JOIN cursos c ON c.id = m.curso_id
           LEFT JOIN periodos p ON p.institucion_id = c.institucion_id
             AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = $2
           WHERE m.id = $1`,
          [values.matricula_id, values.periodo]
        );
        return !closed.rows[0]?.cerrado && await hasLegacyGradeWeightRoom(values, recordId);
      }
      return true;
    }
    if (entityKey === "actividades") {
      if (!await periodIsConfigured(user.institutionId, values.periodo)) return false;
      const subject = await getPool().query(
        `SELECT a.id, c.institucion_id, c.periodo_lectivo
         FROM asignaturas a JOIN cursos c ON c.id = a.curso_id
         WHERE a.id = $1 AND c.institucion_id = $2`,
        [values.asignatura_id, user.institutionId]
      );
      if (!subject.rowCount) return false;
      const closed = await getPool().query(
        `SELECT cerrado FROM periodos
         WHERE institucion_id = $1 AND periodo_lectivo = $2 AND numero = $3`,
        [user.institutionId, subject.rows[0].periodo_lectivo, values.periodo]
      );
      if (closed.rows[0]?.cerrado) return false;
      const weights = await getPool().query(
        `SELECT COALESCE(sum(peso_porcentaje), 0) AS total
         FROM actividades
         WHERE asignatura_id = $1 AND periodo = $2 AND ($3::uuid IS NULL OR id <> $3)`,
        [values.asignatura_id, values.periodo, recordId]
      );
      const total = Number(weights.rows[0].total) + Number(values.peso_porcentaje);
      return total <= 100.0001;
    }
    if (entityKey === "notas_actividades") {
      const assignment = await getPool().query(
        `SELECT a.profesor_id, a.asignatura_id, a.periodo, c.institucion_id, m.curso_id,
                c.periodo_lectivo
         FROM actividades a
         JOIN asignaturas s ON s.id = a.asignatura_id
         JOIN cursos c ON c.id = s.curso_id
         JOIN matriculas m ON m.id = $2
         JOIN usuarios u ON u.id = m.estudiante_id AND u.rol = 'Estudiante'
         WHERE a.id = $1 AND m.curso_id = s.curso_id AND c.institucion_id = $3`,
        [values.actividad_id, values.matricula_id, user.institutionId]
      );
      const detail = assignment.rows[0];
      if (!detail || (user.role === "Profesor" && detail.profesor_id !== user.id)) return false;
      if (!await periodIsConfigured(user.institutionId, detail.periodo)) return false;
      const [weights, closure] = await Promise.all([
        getPool().query(
          "SELECT COALESCE(sum(peso_porcentaje), 0) AS total FROM actividades WHERE asignatura_id = $1 AND periodo = $2",
          [detail.asignatura_id, detail.periodo]
        ),
        getPool().query(
          `SELECT cerrado FROM periodos
           WHERE institucion_id = $1 AND periodo_lectivo = $2 AND numero = $3`,
          [detail.institucion_id, detail.periodo_lectivo, detail.periodo]
        )
      ]);
      return Math.abs(Number(weights.rows[0].total) - 100) < 0.001 && !closure.rows[0]?.cerrado;
    }
    if (entityKey === "observaciones") {
      if (values.institucion_id !== user.institutionId || values.profesor_id !== user.id) return false;
      const result = await getPool().query(
        `SELECT 1 FROM cursos c
         JOIN usuarios u ON u.id = $2 AND u.institucion_id = c.institucion_id AND u.rol = 'Estudiante'
         JOIN asignaturas a ON a.curso_id = c.id AND a.profesor_id = $3
         WHERE c.id = $1 AND c.institucion_id = $4`,
        [values.curso_id, values.estudiante_id, user.id, user.institutionId]
      );
      return result.rowCount > 0;
    }
    if (entityKey === "excusas") {
      const result = await getPool().query(
        `SELECT 1
         FROM asistencia a
         JOIN matriculas m ON m.id = a.matricula_id
         JOIN cursos c ON c.id = m.curso_id
         LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = m.estudiante_id
         WHERE a.id = $1 AND c.institucion_id = $2
           AND ($3::uuid IS NULL OR m.acudiente_id = $3 OR ae.acudiente_id = $3)`,
        [values.asistencia_id, user.institutionId, user.role === "Acudiente" ? user.id : values.acudiente_id || null]
      );
      return result.rowCount > 0;
    }
  }
  if (user.role === "Profesor" && ["calificaciones", "asistencia"].includes(entityKey)) {
    if (entityKey === "calificaciones" && !await periodIsConfigured(user.institutionId, values.periodo)) return false;
    const result = await getPool().query(
      `SELECT 1 FROM asignaturas a
       JOIN matriculas m ON m.id = $2 AND m.curso_id = a.curso_id
       WHERE a.id = $1 AND a.profesor_id = $3`,
      [values.asignatura_id, values.matricula_id, user.id]
    );
    if (!result.rowCount) return false;
    if (entityKey === "calificaciones") {
      const closed = await getPool().query(
        `SELECT p.cerrado FROM asignaturas a
         JOIN cursos c ON c.id = a.curso_id
         LEFT JOIN periodos p ON p.institucion_id = c.institucion_id
           AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = $2
         WHERE a.id = $1`,
        [values.asignatura_id, values.periodo]
      );
      return !closed.rows[0]?.cerrado && await hasLegacyGradeWeightRoom(values, recordId);
    }
    return true;
  }
  if (user.role === "Profesor" && entityKey === "actividades") {
    if (!await periodIsConfigured(user.institutionId, values.periodo)) return false;
    const assignment = await getPool().query(
      `SELECT 1 FROM asignaturas WHERE id = $1 AND profesor_id = $2`,
      [values.asignatura_id, user.id]
    );
    if (!assignment.rowCount) return false;
    const closure = await getPool().query(
      `SELECT p.cerrado FROM asignaturas a
       JOIN cursos c ON c.id = a.curso_id
       LEFT JOIN periodos p ON p.institucion_id = c.institucion_id
         AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = $2
       WHERE a.id = $1`,
      [values.asignatura_id, values.periodo]
    );
    if (closure.rows[0]?.cerrado) return false;
    const weights = await getPool().query(
      `SELECT COALESCE(sum(peso_porcentaje), 0) AS total FROM actividades
       WHERE asignatura_id = $1 AND periodo = $2 AND ($3::uuid IS NULL OR id <> $3)`,
      [values.asignatura_id, values.periodo, recordId]
    );
    return Number(weights.rows[0].total) + Number(values.peso_porcentaje) <= 100.0001;
  }
  if (user.role === "Profesor" && entityKey === "notas_actividades") {
    const assignment = await getPool().query(
      `SELECT a.profesor_id, a.asignatura_id, a.periodo, c.institucion_id, m.curso_id,
              c.periodo_lectivo
       FROM actividades a
       JOIN asignaturas s ON s.id = a.asignatura_id
       JOIN cursos c ON c.id = s.curso_id
       JOIN matriculas m ON m.id = $2
       JOIN usuarios u ON u.id = m.estudiante_id AND u.rol = 'Estudiante'
       WHERE a.id = $1 AND m.curso_id = s.curso_id AND a.profesor_id = $3`,
      [values.actividad_id, values.matricula_id, user.id]
    );
    const detail = assignment.rows[0];
    if (!detail) return false;
    if (!await periodIsConfigured(user.institutionId, detail.periodo)) return false;
    const [weights, closure] = await Promise.all([
      getPool().query(
        "SELECT COALESCE(sum(peso_porcentaje), 0) AS total FROM actividades WHERE asignatura_id = $1 AND periodo = $2",
        [detail.asignatura_id, detail.periodo]
      ),
      getPool().query(
        `SELECT cerrado FROM periodos
         WHERE institucion_id = $1 AND periodo_lectivo = $2 AND numero = $3`,
        [detail.institucion_id, detail.periodo_lectivo, detail.periodo]
      )
    ]);
    return Math.abs(Number(weights.rows[0].total) - 100) < 0.001 && !closure.rows[0]?.cerrado;
  }
  if (user.role === "Profesor" && entityKey === "observaciones") {
    if (values.profesor_id !== user.id) return false;
    const result = await getPool().query(
      `SELECT 1 FROM cursos c
       JOIN usuarios u ON u.id = $2 AND u.institucion_id = c.institucion_id AND u.rol = 'Estudiante'
       JOIN asignaturas a ON a.curso_id = c.id AND a.profesor_id = $3
       WHERE c.id = $1`,
      [values.curso_id, values.estudiante_id, user.id]
    );
    return result.rowCount > 0;
  }
  if (user.role === "Acudiente" && entityKey === "excusas") {
    values.acudiente_id = user.id;
    values.estado = "Pendiente";
    const result = await getPool().query(
      `SELECT 1 FROM asistencia a
       JOIN matriculas m ON m.id = a.matricula_id
       LEFT JOIN acudientes_estudiantes ae ON ae.estudiante_id = m.estudiante_id
       WHERE a.id = $1 AND (m.acudiente_id = $2 OR ae.acudiente_id = $2)`,
      [values.asistencia_id, user.id]
    );
    return result.rowCount > 0;
  }
  return false;
};

const safeColumn = (key) => `"${key}"`;

app.get("/api/entities", (request, response) => {
  response.json(publicEntities(request.user.role));
});

app.get("/api/:entity", async (request, response, next) => {
  const entity = getEntity(request.params.entity);
  if (!entity) return sendError(response, 404, "Entidad no encontrada.");
  if (!allowMethods(entity, request.user.role, "GET")) {
    return sendError(response, 403, "Tu perfil no tiene permiso para consultar esta sección.");
  }
  const maxLimit = request.user.role === "SuperAdmin" && request.params.entity === "usuarios" ? 2000 : 200;
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), maxLimit);
  const scope = scopeFor(request.params.entity, request.user);
  const columns = ["id", ...entity.fields.filter((item) => !item.writeOnly).map((item) => item.key)];
  try {
    const result = await getPool().query(
      `SELECT ${columns.map(safeColumn).join(", ")} FROM "${entity.table}" AS t
       WHERE ${scope.sql} ORDER BY t."id" LIMIT $${scope.values.length + 1}`,
      [...scope.values, limit]
    );
    response.json({ records: result.rows, limit });
  } catch (error) {
    next(error);
  }
});

app.post("/api/:entity", async (request, response, next) => {
  const entityKey = request.params.entity;
  const entity = getEntity(entityKey);
  if (!entity) return sendError(response, 404, "Entidad no encontrada.");
  if (!allowMethods(entity, request.user.role, "POST")) {
    return sendError(response, 403, "Tu perfil no tiene permiso para crear registros en esta sección.");
  }
  try {
    const normalized = await normalizeInput(entity, request.body, true);
    if (normalized.error) return sendError(response, 400, normalized.error);
    const { values } = normalized;
    if (entityKey === "observaciones" && request.user.role === "Profesor") {
      values.institucion_id = request.user.institutionId;
      values.profesor_id = request.user.id;
    }
    if (!await validateWriteScope(entityKey, values, request.user)) {
      return sendError(response, 403, "El registro debe pertenecer a tu institución y estar dentro de tus asignaciones.");
    }
    const entries = Object.entries(values);
    if (!entries.length) return sendError(response, 400, "Agrega al menos un dato.");
    const result = await getPool().query(
      `INSERT INTO "${entity.table}" (${entries.map(([key]) => safeColumn(key)).join(", ")})
       VALUES (${entries.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING "id"`,
      entries.map(([, value]) => value)
    );
    if (entityKey === "matriculas" && values.acudiente_id) {
      await getPool().query(
        `INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [values.acudiente_id, values.estudiante_id]
      );
    }
    await logAudit(getPool(), {
      institutionId: values.institucion_id || request.user.institutionId || null,
      userId: request.user.id,
      action: "create",
      entity: entityKey,
      entityId: result.rows[0].id,
      changes: values
    });
    response.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    next(error);
  }
});

app.put("/api/:entity/:id", async (request, response, next) => {
  const entityKey = request.params.entity;
  const entity = getEntity(entityKey);
  if (!entity) return sendError(response, 404, "Entidad no encontrada.");
  if (!uuidPattern.test(request.params.id)) return sendError(response, 400, "El identificador no es válido.");
  if (!allowMethods(entity, request.user.role, "PUT")) {
    return sendError(response, 403, "Tu perfil no tiene permiso para editar registros en esta sección.");
  }
  try {
    const scope = scopeFor(entityKey, request.user);
    const existing = await getPool().query(
      `SELECT ${["id", ...entity.fields.filter((item) => !item.writeOnly).map((item) => item.key)]
        .map(safeColumn).join(", ")} FROM "${entity.table}" AS t
       WHERE t."id" = $${scope.values.length + 1} AND ${scope.sql} LIMIT 1`,
      [...scope.values, request.params.id]
    );
    if (!existing.rows[0]) return sendError(response, 404, "El registro no existe o no está dentro de tu alcance.");
    if (entityKey === "usuarios" && request.user.role === "Admin"
      && !["Estudiante", "Profesor"].includes(existing.rows[0].rol)) {
      return sendError(response, 403, "El administrador solo puede editar perfiles de estudiantes y profesores.");
    }
    const normalized = await normalizeInput(entity, request.body, false);
    if (normalized.error) return sendError(response, 400, normalized.error);
    if (entityKey === "instituciones" && request.user.role === "Admin") {
      if (["nit_codigo", "plan_suscripcion"].some((key) => (
        Object.hasOwn(normalized.values, key) && normalized.values[key] !== existing.rows[0][key]
      ))) {
        return sendError(response, 403, "El administrador no puede modificar el NIT ni el plan de suscripción.");
      }
      if (Object.hasOwn(normalized.values, "dominio")
        && !normalized.values.dominio && existing.rows[0].dominio) {
        return sendError(response, 400, "No puedes borrar un dominio institucional ya configurado.");
      }
      if (Object.hasOwn(normalized.values, "nombre")
        && normalized.values.nombre !== existing.rows[0].nombre) {
        if (existing.rows[0].fecha_cambio_nombre
          && Date.now() - new Date(existing.rows[0].fecha_cambio_nombre).getTime() < 60 * 24 * 60 * 60 * 1000) {
          return sendError(response, 409, "El nombre institucional solo puede cambiarse cada 60 días.");
        }
        normalized.values.fecha_cambio_nombre = new Date().toISOString();
      }
    }
    const values = { ...existing.rows[0], ...normalized.values };
    if (!await validateWriteScope(entityKey, values, request.user, request.params.id)) {
      return sendError(response, 403, entityKey === "instituciones"
        ? "El registro no cumple las reglas de modificación institucional."
        : "El registro debe permanecer dentro de tu institución y tus asignaciones.");
    }
    const entries = Object.entries(normalized.values);
    if (!entries.length) return sendError(response, 400, "No hay cambios para guardar.");
    const result = await getPool().query(
      `UPDATE "${entity.table}" SET ${entries.map(([key], index) => `${safeColumn(key)} = $${index + 1}`).join(", ")}
       WHERE "id" = $${entries.length + 1} RETURNING "id"`,
      [...entries.map(([, value]) => value), request.params.id]
    );
    if (!result.rowCount) return sendError(response, 404, "El registro ya no existe.");
    if (entityKey === "matriculas" && values.acudiente_id) {
      await getPool().query(
        `INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [values.acudiente_id, values.estudiante_id]
      );
    }
    await logAudit(getPool(), {
      institutionId: values.institucion_id || request.user.institutionId || null,
      userId: request.user.id,
      action: "update",
      entity: entityKey,
      entityId: request.params.id,
      changes: normalized.values
    });
    response.json({ message: "Registro actualizado." });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/:entity/:id", async (request, response, next) => {
  const entityKey = request.params.entity;
  const entity = getEntity(entityKey);
  if (!entity) return sendError(response, 404, "Entidad no encontrada.");
  if (!uuidPattern.test(request.params.id)) return sendError(response, 400, "El identificador no es válido.");
  if (!allowMethods(entity, request.user.role, "DELETE")) {
    return sendError(response, 403, "Tu perfil no tiene permiso para eliminar registros en esta sección.");
  }
  const scope = scopeFor(entityKey, request.user);
  try {
    const accessible = await getPool().query(
      `SELECT t.id FROM "${entity.table}" AS t
       WHERE t.id = $${scope.values.length + 1} AND ${scope.sql} LIMIT 1`,
      [...scope.values, request.params.id]
    );
    if (!accessible.rowCount) return sendError(response, 404, "El registro no existe o no está dentro de tu alcance.");
    if (entityKey === "usuarios" && request.user.role === "Admin") {
      const target = await getPool().query(
        "SELECT rol FROM usuarios WHERE id = $1",
        [request.params.id]
      );
      if (!["Estudiante", "Profesor"].includes(target.rows[0]?.rol)) {
        return sendError(response, 403, "El administrador solo puede eliminar perfiles de estudiantes y profesores.");
      }
    }
    if (entityKey === "actividades") {
      const graded = await getPool().query(
        "SELECT 1 FROM notas_actividades WHERE actividad_id = $1 LIMIT 1",
        [request.params.id]
      );
      if (graded.rowCount) return sendError(response, 409, "No se puede eliminar una actividad que ya tiene calificaciones.");
    }
    if (["calificaciones", "actividades", "notas_actividades"].includes(entityKey)) {
      const locked = await getPool().query(
        entityKey === "calificaciones"
          ? `SELECT 1 FROM calificaciones g
             JOIN matriculas m ON m.id = g.matricula_id
             JOIN cursos c ON c.id = m.curso_id
             JOIN periodos p ON p.institucion_id = c.institucion_id
               AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = g.periodo
             WHERE g.id = $1 AND p.cerrado`
          : entityKey === "actividades"
            ? `SELECT 1 FROM actividades a
               JOIN asignaturas s ON s.id = a.asignatura_id
               JOIN cursos c ON c.id = s.curso_id
               JOIN periodos p ON p.institucion_id = c.institucion_id
                 AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = a.periodo
               WHERE a.id = $1 AND p.cerrado`
            : `SELECT 1 FROM notas_actividades n
               JOIN actividades a ON a.id = n.actividad_id
               JOIN asignaturas s ON s.id = a.asignatura_id
               JOIN cursos c ON c.id = s.curso_id
               JOIN periodos p ON p.institucion_id = c.institucion_id
                 AND p.periodo_lectivo = c.periodo_lectivo AND p.numero = a.periodo
               WHERE n.id = $1 AND p.cerrado`,
        [request.params.id]
      );
      if (locked.rowCount) return sendError(response, 409, "No se pueden eliminar registros de un periodo cerrado.");
    }
    const result = await getPool().query(
      `DELETE FROM "${entity.table}" AS t
       WHERE t."id" = $${scope.values.length + 1} AND ${scope.sql} RETURNING t."id"`,
      [...scope.values, request.params.id]
    );
    if (!result.rowCount) return sendError(response, 404, "El registro no existe o no está dentro de tu alcance.");
    await logAudit(getPool(), {
      institutionId: request.user.institutionId || null,
      userId: request.user.id,
      action: "delete",
      entity: entityKey,
      entityId: request.params.id
    });
    response.json({ message: "Registro eliminado." });
  } catch (error) {
    next(error);
  }
});

app.get("/", (request, response) => response.redirect("/index.html"));
app.get("/dashboard.html", requirePageRoles(validRoles), (request, response) => {
  response.sendFile(path.join(landingPage, "dashboard.html"));
});
app.get("/admin.html", requirePageRoles(validRoles), (request, response) => {
  response.sendFile(path.join(landingPage, "admin.html"));
});
app.get("/perfil.html", requirePageRoles(["Estudiante", "Acudiente"]), (request, response) => {
  response.sendFile(path.join(landingPage, "perfil.html"));
});
app.get("/modules/asistencias/asistencia.html", requirePageRoles(["Admin", "Profesor"]), (request, response) => {
  response.sendFile(path.join(root, "modules", "asistencias", "asistencia.html"));
});
app.get("/planilla.html", requirePageRoles(["Admin", "Profesor"]), (request, response) => {
  response.sendFile(path.join(landingPage, "planilla.html"));
});
app.get("/modules/certificaciones/certificado-calificaciones.html", requirePageRoles(["Admin", "Estudiante", "Acudiente"]), (request, response) => {
  response.sendFile(path.join(root, "modules", "certificaciones", "certificado-calificaciones.html"));
});

app.use("/modules", express.static(path.join(root, "modules")));
app.use(express.static(landingPage));

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  console.error("Request failed.", error);
  if (error.type === "entity.parse.failed") {
    return sendError(response, 400, "El cuerpo de la solicitud no contiene JSON válido.");
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
    return sendError(response, error.status, error.message || "La solicitud no pudo completarse.");
  }
  if (error.code === "23505") {
    return sendError(response, 409, "Ya existe un registro con esos datos.");
  }
  if (error.code === "23503") {
    return sendError(response, 409, "No se puede completar la operación porque el registro está relacionado con otros datos.");
  }
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007" || error.code === "22008") {
    return sendError(response, 400, "Los datos no cumplen las reglas de la base de datos.");
  }
  if (/password_hash|institucion_id|relation .* does not exist/i.test(error.message || "")) {
    return sendError(response, 503, "El esquema de Neon no coincide con ZETTA. Revisa las tablas y columnas requeridas.");
  }
  return sendError(response, 500, "No fue posible completar la operación.");
});

let server;
const shutdown = () => {
  server?.close(async (error) => {
    if (error) {
      console.error("No fue posible cerrar el servidor.", error);
      process.exitCode = 1;
    }
    try {
      await closePool();
    } catch (poolError) {
      console.error("No fue posible cerrar la conexión con Neon.", poolError);
      process.exitCode = 1;
    }
  });
};

const start = async () => {
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS zetta_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );
  await getPool().query("CREATE INDEX IF NOT EXISTS idx_zetta_sessions_expires_at ON zetta_sessions (expires_at)");
  if (!smtpOptions()) {
    console.warn("SMTP no está configurado; los correos permanecerán en email_outbox.");
  }
  const emailWorker = setInterval(() => {
    sendPendingEmail(getPool()).catch((error) => {
      console.error("No fue posible enviar el correo pendiente.", error.message);
    });
  }, 30_000);
  emailWorker.unref();
  server = app.listen(port, host, () => {
    console.log(`ZETTA disponible en http://${host}:${port}`);
  });
};

start().catch(async (error) => {
  console.error("No fue posible iniciar ZETTA. Comprueba la conexión Neon y el esquema.", error);
  try {
    await closePool();
  } catch (closeError) {
    console.error("No fue posible cerrar la conexión con Neon.", closeError);
  }
  process.exitCode = 1;
});

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
