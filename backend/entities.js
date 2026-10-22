const field = (key, label, type = "text", options = {}) => ({
  key,
  label,
  type,
  required: false,
  ...options
});

const entities = {
  instituciones: {
    label: "Colegios",
    table: "instituciones",
    fields: [
      field("nombre", "Nombre", "text", { required: true, maxLength: 150 }),
      field("nit_codigo", "NIT / código", "text", { required: true, maxLength: 30 }),
      field("plan_suscripcion", "Plan", "select", {
        required: true,
        options: ["Lite", "Standard", "Enterprise"]
      })
    ],
    display: ["nombre", "nit_codigo", "plan_suscripcion"],
    readRoles: ["SuperAdmin"],
    writeRoles: ["SuperAdmin"]
  },
  usuarios: {
    label: "Usuarios",
    table: "usuarios",
    fields: [
      field("institucion_id", "Institución", "reference", { required: true, reference: "instituciones" }),
      field("documento", "Documento", "text", { required: true, maxLength: 30 }),
      field("nombre", "Nombre", "text", { required: true, maxLength: 80 }),
      field("apellido", "Apellido", "text", { required: true, maxLength: 80 }),
      field("email", "Correo", "email", { required: true, maxLength: 150 }),
      field("password", "Contraseña", "password", { required: true, writeOnly: true }),
      field("rol", "Rol", "select", {
        required: true,
        options: ["SuperAdmin", "Admin", "Profesor", "Estudiante", "Acudiente"]
      })
    ],
    display: ["documento", "nombre", "apellido", "email", "rol"],
    readRoles: ["Admin"],
    writeRoles: ["Admin"]
  },
  cursos: {
    label: "Cursos",
    table: "cursos",
    fields: [
      field("institucion_id", "Institución", "reference", { required: true, reference: "instituciones" }),
      field("nombre", "Curso", "text", { required: true, maxLength: 50 }),
      field("periodo_lectivo", "Año lectivo", "number", { required: true, min: 2000, max: 2200 })
    ],
    display: ["nombre", "periodo_lectivo"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin"]
  },
  asignaturas: {
    label: "Materias",
    table: "asignaturas",
    fields: [
      field("curso_id", "Curso", "reference", { required: true, reference: "cursos" }),
      field("profesor_id", "Profesor", "reference", { required: true, reference: "usuarios" }),
      field("nombre", "Materia", "text", { required: true, maxLength: 100 })
    ],
    display: ["nombre", "curso_id", "profesor_id"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin"]
  },
  matriculas: {
    label: "Matrículas",
    table: "matriculas",
    fields: [
      field("estudiante_id", "Estudiante", "reference", { required: true, reference: "usuarios" }),
      field("curso_id", "Curso", "reference", { required: true, reference: "cursos" }),
      field("acudiente_id", "Acudiente", "reference", { reference: "usuarios" })
    ],
    display: ["estudiante_id", "curso_id", "acudiente_id"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin"]
  },
  calificaciones: {
    label: "Calificaciones",
    table: "calificaciones",
    fields: [
      field("matricula_id", "Matrícula", "reference", { required: true, reference: "matriculas" }),
      field("asignatura_id", "Asignatura", "reference", { required: true, reference: "asignaturas" }),
      field("periodo", "Periodo", "number", { required: true, min: 1, max: 4 }),
      field("nota", "Nota", "number", { required: true, min: 0, max: 5, step: 0.01 }),
      field("porcentaje", "Porcentaje", "number", { required: true, min: 0, max: 100, step: 0.01 })
    ],
    display: ["matricula_id", "asignatura_id", "periodo", "nota", "porcentaje"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin", "Profesor"]
  },
  asistencia: {
    label: "Asistencia",
    table: "asistencia",
    fields: [
      field("matricula_id", "Matrícula", "reference", { required: true, reference: "matriculas" }),
      field("asignatura_id", "Asignatura", "reference", { required: true, reference: "asignaturas" }),
      field("fecha", "Fecha", "date", { required: true }),
      field("estado", "Estado", "select", {
        required: true,
        options: ["Presente", "Ausente", "Excusado", "Retardo"]
      })
    ],
    display: ["matricula_id", "asignatura_id", "fecha", "estado"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin", "Profesor"]
  }
};

const getEntity = (key) => entities[key] || null;
const publicEntities = (role) => Object.entries(entities)
  .filter(([, entity]) => entity.readRoles.includes(role))
  .map(([key, entity]) => ({
    key,
    label: entity.label,
    fields: entity.fields
      .filter((item) => item.key !== "password_hash")
      .map((item) => key === "usuarios" && role === "Admin" && item.key === "rol"
        ? { ...item, options: item.options.filter((option) => option !== "SuperAdmin") }
        : item),
    display: entity.display,
    canWrite: entity.writeRoles.includes(role)
  }));

module.exports = { entities, getEntity, publicEntities };
