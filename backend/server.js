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

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const root = path.join(__dirname, "..");
const landingPage = path.join(root, "landing_page");
const sessionCookie = "zetta_session";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validRoles = ["SuperAdmin", "Admin", "Profesor", "Estudiante", "Acudiente"];
const loginAttempts = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb", type: "application/json" }));
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
      sql: `EXISTS (SELECT 1 FROM matriculas m WHERE m.estudiante_id = ${userAlias}.id AND m.acudiente_id = $1)`,
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
  if (!uuidPattern.test(studentId) || !Number.isInteger(period) || period < 1 || period > 4) {
    return sendError(response, 400, "Selecciona un estudiante y periodo válidos.");
  }
  if (!["Admin", "Estudiante", "Acudiente"].includes(request.user.role)) {
    return sendError(response, 403, "Este perfil no puede consultar certificados.");
  }
  try {
    const scope = institutionQueryForRole(request.user, "u");
    const result = await getPool().query(
      `SELECT i.nombre AS institucion, u.id AS estudiante_id, u.nombre, u.apellido,
              u.documento, c.nombre AS curso, c.periodo_lectivo,
              a.nombre AS asignatura,
              round((sum(g.nota * g.porcentaje) / NULLIF(sum(g.porcentaje), 0))::numeric, 2) AS nota
       FROM usuarios u
       JOIN matriculas m ON m.estudiante_id = u.id
       JOIN cursos c ON c.id = m.curso_id
       JOIN instituciones i ON i.id = c.institucion_id
       JOIN calificaciones g ON g.matricula_id = m.id AND g.periodo = $${scope.values.length + 1}
       JOIN asignaturas a ON a.id = g.asignatura_id AND a.curso_id = m.curso_id
       WHERE u.id = $${scope.values.length + 2} AND u.rol = 'Estudiante' AND ${scope.sql}
       GROUP BY i.nombre, u.id, u.nombre, u.apellido, u.documento, c.nombre, c.periodo_lectivo, a.id, a.nombre
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
      `INSERT INTO usuarios (institucion_id, documento, nombre, apellido, email, password_hash, rol)
       SELECT id, $2, $3, $4, lower($5), $6, 'Acudiente'
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
    const studentColumn = user.role === "Estudiante" ? "estudiante_id" : "acudiente_id";
    return `EXISTS (SELECT 1 FROM matriculas sm WHERE sm.curso_id = ${courseAlias}.id AND sm.${studentColumn} = $1)`;
  };
  switch (entityKey) {
    case "instituciones":
      return user.role === "SuperAdmin"
        ? { sql: "TRUE", values: [] }
        : { sql: "t.id = $1", values: [institutionId] };
    case "usuarios":
      return user.role === "Admin"
        ? { sql: "t.institucion_id = $1", values: [institutionId] }
        : { sql: "FALSE", values: [] };
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
        sql: `EXISTS (SELECT 1 FROM matriculas sm WHERE sm.curso_id = t.curso_id AND sm.${user.role === "Estudiante" ? "estudiante_id" : "acudiente_id"} = $1)`,
        values: [userId]
      };
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
        sql: `t.${user.role === "Estudiante" ? "estudiante_id" : "acudiente_id"} = $1`,
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
        sql: `EXISTS (SELECT 1 FROM matriculas sm WHERE sm.id = t.matricula_id AND sm.${relationColumn} = $1)`,
        values: [userId]
      };
    }
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
    if (typeof value !== "string" || (item.maxLength && value.length > item.maxLength)) {
      return { error: `${item.label} no es válido o supera el límite permitido.` };
    }
    if (item.type === "email" && !normalizedEmail(value)) {
      return { error: "Ingresa un correo electrónico válido." };
    }
    values[item.key] = item.type === "email" ? value.trim().toLowerCase() : value.trim();
  }
  return { values };
};

const validateWriteScope = async (entityKey, values, user) => {
  if (user.role === "SuperAdmin") return entityKey === "instituciones";
  if (user.role === "Admin") {
    if (entityKey === "instituciones") return false;
    if (entityKey === "usuarios") {
      return values.institucion_id === user.institutionId && values.rol !== "SuperAdmin";
    }
    if (entityKey === "cursos") return values.institucion_id === user.institutionId;
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
      const result = await getPool().query(
        `SELECT 1 FROM matriculas m
         JOIN cursos c ON c.id = m.curso_id
         JOIN asignaturas a ON a.id = $2 AND a.curso_id = m.curso_id
         WHERE m.id = $1 AND c.institucion_id = $3`,
        [values.matricula_id, values.asignatura_id, user.institutionId]
      );
      return result.rowCount > 0;
    }
  }
  if (user.role === "Profesor" && ["calificaciones", "asistencia"].includes(entityKey)) {
    const result = await getPool().query(
      `SELECT 1 FROM asignaturas a
       JOIN matriculas m ON m.id = $2 AND m.curso_id = a.curso_id
       WHERE a.id = $1 AND a.profesor_id = $3`,
      [values.asignatura_id, values.matricula_id, user.id]
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
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 200);
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
    const normalized = await normalizeInput(entity, request.body, false);
    if (normalized.error) return sendError(response, 400, normalized.error);
    const values = { ...existing.rows[0], ...normalized.values };
    if (!await validateWriteScope(entityKey, values, request.user)) {
      return sendError(response, 403, "El registro debe permanecer dentro de tu institución y tus asignaciones.");
    }
    const entries = Object.entries(normalized.values);
    if (!entries.length) return sendError(response, 400, "No hay cambios para guardar.");
    const result = await getPool().query(
      `UPDATE "${entity.table}" SET ${entries.map(([key], index) => `${safeColumn(key)} = $${index + 1}`).join(", ")}
       WHERE "id" = $${entries.length + 1} RETURNING "id"`,
      [...entries.map(([, value]) => value), request.params.id]
    );
    if (!result.rowCount) return sendError(response, 404, "El registro ya no existe.");
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
    const result = await getPool().query(
      `DELETE FROM "${entity.table}" AS t
       WHERE t."id" = $${scope.values.length + 1} AND ${scope.sql} RETURNING t."id"`,
      [...scope.values, request.params.id]
    );
    if (!result.rowCount) return sendError(response, 404, "El registro no existe o no está dentro de tu alcance.");
    response.json({ message: "Registro eliminado." });
  } catch (error) {
    next(error);
  }
});

app.get("/", (request, response) => response.redirect("/index.html"));
app.get("/dashboard.html", requirePageRoles(validRoles), (request, response) => {
  response.sendFile(path.join(landingPage, "dashboard.html"));
});
app.get("/admin.html", requirePageRoles(["SuperAdmin", "Admin"]), (request, response) => {
  response.sendFile(path.join(landingPage, "admin.html"));
});
app.get("/modules/asistencias/asistencia.html", requirePageRoles(["Admin", "Profesor"]), (request, response) => {
  response.sendFile(path.join(root, "modules", "asistencias", "asistencia.html"));
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
