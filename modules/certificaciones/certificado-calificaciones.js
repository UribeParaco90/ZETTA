(() => {
  const form = document.querySelector("#certificateForm");
  const studentSelect = document.querySelector("#studentSelect");
  const periodSelect = document.querySelector("#periodSelect");
  const feedback = document.querySelector("#certificateFeedback");
  const result = document.querySelector("#certificateResult");
  const printButton = document.querySelector("#printButton");
  const logoutButton = document.querySelector("#logoutButton");
  const userName = document.querySelector("#userName");

  const api = async (url, options) => {
    const response = await fetch(url, options);
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(body?.error || "No se pudo completar la solicitud.");
    return body;
  };

  const formatGrade = (value) => new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

  const renderCertificate = ({ student, grades }, period) => {
    const gradeValues = grades.map((item) => Number(item.nota));
    const average = gradeValues.reduce((sum, grade) => sum + grade, 0) / gradeValues.length;
    document.querySelector("#institutionName").textContent = student.institucion;
    document.querySelector("#certificatePeriod").textContent =
      `Periodo ${period} · Año lectivo ${student.periodo_lectivo}`;
    document.querySelector("#certificateStudent").textContent = `${student.nombre} ${student.apellido}`;
    document.querySelector("#certificateDocument").textContent = student.documento;
    document.querySelector("#certificateCourse").textContent = student.curso;
    document.querySelector("#certificateYear").textContent = String(student.periodo_lectivo);
    document.querySelector("#overallAverage").textContent = formatGrade(average);
    document.querySelector("#certificateFolio").textContent = `VISTA-${Date.now().toString(36).toUpperCase()}`;
    document.querySelector("#gradeMethod").textContent =
      "Promedio por asignatura ponderado por el porcentaje registrado en Neon.";

    const body = document.querySelector("#gradesBody");
    body.replaceChildren();
    grades.forEach((grade) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = grade.asignatura;
      const value = document.createElement("td");
      value.textContent = formatGrade(Number(grade.nota));
      const scale = document.createElement("td");
      scale.textContent = "0,00 – 5,00";
      row.append(name, value, scale);
      body.append(row);
    });
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const load = async () => {
    const [session, students] = await Promise.all([
      api("/api/auth/me"),
      api("/api/academico/estudiantes")
    ]);
    userName.textContent = session.name;
    students.forEach((student) => {
      const option = new Option(
        `${student.nombre} ${student.apellido}${student.curso ? ` · ${student.curso}` : ""}`,
        student.id
      );
      studentSelect.add(option);
    });
    if (!students.length) {
      feedback.textContent = "No hay estudiantes vinculados a esta cuenta en Neon.";
      form.querySelector('[type="submit"]').disabled = true;
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    feedback.textContent = "Consultando calificaciones…";
    result.hidden = true;
    try {
      const period = periodSelect.value;
      const data = await api(`/api/academico/calificaciones/${encodeURIComponent(studentSelect.value)}?periodo=${encodeURIComponent(period)}`);
      renderCertificate(data, period);
      feedback.textContent = "";
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  studentSelect.addEventListener("change", () => {
    result.hidden = true;
    feedback.textContent = "";
  });
  periodSelect.addEventListener("change", () => {
    result.hidden = true;
    feedback.textContent = "";
  });
  printButton.addEventListener("click", () => window.print());
  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("../../landing_page/login.html");
    }
  });

  load().catch((error) => {
    console.error("No fue posible cargar las calificaciones.", error);
    feedback.textContent = error.message;
  });
})();
