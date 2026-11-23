(() => {
  const roleMenus = {
    SuperAdmin: [
      { label: "Colegios", path: "/admin.html?entity=instituciones" },
      { label: "Métricas", path: "/admin.html?view=metrics" },
      { label: "Auditoría", path: "/admin.html?entity=audit_log" }
    ],
    Admin: [
      { label: "Usuarios y matrículas", path: "/admin.html?entity=matriculas" },
      { label: "Cursos y materias", path: "/admin.html?entity=cursos" },
      { label: "Notas", path: "/planilla.html" },
      { label: "Asistencia", path: "/modules/asistencias/asistencia.html" },
      { label: "Cierre y ajustes", path: "/admin.html?view=settings" }
    ],
    Profesor: [
      { label: "Mis materias", path: "/admin.html?entity=asignaturas" },
      { label: "Mis cursos", path: "/admin.html?entity=cursos" },
      { label: "Mis grupos", path: "/admin.html?entity=matriculas" },
      { label: "Notas", path: "/planilla.html" },
      { label: "Asistencia", path: "/modules/asistencias/asistencia.html" },
      { label: "Observador", path: "/admin.html?entity=observaciones" }
    ],
    Estudiante: [
      { label: "Perfil", path: "/perfil.html" },
      { label: "Mis notas", path: "/modules/certificaciones/certificado-calificaciones.html" },
      { label: "Mi asistencia", path: "/modules/estudiante/seguimiento.html?tipo=asistencia" },
      { label: "Mi observador", path: "/modules/estudiante/seguimiento.html?tipo=observaciones" }
    ],
    Acudiente: [
      { label: "Perfil", path: "/perfil.html" },
      { label: "Mis acudidos", path: "/admin.html?entity=matriculas" },
      { label: "Notas", path: "/modules/certificaciones/certificado-calificaciones.html" },
      { label: "Asistencia y excusas", path: "/admin.html?entity=excusas" },
      { label: "Observador", path: "/admin.html?entity=observaciones" }
    ]
  };

  const roleLabels = {
    SuperAdmin: "Superadministrador",
    Admin: "Administrador",
    Profesor: "Profesor",
    Estudiante: "Estudiante",
    Acudiente: "Acudiente"
  };

  const isActive = (link) => {
    const target = new URL(link.path, window.location.origin);
    if (window.location.pathname !== target.pathname) return false;
    const targetEntity = target.searchParams.get("entity");
    const targetView = target.searchParams.get("view");
    const targetType = target.searchParams.get("tipo");
    if (targetEntity) return new URLSearchParams(window.location.search).get("entity") === targetEntity;
    if (targetView) return new URLSearchParams(window.location.search).get("view") === targetView;
    if (targetType) return new URLSearchParams(window.location.search).get("tipo") === targetType;
    return true;
  };

  const removeExistingTopbars = () => {
    document.querySelectorAll(
      ".island, .dashboard-topbar, .admin-topbar, .grade-sheet-topbar, .login-topbar"
    ).forEach((element) => {
      element.hidden = true;
      element.style.display = "none";
    });
  };

  const initialize = async () => {
    const response = await fetch("/api/auth/me");
    const user = await response.json();
    if (!response.ok) return;

    removeExistingTopbars();

    const nav = document.createElement("nav");
    nav.className = "zetta-role-nav";
    nav.setAttribute("aria-label", "Navegación principal");

    const brand = document.createElement("a");
    brand.className = "navbar-brand fw-bold grad zetta-role-brand";
    brand.href = "/dashboard.html";
    brand.textContent = "ZETTA";

    const links = document.createElement("div");
    links.className = "zetta-role-links";

    const menu = [{ label: "Inicio", path: "/dashboard.html" }, ...(roleMenus[user.role] || [])];
    menu.forEach((item) => {
      const link = document.createElement("a");
      link.className = "zetta-role-link";
      link.href = item.path;
      link.textContent = item.label;
      if (isActive(item)) {
        link.className += " is-active";
        link.setAttribute("aria-current", "page");
      }
      links.append(link);
    });

    const actions = document.createElement("div");
    actions.className = "zetta-role-actions";

    const userChip = document.createElement("span");
    userChip.className = "zetta-role-user";
    userChip.innerHTML = '<span class="zetta-role-avatar" aria-hidden="true"></span>';
    const userName = document.createElement("span");
    userName.textContent = user.name;
    const roleName = document.createElement("small");
    roleName.textContent = roleLabels[user.role] || user.role;
    roleName.className = "zetta-role-label";
    userChip.append(userName, roleName);

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "btn btn-ghost btn-sm zetta-role-logout";
    logout.textContent = "Salir";
    logout.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } finally {
        window.location.assign("/login.html");
      }
    });

    actions.append(userChip, logout);
    nav.append(brand, links, actions);
    document.body.insertBefore(nav, document.body.firstChild);
  };

  initialize().catch(() => {});
})();
