(() => {
  const SESSION_KEY = "zetta-demo-session";
  const form = document.querySelector("#loginForm");
  const roleInput = document.querySelector("#role");
  const roleDescription = document.querySelector("#roleDescription");
  const roleScope = document.querySelector("#roleScope");
  const rolePermissions = document.querySelector("#rolePermissions");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const feedback = document.querySelector("#loginFeedback");
  const togglePassword = document.querySelector("#togglePassword");
  const continueToCertificates = document.querySelector("#continueToCertificates");
  const demoAccounts = document.querySelector(".demo-account-list");

  if (!form || !roleInput || !roleDescription || !roleScope || !rolePermissions
    || !emailInput || !passwordInput || !feedback || !togglePassword || !continueToCertificates || !demoAccounts
    || !window.ZettaDemoAccounts) {
    console.error("Faltan elementos requeridos para inicializar el formulario de acceso.");
    return;
  }

  const showRolePermissions = () => {
    const role = window.ZettaDemoAccounts.roles.find((item) => item.id === roleInput.value);
    roleDescription.textContent = role?.description
      ?? "El perfil describe el alcance previsto para esta demostración.";
    rolePermissions.replaceChildren();
    (role?.permissions ?? []).forEach((permission) => {
      const item = document.createElement("li");
      item.textContent = permission;
      rolePermissions.append(item);
    });
    roleScope.hidden = !role;
  };

  roleInput.addEventListener("change", () => {
    showRolePermissions();
    feedback.textContent = "";
    feedback.classList.remove("success");
    passwordInput.removeAttribute("aria-invalid");
    continueToCertificates.hidden = true;
  });

  togglePassword.addEventListener("click", () => {
    const showingPassword = passwordInput.type === "password";
    passwordInput.type = showingPassword ? "text" : "password";
    togglePassword.textContent = showingPassword ? "Ocultar" : "Mostrar";
    togglePassword.setAttribute("aria-pressed", String(showingPassword));
    passwordInput.focus();
  });

  demoAccounts.addEventListener("click", (event) => {
    const button = event.target.closest(".demo-account-use");
    if (!button) {
      return;
    }

    roleInput.value = button.dataset.demoRole;
    emailInput.value = button.dataset.demoEmail;
    passwordInput.value = button.dataset.demoPassword;
    passwordInput.type = "password";
    togglePassword.textContent = "Mostrar";
    togglePassword.setAttribute("aria-pressed", "false");
    showRolePermissions();
    feedback.textContent = "Datos de la cuenta de prueba cargados. Pulsa «Ingresar» para continuar.";
    feedback.classList.remove("success");
    passwordInput.removeAttribute("aria-invalid");
    continueToCertificates.hidden = true;
    passwordInput.focus();
  });

  form.addEventListener("input", () => {
    feedback.textContent = "";
    feedback.classList.remove("success");
    passwordInput.removeAttribute("aria-invalid");
    continueToCertificates.hidden = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }

    try {
      const account = await window.ZettaDemoAccounts.authenticate({
        email: emailInput.value,
        password: passwordInput.value,
        role: roleInput.value
      });

      if (!account) {
        feedback.textContent = "El perfil, el correo o la contraseña no coinciden con una cuenta de demostración.";
        passwordInput.setAttribute("aria-invalid", "true");
        passwordInput.focus();
        return;
      }

      localStorage.setItem(SESSION_KEY, JSON.stringify({
        email: account.email,
        name: account.name,
        role: account.role
      }));
      showRolePermissions();
      passwordInput.removeAttribute("aria-invalid");
      feedback.textContent = `Acceso local de demostración iniciado para ${account.name}. Los permisos indicados son informativos y no equivalen a controles de seguridad.`;
      feedback.classList.add("success");
      continueToCertificates.hidden = false;
    } catch (error) {
      feedback.textContent = error instanceof Error
        ? `No se pudo iniciar la sesión local: ${error.message}`
        : "No se pudo iniciar la sesión local. Inténtalo de nuevo.";
      passwordInput.setAttribute("aria-invalid", "true");
      continueToCertificates.hidden = true;
    }
  });
})();
