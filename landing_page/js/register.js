(() => {
  const form = document.querySelector("#registerForm");
  const institutionInput = document.querySelector("#institutionId");
  const feedback = document.querySelector("#registerFeedback");
  if (!form || !institutionInput || !feedback) {
    console.error("Faltan elementos requeridos para inicializar el registro.");
    return;
  }

  const submitButton = form.querySelector('[type="submit"]');
  const loadInstitutions = async () => {
    try {
      const response = await fetch("/api/public/institutions");
      const institutions = await response.json();
      if (!response.ok) throw new Error(institutions.error || "No se pudieron consultar las instituciones.");
      institutionInput.replaceChildren(new Option("Selecciona una institución", ""));
      institutions.forEach((institution) => {
        institutionInput.add(new Option(institution.name, institution.id));
      });
      submitButton.disabled = institutions.length === 0;
      if (!institutions.length) {
        institutionInput.replaceChildren(new Option("No hay instituciones disponibles", ""));
        feedback.textContent = "La institución debe crear y configurar su colegio antes de habilitar el registro.";
      }
    } catch (error) {
      institutionInput.replaceChildren(new Option("No se pudo cargar la lista", ""));
      feedback.textContent = error instanceof Error
        ? `No se pudo cargar el registro: ${error.message}`
        : "No se pudo consultar Neon.";
    }
  };

  form.addEventListener("input", () => {
    feedback.textContent = "";
    form.querySelectorAll("[aria-invalid=true]").forEach((item) => item.removeAttribute("aria-invalid"));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.password !== values.confirmPassword) {
      feedback.textContent = "Las contraseñas no coinciden.";
      form.elements.confirmPassword.setAttribute("aria-invalid", "true");
      form.elements.confirmPassword.focus();
      return;
    }
    submitButton.disabled = true;
    feedback.textContent = "Creando cuenta…";
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionId: values.institutionId,
          documento: values.documento,
          nombre: values.nombre,
          apellido: values.apellido,
          email: values.email,
          password: values.password
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No fue posible crear la cuenta.");
      feedback.textContent = `Cuenta de acudiente creada para ${result.name}. Entrando…`;
      feedback.classList.add("success");
      window.location.assign("/dashboard.html");
    } catch (error) {
      feedback.textContent = error instanceof Error
        ? `No se pudo crear la cuenta: ${error.message}`
        : "No se pudo crear la cuenta. Inténtalo nuevamente.";
      submitButton.disabled = false;
    }
  });

  loadInstitutions();
})();
