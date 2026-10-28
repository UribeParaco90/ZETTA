(() => {
  const form = document.querySelector("#loginForm");
  const roleInput = document.querySelector("#role");
  const roleDescription = document.querySelector("#roleDescription");
  const roleScope = document.querySelector("#roleScope");
  const rolePermissions = document.querySelector("#rolePermissions");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const feedback = document.querySelector("#loginFeedback");
  const togglePassword = document.querySelector("#togglePassword");

  if (!form || !roleInput || !roleDescription || !roleScope || !rolePermissions
    || !emailInput || !passwordInput || !feedback || !togglePassword || !window.ZettaRoles) {
    console.error("Faltan elementos requeridos para inicializar el formulario de acceso.");
    return;
  }

  const showRolePermissions = () => {
    const role = window.ZettaRoles.find((item) => item.id === roleInput.value);
    roleDescription.textContent = role?.description ?? "Selecciona tu perfil.";
    rolePermissions.replaceChildren();
    (role?.permissions ?? []).filter((permission) => permission.available).forEach((permission) => {
      const item = document.createElement("li");
      item.textContent = permission.label;
      rolePermissions.append(item);
    });
    roleScope.hidden = !role;
  };

  roleInput.addEventListener("change", showRolePermissions);
  togglePassword.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    togglePassword.textContent = show ? "Ocultar" : "Mostrar";
    togglePassword.setAttribute("aria-pressed", String(show));
    passwordInput.focus();
  });

  form.addEventListener("input", () => {
    feedback.textContent = "";
    feedback.classList.remove("success");
    passwordInput.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    feedback.textContent = "Verificando cuenta…";
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
          role: roleInput.value
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No fue posible iniciar sesión.");
      feedback.textContent = `Sesión iniciada para ${result.name}.`;
      feedback.classList.add("success");
      window.location.assign("/dashboard.html");
    } catch (error) {
      feedback.textContent = error instanceof Error
        ? `No se pudo iniciar sesión: ${error.message}`
        : "No se pudo iniciar sesión. Inténtalo nuevamente.";
      passwordInput.setAttribute("aria-invalid", "true");
      passwordInput.focus();
    } finally {
      submitButton.disabled = false;
    }
  });
})();
