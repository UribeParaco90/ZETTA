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

  const renderCertificate = async ({ student, grades }, period) => {
    const requirements = await Promise.all(grades.map((grade) => api(
      `/api/academico/nota-requerida?matriculaId=${encodeURIComponent(grade.matricula_id)}&asignaturaId=${encodeURIComponent(grade.asignatura_id)}`
    )));
    const gradeValues = grades.map((item) => Number(item.nota));
    const average = gradeValues.reduce((sum, grade) => sum + grade, 0) / gradeValues.length;
    const scaleLabel = `${formatGrade(Number(student.escala_min))} – ${formatGrade(Number(student.escala_max))}`;
    document.querySelector("#institutionName").textContent = student.institucion;
    document.querySelector("#certificatePeriod").textContent =
      `Periodo ${period} · Año lectivo ${student.periodo_lectivo}`;
    document.querySelector("#certificateStudent").textContent = `${student.nombre} ${student.apellido}`;
    document.querySelector("#certificateDocument").textContent = student.documento;
    document.querySelector("#certificateCourse").textContent = student.curso;
    document.querySelector("#certificateYear").textContent = String(student.periodo_lectivo);
    document.querySelector("#overallAverage").textContent = formatGrade(average);
    document.querySelector("#overallAverage").nextElementSibling.nextElementSibling.textContent = scaleLabel;
    document.querySelector("#certificateFolio").textContent = `VISTA-${Date.now().toString(36).toUpperCase()}`;
    document.querySelector("#gradeMethod").textContent =
      "Promedio por asignatura ponderado por el porcentaje registrado en Neon.";

    const body = document.querySelector("#gradesBody");
    body.replaceChildren();
    grades.forEach((grade, index) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = grade.asignatura;
      const value = document.createElement("td");
      value.textContent = formatGrade(Number(grade.nota));
      const required = document.createElement("td");
      const progress = requirements[index];
      required.textContent = progress.mathematicallyLost
        ? "No es matemáticamente posible"
        : progress.remainingWeight === 0
          ? progress.passed ? "Aprobado" : "No aprobado"
          : formatGrade(progress.required);
      const scale = document.createElement("td");
      scale.textContent = scaleLabel;
      row.append(name, value, required, scale);
      body.append(row);
    });
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const load = async () => {
    const [session, students, configuration] = await Promise.all([
      api("/api/auth/me"),
      api("/api/academico/estudiantes"),
      api("/api/configuracion-institucional")
    ]);
    userName.textContent = session.name;
    const periodCount = Number(configuration.settings.num_periodos) || 4;
    periodSelect.replaceChildren();
    for (let number = 1; number <= periodCount; number += 1) {
      periodSelect.add(new Option(`Periodo ${number}`, String(number)));
    }
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
      await renderCertificate(data, period);
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
