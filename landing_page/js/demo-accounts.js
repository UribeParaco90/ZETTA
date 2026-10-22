(() => {
  const roles = [
    {
      id: "SuperAdmin",
      label: "Superadministrador",
      description: "Administra instituciones y funciones globales de la plataforma.",
      permissions: [
        { label: "Colegios", entity: "instituciones", path: "/admin.html?entity=instituciones", available: true },
        { label: "Métricas SaaS", available: false },
        { label: "Facturación", available: false },
        { label: "Audit Logs", available: false }
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
        { label: "Cierre y Boletines", available: false },
        { label: "Excusas Globales", path: "/modules/asistencias/asistencia.html", available: true },
        { label: "Ajustes Institucionales", available: false }
      ]
    },
    {
      id: "Profesor",
      label: "Profesor",
      description: "Trabaja con los cursos y estudiantes que tiene asignados.",
      permissions: [
        { label: "Mis Cursos", available: false },
        { label: "Planilla de Notas", available: false },
        { label: "Toma de Asistencia", path: "/modules/asistencias/asistencia.html", available: true },
        { label: "Observador de Aula", available: false },
        { label: "Mi Horario", available: false }
      ]
    },
    {
      id: "Estudiante",
      label: "Estudiante",
      description: "Consulta sus calificaciones y datos académicos.",
      permissions: [
        { label: "Inicio", path: "/dashboard.html", available: true },
        { label: "Mis Notas", path: "/modules/certificaciones/certificado-calificaciones.html", available: true },
        { label: "Mi Asistencia", available: false },
        { label: "Mi Observador", available: false },
        { label: "Mis Boletines", available: false }
      ]
    },
    {
      id: "Acudiente",
      label: "Acudiente",
      description: "Consulta la información académica de estudiantes vinculados a su cuenta.",
      permissions: [
        { label: "Mis Acudidos", available: false },
        { label: "Notas y Avance", path: "/modules/certificaciones/certificado-calificaciones.html", available: true },
        { label: "Asistencia y Excusas", available: false },
        { label: "Observador", available: false },
        { label: "Documentos", available: false }
      ]
    }
  ];

  window.ZettaRoles = Object.freeze(roles);
})();
