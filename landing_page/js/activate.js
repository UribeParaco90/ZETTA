(() => {
  const form = document.querySelector("#activateForm");
  const feedback = document.querySelector("#activateFeedback");
  const button = document.querySelector("#activateButton");
  const token = new URLSearchParams(window.location.search).get("token");

  if (!token) {
    feedback.textContent = "Falta el enlace de activación. Solicita uno nuevo al administrador.";
    button.disabled = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const password = form.elements.password.value;
    if (password !== form.elements.confirmPassword.value) {
      feedback.textContent = "Las contraseñas no coinciden.";
      return;
    }
    button.disabled = true;
    feedback.textContent = "";
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No fue posible activar la cuenta.");
      window.location.assign("/dashboard.html");
    } catch (error) {
      feedback.textContent = error.message;
      button.disabled = false;
    }
  });
})();
