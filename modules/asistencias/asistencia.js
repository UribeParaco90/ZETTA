(() => {
  const courseSelect = document.querySelector("#filtroCurso");
  const subjectSelect = document.querySelector("#filtroAsignatura");
  const dateInput = document.querySelector("#filtroFecha");
  const registerBody = document.querySelector("#tbodyRegistro");
  const historyBody = document.querySelector("#tbodyHistorial");
  const alertsBody = document.querySelector("#tbodyAlertas");
  const rowTemplate = document.querySelector("#plantillaFila");
  const feedback = document.querySelector("#feedbackAsistencia");
  let user;
  let courses = [];
  let subjects = [];
  let records = [];

  const api = async (url, options) => {
    const response = await fetch(url, options);
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(body?.error || "No se pudo completar la operación.");
    return body;
  };

  const showFeedback = (message, success = false) => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("text-success", success);
  };

  const updateSubjects = () => {
    const courseId = courseSelect.value;
    subjectSelect.replaceChildren(new Option("Selecciona una asignatura", ""));
    subjectSelect.disabled = !courseId;
    subjects.filter((subject) => courseId && subject.curso_id === courseId).forEach((subject) => {
      const course = courses.find((item) => item.id === subject.curso_id);
      subjectSelect.add(new Option(`${subject.nombre}${course ? ` · ${course.nombre}` : ""}`, subject.id));
    });
  };

  const clearRoster = () => {
    registerBody.replaceChildren();
    records = [];
    document.querySelector("#attendanceSheetInfo").hidden = true;
    document.querySelector("#btnGuardar").disabled = true;
    updateStats();
  };

  const updateStats = () => {
    const totals = { Presente: 0, Ausente: 0, Excusado: 0, Retardo: 0 };
    registerBody.querySelectorAll("tr[data-matricula-id]").forEach((row) => {
      const selected = row.querySelector("input:checked");
      if (selected && Object.hasOwn(totals, selected.value)) totals[selected.value] += 1;
    });
    document.querySelector("#totPresente").textContent = totals.Presente;
    document.querySelector("#totAusente").textContent = totals.Ausente;
    document.querySelector("#totExcusado").textContent = totals.Excusado;
    document.querySelector("#totRetardo").textContent = totals.Retardo;
  };

  const markAllAs = (status) => {
    registerBody.querySelectorAll("tr[data-matricula-id]").forEach((row) => {
      const radio = [...row.querySelectorAll("input")].find((input) => input.value === status);
      if (radio) radio.checked = true;
    });
    updateStats();
  };

  const renderRoster = (items) => {
    registerBody.replaceChildren();
    records = items;
    items.forEach((record, index) => {
      const fragment = rowTemplate.content.cloneNode(true);
      const row = fragment.querySelector("tr");
      row.dataset.matriculaId = record.matricula_id;
      row.querySelector(".col-num").textContent = index + 1;
      row.querySelector(".student-name").textContent = `${record.nombre} ${record.apellido}`;
      row.querySelector(".student-doc").textContent = record.documento;
      row.querySelectorAll(".estado-group input").forEach((input) => {
        const status = input.value;
        const suffix = `${index}-${record.matricula_id}`;
        input.name = `estado-${suffix}`;
        input.id = `estado-${status.toLowerCase()}-${suffix}`;
        input.checked = record.estado === status;
        if (user.role === "Profesor" && ["Excusado", "Retardo"].includes(status)) {
          input.hidden = true;
          input.nextElementSibling.hidden = true;
        }
        input.addEventListener("change", updateStats);
        input.nextElementSibling.htmlFor = input.id;
      });
      registerBody.append(fragment);
    });
    updateStats();
    document.querySelector("#btnGuardar").disabled = items.length === 0;
  };

  const loadList = async () => {
    if (!courseSelect.value || !subjectSelect.value || !dateInput.value) {
      showFeedback("Selecciona grupo, asignatura y fecha para cargar la lista.");
      return;
    }
    try {
      const query = new URLSearchParams({
        cursoId: courseSelect.value,
        asignaturaId: subjectSelect.value,
        fecha: dateInput.value
      });
      const result = await api(`/api/academico/lista?${query}`);
      renderRoster(result.records);
      document.querySelector("#sheetCourse").textContent =
        courses.find((course) => course.id === courseSelect.value)?.nombre || "";
      document.querySelector("#sheetSubject").textContent =
        subjects.find((subject) => subject.id === subjectSelect.value)?.nombre || "";
      document.querySelector("#sheetDate").textContent =
        new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" })
          .format(new Date(`${dateInput.value}T00:00:00.000Z`));
      document.querySelector("#attendanceSheetInfo").hidden = false;
      showFeedback(`${result.records.length} estudiantes cargados.`, true);
    } catch (error) {
      showFeedback(error.message);
    }
  };

  const loadHistory = async () => {
    const query = new URLSearchParams();
    if (document.querySelector("#histDesde").value) query.set("desde", document.querySelector("#histDesde").value);
    if (document.querySelector("#histHasta").value) query.set("hasta", document.querySelector("#histHasta").value);
    if (document.querySelector("#histCurso").value) query.set("cursoId", document.querySelector("#histCurso").value);
    try {
      const result = await api(`/api/academico/asistencias?${query}`);
      const search = document.querySelector("#histEstudiante").value.trim().toLocaleLowerCase();
      const filtered = result.records.filter((record) => (
        `${record.estudiante_nombre} ${record.estudiante_apellido} ${record.documento}`.toLocaleLowerCase().includes(search)
      ));
      historyBody.replaceChildren();
      filtered.forEach((record) => {
        const row = document.createElement("tr");
        [
          new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CO"),
          `${record.estudiante_nombre} ${record.estudiante_apellido}`,
          record.asignatura,
          record.estado
        ].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        });
        historyBody.append(row);
      });
      if (!filtered.length) historyBody.innerHTML = '<tr><td colspan="4">No hay registros para estos filtros.</td></tr>';

      const alerts = result.records.filter((record) => record.estado === "Ausente");
      document.querySelector("#contadorAlertas").textContent = alerts.length;
      alertsBody.replaceChildren();
      alerts.forEach((record) => {
        const row = document.createElement("tr");
        [
          new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CO"),
          `${record.estudiante_nombre} ${record.estudiante_apellido}`,
          record.asignatura,
          record.acudiente_nombre ? `${record.acudiente_nombre} ${record.acudiente_apellido}` : "Sin acudiente vinculado"
        ].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        });
        const actionCell = document.createElement("td");
        const excuseButton = document.createElement("button");
        excuseButton.className = "btn btn-ghost btn-sm";
        excuseButton.type = "button";
        excuseButton.textContent = "Registrar excusa";
        excuseButton.addEventListener("click", async () => {
          try {
            await api("/api/academico/asistencia", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                cursoId: record.curso_id,
                asignaturaId: record.asignatura_id,
                fecha: record.fecha,
                records: [{ matriculaId: record.matricula_id, estado: "Excusado" }]
              })
            });
            showFeedback("Excusa registrada en Neon.", true);
            await loadHistory();
          } catch (error) {
            showFeedback(error.message);
          }
        });
        actionCell.append(excuseButton);
        row.append(actionCell);
        alertsBody.append(row);
      });
      if (!alerts.length) alertsBody.innerHTML = '<tr><td colspan="5">No hay inasistencias pendientes de revisión.</td></tr>';
    } catch (error) {
      showFeedback(error.message);
    }
  };

  document.querySelector("#btnMarcarTodos").addEventListener("click", () => markAllAs("Presente"));
  document.querySelector("#btnMarcarAusentes").addEventListener("click", () => markAllAs("Ausente"));

  document.querySelector("#btnCargar").addEventListener("click", loadList);
  document.querySelector("#btnGuardar").addEventListener("click", async () => {
    const selectedRecords = [...registerBody.querySelectorAll("tr[data-matricula-id]")].map((row) => ({
      matriculaId: row.dataset.matriculaId,
      estado: row.querySelector("input:checked")?.value
    }));
    if (selectedRecords.some((record) => !record.estado)) {
      showFeedback("Selecciona el estado de asistencia de todos los estudiantes.");
      return;
    }
    try {
      const result = await api("/api/academico/asistencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cursoId: courseSelect.value,
          asignaturaId: subjectSelect.value,
          fecha: dateInput.value,
          records: selectedRecords
        })
      });
      showFeedback(`Se guardaron ${result.saved} registros.`, true);
      await loadHistory();
    } catch (error) {
      showFeedback(error.message);
    }
  });

  courseSelect.addEventListener("change", updateSubjects);
  courseSelect.addEventListener("change", clearRoster);
  subjectSelect.addEventListener("change", clearRoster);
  dateInput.addEventListener("change", clearRoster);
  document.querySelector("#btnImprimir").addEventListener("click", () => window.print());
  ["#histEstudiante", "#histDesde", "#histHasta"].forEach((selector) => {
    document.querySelector(selector).addEventListener("input", loadHistory);
    document.querySelector(selector).addEventListener("change", loadHistory);
  });
  document.querySelector("#histCurso").addEventListener("change", loadHistory);

  const initialize = async () => {
    user = await api("/api/auth/me");
    document.querySelector(".user-name").textContent = user.name;
    if (!["Admin", "Profesor"].includes(user.role)) {
      window.location.replace("/dashboard.html");
      return;
    }
    document.querySelector("#certificationModuleLink").hidden = user.role !== "Admin";
    document.querySelector("#btnMarcarAusentes").hidden = user.role !== "Profesor";
    const [courseData, subjectData] = await Promise.all([
      api("/api/cursos?limit=200"),
      api("/api/asignaturas?limit=200")
    ]);
    subjects = subjectData.records;
    courses = courseData.records.filter((course) => (
      user.role !== "Profesor" || subjects.some((subject) => subject.curso_id === course.id)
    ));
    courses
      .sort((left, right) => left.nombre.localeCompare(right.nombre, "es"))
      .forEach((course) => {
        courseSelect.add(new Option(course.nombre, course.id));
        document.querySelector("#histCurso").add(new Option(course.nombre, course.id));
      });
    updateSubjects();
    dateInput.value = new Date().toISOString().slice(0, 10);
    document.querySelector("#logoutButton")?.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      window.location.assign("../../landing_page/login.html");
    });
    await loadHistory();
    if (!courses.length) showFeedback("No tienes grupos con asignaturas asignadas.");
  };

  initialize().catch((error) => {
    console.error("No fue posible cargar el control de asistencia.", error);
    showFeedback(error.message);
  });
})();
