(() => {
  const api = async (url, options) => {
    const response = await fetch(url, options);
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(body?.error || "No fue posible completar la solicitud.");
    return body;
  };

  const studentForm = document.querySelector("#studentProfile");
  const guardianForm = document.querySelector("#guardianLink");
  const studentFeedback = document.querySelector("#studentFeedback");
  const guardianFeedback = document.querySelector("#guardianFeedback");

  const initialize = async () => {
    const [user, profile] = await Promise.all([api("/api/auth/me"), api("/api/perfil")]);
    document.querySelector("#profileName").textContent = user.name;
    if (user.role === "Estudiante") {
      studentForm.hidden = false;
      document.querySelector("#document").value = profile.documento || "";
      document.querySelector("#institutionEmail").value = profile.email || "";
      document.querySelector("#personalEmail").value = profile.email_personal || "";
    } else if (user.role === "Acudiente") {
      guardianForm.hidden = false;
    } else {
      window.location.replace("/dashboard.html");
    }
  };

  studentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!studentForm.reportValidity()) return;
    try {
      await api("/api/perfil/correo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.querySelector("#institutionEmail").value,
          email_personal: document.querySelector("#personalEmail").value
        })
      });
      studentFeedback.textContent = "Datos de correo actualizados.";
    } catch (error) {
      studentFeedback.textContent = error.message;
    }
  });

  document.querySelector("#newLinkCode").addEventListener("click", async () => {
    try {
      const result = await api("/api/perfil/codigo-vinculacion", { method: "POST" });
      document.querySelector("#linkCode").textContent =
        `Comparte este código de vinculación con tu acudiente: ${result.codigoVinculacion}`;
    } catch (error) {
      document.querySelector("#linkCode").textContent = error.message;
    }
  });

  guardianForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!guardianForm.reportValidity()) return;
    try {
      await api("/api/acudidos/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: document.querySelector("#linkCodeInput").value.trim() })
      });
      guardianFeedback.textContent = "Estudiante vinculado correctamente.";
      guardianForm.reset();
    } catch (error) {
      guardianFeedback.textContent = error.message;
    }
  });

  initialize().catch((error) => {
    console.error("No fue posible cargar el perfil.", error);
    document.querySelector("#profileName").textContent = error.message;
  });
})();
