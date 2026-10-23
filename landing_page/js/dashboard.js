(() => {
  const load = async () => {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!response.ok) {
      window.location.replace("/login.html");
      return;
    }

    const role = window.ZettaRoles.find((item) => item.id === result.role);
    if (!role) {
      window.location.replace("/login.html");
      return;
    }
    document.querySelector("[data-session-name]").textContent = result.name;
    document.querySelector("#roleBadge").textContent = role.label;
    document.querySelector("#roleTitle").textContent = role.label;
    document.querySelector("#roleDescription").textContent = role.description;
    const navigation = document.querySelector("#roleNavigation");
    role.permissions.forEach((permission) => {
      const isCurrent = permission.path === "/dashboard.html";
      const element = permission.available && !isCurrent
        ? document.createElement("a")
        : document.createElement("article");
      element.className = `dashboard-card${permission.available ? "" : " is-upcoming"}${isCurrent ? " is-current" : ""}`;
      if (element instanceof HTMLAnchorElement) element.href = permission.path;
      const heading = document.createElement("h2");
      heading.textContent = permission.label;
      const status = document.createElement("span");
      status.textContent = !permission.available
        ? "Próximamente"
        : isCurrent ? "Estás aquí" : "Abrir módulo →";
      element.append(heading, status);
      navigation.append(element);
    });
  };

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login.html");
    }
  });
  load().catch((error) => {
    console.error("No fue posible cargar el panel de usuario.", error);
    window.location.replace("/login.html");
  });
})();
