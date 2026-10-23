(() => {
  const $ = (selector) => document.querySelector(selector);
  const subjectSelect = $("#subjectSelect");
  const periodSelect = $("#periodSelect");
  const loadButton = $("#loadSheet");
  const feedback = $("#sheetFeedback");
  const head = $("#gradeSheetHead");
  const body = $("#gradeSheetBody");
  const empty = $("#sheetEmpty");
  const saveButton = $("#saveGrades");
  const state = { user: null, sheet: null };

  const api = async (url, options) => {
    const response = await fetch(url, options);
    let payload;
    try {
      payload = response.status === 204 ? null : await response.json();
    } catch {
      throw new Error("El servidor devolvió una respuesta inválida.");
    }
    if (!response.ok) throw new Error(payload?.error || "No fue posible completar la solicitud.");
    return payload;
  };

  const report = (message, success = false) => {
    feedback.textContent = message;
    feedback.classList.toggle("is-success", success);
  };

  const renderSheet = (sheet) => {
    state.sheet = sheet;
    head.replaceChildren();
    body.replaceChildren();
    $("#sheetTitle").textContent = `${sheet.subject.name} · ${sheet.subject.course}`;
    $("#sheetDetails").textContent = `Periodo ${sheet.period} · ${sheet.activities.length} actividades · ${sheet.students.length} estudiantes`;
    $("#sheetStatus").textContent = sheet.closed ? "Periodo cerrado" : "";
    $("#sheetStatus").classList.toggle("is-warning", sheet.closed);

    const weighted = sheet.activities.length > 0 && Math.abs(sheet.activityWeightTotal - 100) <= 0.001;
    if (!sheet.periodConfigured && !sheet.closed) {
      $("#sheetStatus").textContent = "Configura los pesos de los periodos";
      $("#sheetStatus").classList.add("is-warning");
    } else if (!sheet.activities.length) {
      $("#sheetStatus").textContent = "No hay actividades";
      $("#sheetStatus").classList.add("is-warning");
    } else if (!weighted && !sheet.closed) {
      $("#sheetStatus").textContent = `Peso de actividades: ${sheet.activityWeightTotal.toFixed(2)} %`;
      $("#sheetStatus").classList.add("is-warning");
    }

    const header = document.createElement("tr");
    const studentHeading = document.createElement("th");
    studentHeading.scope = "col";
    studentHeading.textContent = "Estudiante";
    header.append(studentHeading);
    sheet.activities.forEach((activity) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = `${activity.nombre} · ${Number(activity.peso_porcentaje)} %`;
      header.append(cell);
    });
    head.append(header);

    const grades = new Map(sheet.grades.map((grade) => [
      `${grade.matricula_id}:${grade.actividad_id}`,
      grade.nota
    ]));
    sheet.students.forEach((student) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = `${student.apellido}, ${student.nombre}${student.documento ? ` · ${student.documento}` : ""}`;
      row.append(name);
      sheet.activities.forEach((activity) => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.className = "form-control form-control-sm grade-input";
        input.type = "number";
        input.min = "0";
        input.max = "100";
        input.step = "0.01";
        input.inputMode = "decimal";
        input.setAttribute("aria-label", `Nota de ${student.nombre} ${student.apellido} en ${activity.nombre}`);
        input.dataset.matriculaId = student.matricula_id;
        input.dataset.actividadId = activity.id;
        const existingGrade = grades.get(`${student.matricula_id}:${activity.id}`);
        input.value = existingGrade === undefined ? "" : String(existingGrade);
        input.disabled = sheet.closed || !sheet.periodConfigured || !weighted;
        input.addEventListener("input", updateSaveState);
        cell.append(input);
        row.append(cell);
      });
      body.append(row);
    });

    empty.hidden = sheet.students.length > 0 && sheet.activities.length > 0;
    if (!sheet.students.length || !sheet.activities.length) {
      empty.textContent = !sheet.activities.length
        ? "Crea actividades para esta asignatura y periodo antes de ingresar notas."
        : "No hay estudiantes matriculados en este curso.";
    }
    updateSaveState();
  };

  const updateSaveState = () => {
    const inputs = [...document.querySelectorAll(".grade-input")];
    const hasValues = inputs.some((input) => input.value.trim() !== "");
    saveButton.disabled = !state.sheet || state.sheet.closed || !state.sheet.periodConfigured || !hasValues
      || inputs.some((input) => input.value !== "" && !input.checkValidity());
  };

  const loadSheet = async () => {
    const asignaturaId = subjectSelect.value;
    const periodo = periodSelect.value;
    if (!asignaturaId || !periodo) {
      report("Selecciona una asignatura y un periodo.");
      return;
    }
    saveButton.disabled = true;
    report("Cargando planilla…");
    try {
      const query = new URLSearchParams({ asignaturaId, periodo });
      const sheet = await api(`/api/academico/planilla?${query}`);
      renderSheet(sheet);
      report("Planilla cargada.", true);
      return true;
    } catch (error) {
      state.sheet = null;
      head.replaceChildren();
      body.replaceChildren();
      empty.hidden = false;
      empty.textContent = "No fue posible cargar esta planilla.";
      $("#sheetTitle").textContent = "Planilla no disponible";
      $("#sheetStatus").textContent = "";
      report(error.message);
      return false;
    }
  };

  const invalidateSheet = () => {
    state.sheet = null;
    head.replaceChildren();
    body.replaceChildren();
    empty.hidden = false;
    empty.textContent = "Carga una asignatura para ver sus estudiantes y actividades.";
    $("#sheetTitle").textContent = "Selecciona una asignatura";
    $("#sheetDetails").textContent = "Las actividades deben sumar el 100 % para habilitar el registro.";
    $("#sheetStatus").textContent = "";
    saveButton.disabled = true;
  };

  subjectSelect.addEventListener("change", invalidateSheet);
  periodSelect.addEventListener("change", invalidateSheet);
  loadButton.addEventListener("click", loadSheet);
  saveButton.addEventListener("click", async () => {
    if (!state.sheet) return;
    const records = [...document.querySelectorAll(".grade-input")]
      .filter((input) => input.value.trim() !== "")
      .map((input) => ({
        matriculaId: input.dataset.matriculaId,
        actividadId: input.dataset.actividadId,
        nota: Number(input.value)
      }));
    if (!records.length) return;
    saveButton.disabled = true;
    loadButton.disabled = true;
    subjectSelect.disabled = true;
    periodSelect.disabled = true;
    report("Guardando calificaciones…");
    try {
      const result = await api("/api/academico/planilla", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asignaturaId: subjectSelect.value,
          periodo: Number(periodSelect.value),
          records
        })
      });
      if (await loadSheet()) {
        report(`${result.saved} calificaciones guardadas correctamente.`, true);
      }
    } catch (error) {
      report(error.message);
      updateSaveState();
    } finally {
      loadButton.disabled = false;
      subjectSelect.disabled = false;
      periodSelect.disabled = false;
    }
  });

  $("#logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      window.location.assign("/login.html");
    } catch (error) {
      report(error.message);
    }
  });

  const initialize = async () => {
    try {
      const [user, subjects, configuration] = await Promise.all([
        api("/api/auth/me"),
        api("/api/academico/asignaturas-planilla"),
        api("/api/configuracion-institucional")
      ]);
      state.user = user;
      $("#currentUser").textContent = `${user.name} · ${user.role}`;
      subjectSelect.replaceChildren(new Option("Selecciona una asignatura", ""));
      subjects.forEach((subject) => {
        const option = new Option(
          `${subject.nombre} · ${subject.curso} (${subject.periodo_lectivo})`,
          subject.id
        );
        subjectSelect.add(option);
      });
      if (!subjects.length) {
        subjectSelect.replaceChildren(new Option("No tienes asignaturas disponibles", ""));
      }
      periodSelect.replaceChildren();
      const periodCount = Number(configuration.settings.num_periodos) || 4;
      for (let period = 1; period <= periodCount; period += 1) {
        periodSelect.add(new Option(`Periodo ${period}`, String(period)));
      }
      if (!subjects.length) report("No hay asignaturas disponibles para tu perfil.");
    } catch (error) {
      report(error.message);
      $("#currentUser").textContent = "Sesión no disponible";
    }
  };

  initialize();
})();
