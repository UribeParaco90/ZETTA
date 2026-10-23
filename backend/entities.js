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
      field("dominio", "Dominio institucional", "text", { maxLength: 253 }),
      field("logo_url", "URL del logo", "text", { maxLength: 2048 }),
      field("firma_url", "URL de la firma", "text", { maxLength: 2048 }),
      field("fecha_cambio_nombre", "Último cambio de nombre", "text", { readOnly: true }),
      field("plan_suscripcion", "Plan", "select", {
        required: true,
        options: ["Lite", "Standard", "Enterprise"]
      })
    ],
    display: ["nombre", "nit_codigo", "dominio", "plan_suscripcion"],
    readRoles: ["SuperAdmin", "Admin"],
    writeRoles: ["SuperAdmin", "Admin"]
  },
  usuarios: {
    label: "Usuarios",
    table: "usuarios",
    fields: [
      field("institucion_id", "Institución", "reference", { required: true, reference: "instituciones" }),
      field("documento", "Documento", "text", { required: true, maxLength: 30 }),
      field("nombre", "Nombre", "text", { required: true, maxLength: 80 }),
      field("apellido", "Apellido", "text", { required: true, maxLength: 80 }),
      field("email", "Correo institucional generado", "email", { readOnly: true, maxLength: 150 }),
      field("email_personal", "Correo personal", "email", { maxLength: 150 }),
      field("primer_ingreso", "Activación pendiente", "text", { readOnly: true }),
      field("rol", "Rol", "select", {
        required: true,
        options: ["SuperAdmin", "Admin", "Profesor", "Estudiante", "Acudiente"]
      })
    ],
    display: ["documento", "nombre", "apellido", "email", "email_personal", "rol", "primer_ingreso"],
    readRoles: ["Admin", "SuperAdmin", "Profesor"],
    writeRoles: ["Admin"]
  },
  cursos: {
    label: "Cursos",
    table: "cursos",
    fields: [
      field("institucion_id", "Institución", "reference", { required: true, reference: "instituciones" }),
      field("nombre", "Curso", "text", { required: true, maxLength: 50 }),
      field("periodo_lectivo", "Año lectivo", "number", { required: true, min: 2000, max: 2200 }),
      field("aula", "Aula", "text", { maxLength: 80 }),
      field("director_grupo_id", "Director de grupo", "reference", { reference: "usuarios" })
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
      field("nombre", "Materia", "text", { required: true, maxLength: 100 }),
      field("intensidad_horaria", "Intensidad horaria semanal", "number", { min: 1, max: 80 })
    ],
    display: ["nombre", "curso_id", "profesor_id"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin"]
  },
  horarios: {
    label: "Horarios",
    table: "horarios",
    fields: [
      field("asignatura_id", "Asignatura", "reference", { required: true, reference: "asignaturas" }),
      field("dia_semana", "Día de la semana (1 a 7)", "number", { required: true, min: 1, max: 7 }),
      field("hora_inicio", "Hora de inicio", "time", { required: true }),
      field("hora_fin", "Hora de finalización", "time", { required: true }),
      field("aula", "Aula", "text", { maxLength: 80 })
    ],
    display: ["asignatura_id", "dia_semana", "hora_inicio", "hora_fin", "aula"],
    readRoles: ["Admin", "Profesor"],
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
      field("periodo", "Periodo", "number", { required: true, min: 1, max: 12 }),
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
  },
  periodos: {
    label: "Periodos académicos",
    table: "periodos",
    fields: [
      field("institucion_id", "Institución", "reference", { required: true, reference: "instituciones", readOnly: true }),
      field("periodo_lectivo", "Año lectivo", "number", { required: true, min: 2000, max: 2200 }),
      field("numero", "Número de periodo", "number", { required: true, min: 1, max: 12 }),
      field("peso_porcentaje", "Peso porcentual", "number", { required: true, min: 0.01, max: 100, step: 0.01 }),
      field("cerrado", "Cerrado", "text", { readOnly: true })
    ],
    display: ["periodo_lectivo", "numero", "peso_porcentaje", "cerrado"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: []
  },
  actividades: {
    label: "Actividades",
    table: "actividades",
    fields: [
      field("asignatura_id", "Asignatura", "reference", { required: true, reference: "asignaturas" }),
      field("periodo", "Periodo", "number", { required: true, min: 1, max: 12 }),
      field("nombre", "Actividad", "text", { required: true, maxLength: 120 }),
      field("peso_porcentaje", "Peso porcentual", "number", { required: true, min: 0.01, max: 100, step: 0.01 })
    ],
    display: ["asignatura_id", "periodo", "nombre", "peso_porcentaje"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin", "Profesor"]
  },
  notas_actividades: {
    label: "Notas por actividad",
    table: "notas_actividades",
    fields: [
      field("actividad_id", "Actividad", "reference", { required: true, reference: "actividades" }),
      field("matricula_id", "Matrícula", "reference", { required: true, reference: "matriculas" }),
      field("nota", "Nota (0 a 100)", "number", { required: true, min: 0, max: 100, step: 0.01 })
    ],
    display: ["actividad_id", "matricula_id", "nota"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Admin", "Profesor"]
  },
  observaciones: {
    label: "Observador de aula",
    table: "observaciones",
    fields: [
      field("institucion_id", "Institución", "reference", { required: true, reference: "instituciones", readOnly: true }),
      field("estudiante_id", "Estudiante", "reference", { required: true, reference: "usuarios" }),
      field("profesor_id", "Profesor", "reference", { required: true, reference: "usuarios", readOnly: true }),
      field("curso_id", "Curso", "reference", { required: true, reference: "cursos" }),
      field("descripcion", "Observación", "text", { required: true, maxLength: 4000 })
    ],
    display: ["estudiante_id", "profesor_id", "curso_id", "descripcion"],
    readRoles: ["Admin", "Profesor", "Estudiante", "Acudiente"],
    writeRoles: ["Profesor"]
  },
  excusas: {
    label: "Excusas",
    table: "excusas",
    fields: [
      field("asistencia_id", "Asistencia", "reference", { required: true, reference: "asistencia" }),
      field("acudiente_id", "Acudiente", "reference", { reference: "usuarios", readOnly: true }),
      field("motivo", "Motivo", "text", { required: true, maxLength: 2000 }),
      field("estado", "Estado", "select", {
        required: false,
        options: ["Pendiente", "Aprobada", "Rechazada"]
      })
    ],
    display: ["asistencia_id", "acudiente_id", "motivo", "estado"],
    readRoles: ["Admin", "Acudiente"],
    writeRoles: ["Admin", "Acudiente"]
  },
  audit_log: {
    label: "Registro de auditoría",
    table: "audit_log",
    fields: [
      field("institucion_id", "Institución", "reference", { reference: "instituciones" }),
      field("usuario_id", "Usuario", "reference", { reference: "usuarios" }),
      field("accion", "Acción", "text"),
      field("entidad", "Entidad", "text"),
      field("entidad_id", "Registro", "text"),
      field("cambios", "Cambios", "text"),
      field("creado_en", "Fecha", "text")
    ],
    display: ["accion", "entidad", "entidad_id", "cambios", "creado_en"],
    readRoles: ["SuperAdmin"],
    writeRoles: []
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
      .map((item) => key === "usuarios" && item.key === "rol"
        ? {
          ...item,
          options: role === "SuperAdmin"
            ? item.options.filter((option) => option === "Admin")
            : item.options.filter((option) => ["Profesor", "Estudiante"].includes(option))
        }
        : key === "instituciones" && role === "Admin" && ["nit_codigo", "plan_suscripcion"].includes(item.key)
          ? { ...item, readOnly: true }
        : item),
    display: entity.display,
    canWrite: entity.writeRoles.includes(role),
    canCreate: (entity.writeRoles.includes(role) && !(key === "instituciones" && role === "Admin"))
      || (key === "usuarios" && role === "SuperAdmin"),
    canManageActivation: key === "usuarios" && ["Admin", "SuperAdmin"].includes(role)
  }));

module.exports = { entities, getEntity, publicEntities };
