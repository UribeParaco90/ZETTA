(() => {
  const form = document.querySelector("#registerForm");
  const nameInput = document.querySelector("#name");
  const roleInput = document.querySelector("#role");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const confirmPasswordInput = document.querySelector("#confirmPassword");
  const feedback = document.querySelector("#registerFeedback");
  const roleScope = document.querySelector("#selectedRoleScope");
  const roleDescription = document.querySelector("#roleDescription");
  const rolePermissions = document.querySelector("#rolePermissions");
  const roleCatalog = document.querySelector("#roleCatalog");

  if (!form || !nameInput || !roleInput || !emailInput || !passwordInput
    || !confirmPasswordInput || !feedback || !roleScope || !roleDescription
    || !rolePermissions || !roleCatalog || !window.ZettaDemoAccounts) {
    console.error("Faltan elementos requeridos para inicializar el registro de demostración.");
    return;
  }

  const renderPermissions = (list, permissions) => {
    list.replaceChildren();
    permissions.forEach((permission) => {
      const item = document.createElement("li");
      item.textContent = permission;
      list.append(item);
    });
  };

  window.ZettaDemoAccounts.roles.forEach((role) => {
    const card = document.createElement("article");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const permissions = document.createElement("ul");

    card.className = "role-catalog-card";
    title.className = "h6 fw-bold";
    title.textContent = role.label;
    description.className = "text-muted small";
    description.textContent = role.description;
    permissions.className = "role-permissions";
    renderPermissions(permissions, role.permissions);
    card.append(title, description, permissions);
    roleCatalog.append(card);
  });

  roleInput.addEventListener("change", () => {
    const role = window.ZettaDemoAccounts.roles.find((item) => item.id === roleInput.value);
    roleDescription.textContent = role?.description ?? "";
    renderPermissions(rolePermissions, role?.permissions ?? []);
    roleScope.hidden = !role;
    feedback.textContent = "";
    feedback.classList.remove("success");
  });

  form.addEventListener("input", () => {
    feedback.textContent = "";
    feedback.classList.remove("success");
    passwordInput.removeAttribute("aria-invalid");
    confirmPasswordInput.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }

    if (passwordInput.value !== confirmPasswordInput.value) {
      feedback.textContent = "Las contraseñas no coinciden.";
      confirmPasswordInput.setAttribute("aria-invalid", "true");
      confirmPasswordInput.focus();
      return;
    }

    try {
      const account = await window.ZettaDemoAccounts.register({
        name: nameInput.value,
        email: emailInput.value,
        role: roleInput.value,
        password: passwordInput.value
      });
      feedback.textContent = `Cuenta local creada para ${account.name} (${account.email}). Ahora puedes iniciar sesión con este correo y contraseña.`;
      feedback.classList.add("success");
      form.reset();
      roleScope.hidden = true;
      nameInput.focus();
    } catch (error) {
      feedback.textContent = error instanceof Error
        ? `No se pudo crear la cuenta: ${error.message}`
        : "No se pudo crear la cuenta. Inténtalo de nuevo.";
    }
  });
})();
