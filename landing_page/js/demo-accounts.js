(() => {
  const roles = [
    {
      id: "SuperAdmin",
      label: "Superadministrador",
      description: "Administra instituciones y funciones globales de la plataforma.",
      permissions: [
        { label: "Colegios", entity: "instituciones", path: "/admin.html?entity=instituciones", available: true },
        { label: "Métricas SaaS y planes", path: "/admin.html?view=metrics", available: true },
        { label: "Facturación", path: "/admin.html?view=metrics", available: true },
        { label: "Audit Logs", entity: "audit_log", path: "/admin.html?entity=audit_log", available: true }
      ]
    },
    {
      id: "Admin",
      label: "Administrador",
      description: "Gestiona usuarios y datos académicos de su institución.",
      permissions: [
        { label: "Dashboard", path: "/dashboard.html", available: true },
        { label: "Matrículas y Usuarios", entity: "matriculas", path: "/admin.html?entity=matriculas", available: true },
        { label: "Cursos y Materias", entity: "cursos", path: "/admin.html?entity=cursos", available: true },
        { label: "Actividades y Notas", entity: "actividades", path: "/admin.html?entity=actividades", available: true },
        { label: "Planilla masiva de notas", path: "/planilla.html", available: true },
        { label: "Cierre y Boletines", path: "/admin.html?view=settings", available: true },
        { label: "Excusas Globales", entity: "excusas", path: "/admin.html?entity=excusas", available: true },
        { label: "Ajustes Institucionales", path: "/admin.html?view=settings", available: true }
      ]
    },
    {
      id: "Profesor",
      label: "Profesor",
      description: "Trabaja con los cursos y estudiantes que tiene asignados.",
      permissions: [
        { label: "Mis Cursos", entity: "asignaturas", path: "/admin.html?entity=asignaturas", available: true },
        { label: "Planilla de Notas", entity: "notas_actividades", path: "/planilla.html", available: true },
        { label: "Toma de Asistencia", path: "/modules/asistencias/asistencia.html", available: true },
        { label: "Observador de Aula", entity: "observaciones", path: "/admin.html?entity=observaciones", available: true },
        { label: "Mi Horario", entity: "horarios", path: "/admin.html?entity=horarios", available: true }
      ]
    },
    {
      id: "Estudiante",
      label: "Estudiante",
      description: "Consulta sus calificaciones y datos académicos.",
      permissions: [
        { label: "Inicio", path: "/dashboard.html", available: true },
        { label: "Perfil y correo", path: "/perfil.html", available: true },
        { label: "Mis Notas", path: "/modules/certificaciones/certificado-calificaciones.html", available: true },
        { label: "Nota necesaria para aprobar", path: "/modules/certificaciones/certificado-calificaciones.html", available: true },
        { label: "Mi Asistencia", entity: "asistencia", path: "/admin.html?entity=asistencia", available: true },
        { label: "Mi Observador", entity: "observaciones", path: "/admin.html?entity=observaciones", available: true },
        { label: "Mis Boletines", available: false }
      ]
    },
    {
      id: "Acudiente",
      label: "Acudiente",
      description: "Consulta la información académica de estudiantes vinculados a su cuenta.",
      permissions: [
        { label: "Perfil y vinculación", path: "/perfil.html", available: true },
        { label: "Mis Acudidos", entity: "matriculas", path: "/admin.html?entity=matriculas", available: true },
        { label: "Notas y Avance", path: "/modules/certificaciones/certificado-calificaciones.html", available: true },
        { label: "Asistencia y Excusas", entity: "excusas", path: "/admin.html?entity=excusas", available: true },
        { label: "Observador", entity: "observaciones", path: "/admin.html?entity=observaciones", available: true },
        { label: "Documentos", available: false }
      ]
    }
  ];

  window.ZettaRoles = Object.freeze(roles);
})();
