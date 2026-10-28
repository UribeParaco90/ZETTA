(() => {
  const state = {
    user: null,
    entities: [],
    entity: null,
    records: [],
    references: new Map(),
    userGroups: new Map(),
    recordId: null
  };
  const element = (selector) => document.querySelector(selector);
  const navigation = element("#entityNavigation");
  const title = element("#entityTitle");
  const description = element("#entityDescription");
  const createButton = element("#createRecord");
  const tableHead = element("#recordsHead");
  const tableBody = element("#recordsBody");
  const feedback = element("#adminFeedback");
  const dialog = element("#recordDialog");
  const form = element("#recordForm");
  const dialogFields = element("#dialogFields");
  const dialogFeedback = element("#dialogFeedback");
  const saveButton = element("#saveRecord");
  const singularLabels = {
    instituciones: "colegio",
    usuarios: "usuario",
    cursos: "curso",
    asignaturas: "materia",
    matriculas: "matrícula",
    calificaciones: "calificación",
    asistencia: "asistencia"
  };

  const api = async (url, options) => {
    const response = await fetch(url, options);
    let body;
    try {
      body = response.status === 204 ? null : await response.json();
    } catch {
      throw new Error("El servidor devolvió una respuesta inválida.");
    }
    if (!response.ok) throw new Error(body?.error || "La solicitud no pudo completarse.");
    return body;
  };

  const report = (message, success = false) => {
    feedback.textContent = message;
    feedback.classList.toggle("is-success", success);
  };

  const referenceLabel = (key, record) => {
    if (key === "usuarios") return `${record.nombre} ${record.apellido}`;
    if (key === "instituciones") return record.nombre;
    if (key === "cursos") return `${record.nombre} · ${record.periodo_lectivo}`;
    if (key === "asignaturas") return record.nombre;
    if (key === "matriculas") {
      const student = record.estudiante_nombre
        || (state.references.get("usuarios") || []).find((item) => item.id === record.estudiante_id);
      const studentName = typeof student === "string"
        ? student
        : student ? `${student.nombre} ${student.apellido}` : "Estudiante";
      const course = record.curso_nombre
        || (state.references.get("cursos") || []).find((item) => item.id === record.curso_id)?.nombre
        || "Curso";
      return `${studentName} · ${course}`;
    }
    return Object.entries(record).filter(([field]) => field !== "id").slice(0, 2).map(([, value]) => value).join(" · ");
  };

  const displayValue = (field, value) => {
    if (field.key === "primer_ingreso") return value ? "Pendiente" : "Activada";
    if (!value) return "—";
    if (field.type === "reference") {
      const record = (state.references.get(field.reference) || []).find((item) => item.id === value);
      return record ? referenceLabel(field.reference, record) : value;
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const teacherDisplayFields = {
    cursos: [
      { key: "nombre", label: "Curso" },
      { key: "periodo_lectivo", label: "Año lectivo" },
      { key: "rol_docente", label: "Rol en el curso" }
    ],
    asignaturas: [
      { key: "nombre", label: "Asignatura" },
      { key: "curso_nombre", label: "Curso" }
    ],
    matriculas: [
      { key: "estudiante_nombre", label: "Estudiante" },
      { key: "curso_nombre", label: "Curso" }
    ],
    calificaciones: [
      { key: "asignatura_nombre", label: "Asignatura" },
      { key: "periodo", label: "Periodo" },
      { key: "nota", label: "Nota" },
      { key: "porcentaje", label: "Porcentaje" }
    ]
  };

  const prepareTeacherRecords = async (entityKey, records) => {
    if (state.user.role !== "Profesor" || !teacherDisplayFields[entityKey]) return records;
    state.entity.displayFields = teacherDisplayFields[entityKey];

    if (entityKey === "cursos") {
      return records.map((record) => ({
        ...record,
        rol_docente: record.rol_docente || (record.director_grupo_id === state.user.id
          ? "Director de grupo"
          : "Docente por asignatura")
      }));
    }

    if (entityKey === "asignaturas" || entityKey === "matriculas") {
      const courses = await api("/api/cursos?limit=200");
      const courseNames = new Map(courses.records.map((course) => [course.id, course.nombre]));
      if (entityKey === "asignaturas") {
        return records.map((record) => ({
          ...record,
          curso_nombre: record.curso_nombre || courseNames.get(record.curso_id) || "Curso asignado"
        }));
      }

      const students = await api("/api/academico/estudiantes");
      const studentNames = new Map(students.map((student) => [student.id, `${student.nombre} ${student.apellido}`]));
      return records.map((record) => ({
        ...record,
        estudiante_nombre: record.estudiante_nombre || studentNames.get(record.estudiante_id) || "Estudiante",
        curso_nombre: record.curso_nombre || courseNames.get(record.curso_id) || "Curso asignado"
      }));
    }

    const subjects = await api("/api/asignaturas?limit=200");
    const subjectNames = new Map(subjects.records.map((subject) => [subject.id, subject.nombre]));
    return records.map((record) => ({
      ...record,
      asignatura_nombre: record.asignatura_nombre || subjectNames.get(record.asignatura_id) || "Asignatura"
    }));
  };

  const loadReferences = async () => {
    const keys = new Set(state.entity.fields
      .filter((field) => field.type === "reference" && !field.readOnly)
      .map((field) => field.reference));
    for (const key of keys) {
      if (!state.entity.canWrite) continue;
      if (key === "instituciones" && !["Admin", "SuperAdmin"].includes(state.user.role)) continue;
      if (key === "instituciones" && state.user.role === "Admin") {
        state.references.set(key, [{ id: state.user.institutionId, nombre: "Mi institución" }]);
      } else if (key === "usuarios" && state.entity.key === "matriculas") {
        const students = await api("/api/academico/estudiantes");
        state.references.set(key, [...new Map(students.map((student) => [student.id, student])).values()]);
      } else if (key === "usuarios" && state.entity.key === "cursos") {
        const result = await api("/api/usuarios?limit=200");
        state.references.set(key, result.records.filter((user) => user.rol === "Profesor"));
      } else if (key === "usuarios" && state.user.role === "Profesor") {
        const result = await api("/api/academico/estudiantes");
        state.references.set(key, result);
      } else {
        const result = await api(`/api/${key}?limit=200`);
        state.references.set(key, result.records);
      }
    }
  };

  const renderNavigation = () => {
    navigation.replaceChildren();
    state.entities.forEach((entity) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "entity-nav-button";
      button.textContent = entity.label;
      button.setAttribute("aria-current", entity.key === state.entity?.key ? "page" : "false");
      button.addEventListener("click", () => selectEntity(entity));
      navigation.append(button);
    });
  };

  const renderRecords = () => {
    const fields = state.entity.displayFields
      || state.entity.fields.filter((field) => state.entity.display.includes(field.key));
    const normalizeSearch = (value) => String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
    const search = normalizeSearch(element("#searchRecords").value.trim());
    const institutionId = element("#institutionFilter").value;
    const role = element("#roleFilter").value;
    const groupId = element("#groupFilter").value;
    const institutionNames = new Map(
      (state.references.get("instituciones") || []).map((institution) => [institution.id, institution.nombre])
    );
    const isUserList = state.entity.key === "usuarios";
    const isSuperAdminUserList = state.user.role === "SuperAdmin" && state.entity.key === "usuarios";
    const isAdminUserList = state.user.role === "Admin" && state.entity.key === "usuarios";
    const records = state.records.filter((record) => {
      if (isSuperAdminUserList && institutionId && record.institucion_id !== institutionId) return false;
      if (isUserList && role && record.rol !== role) return false;
      if (isAdminUserList && groupId && !state.userGroups.get(groupId)?.has(record.id)) return false;
      const searchableValues = fields.map((field) => displayValue(field, record[field.key]));
      if (isSuperAdminUserList) {
        searchableValues.push(institutionNames.get(record.institucion_id) || "");
      }
      return searchableValues.some((value) => normalizeSearch(value).includes(search));
    });
    tableHead.replaceChildren();
    tableBody.replaceChildren();
    const header = document.createElement("tr");
    fields.forEach((field) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = field.label;
      header.append(cell);
    });
    if (state.entity.canWrite || state.entity.canManageActivation) {
      const actionHeader = document.createElement("th");
      actionHeader.scope = "col";
      actionHeader.textContent = "Acciones";
      header.append(actionHeader);
    }
    tableHead.append(header);
    records.forEach((record) => {
      const row = document.createElement("tr");
      fields.forEach((field) => {
        const cell = document.createElement("td");
        cell.textContent = displayValue(field, record[field.key]);
        row.append(cell);
      });
      if (state.entity.canWrite || state.entity.canManageActivation) {
        const actions = document.createElement("td");
        actions.className = "text-end";
        const canManageRecord = state.entity.canWrite
          && (state.entity.key !== "usuarios" || ["Profesor", "Estudiante"].includes(record.rol));
        if (canManageRecord) {
          const edit = document.createElement("button");
          edit.className = "btn btn-ghost btn-sm me-1";
          edit.type = "button";
          edit.textContent = "Editar";
          edit.addEventListener("click", () => openDialog(record));
          const remove = document.createElement("button");
          remove.className = "btn btn-outline-danger btn-sm";
          remove.type = "button";
          remove.textContent = "Eliminar";
          remove.addEventListener("click", () => deleteRecord(record));
          actions.append(edit, remove);
        }
        const canReissueActivation = state.entity.canManageActivation
          && record.primer_ingreso
          && (state.user.role === "SuperAdmin" ? record.rol === "Admin" : ["Profesor", "Estudiante"].includes(record.rol));
        if (canReissueActivation) {
          const activate = document.createElement("button");
          activate.className = "btn btn-ghost btn-sm ms-1";
          activate.type = "button";
          activate.textContent = "Reemitir enlace";
          activate.addEventListener("click", async () => {
            try {
              const result = await api(`/api/usuarios/${record.id}/activacion`, { method: "POST" });
              report(`Enlace de activación (válido 24 horas): ${result.activationUrl}`, true);
            } catch (error) {
              report(error.message);
            }
          });
          actions.append(activate);
        }
        row.append(actions);
      }
      tableBody.append(row);
    });
    element("#recordCount").textContent = isUserList
      ? `${records.length} de ${state.records.length} usuarios`
      : `${records.length} registros`;
    element("#emptyState").hidden = records.length > 0;
  };

  const loadRecords = async () => {
    const limit = state.user.role === "SuperAdmin" && state.entity.key === "usuarios" ? 2000 : 200;
    const result = await api(`/api/${state.entity.key}?limit=${limit}`);
    state.records = await prepareTeacherRecords(state.entity.key, result.records);
    renderRecords();
  };

  const renderUserFilters = () => {
    const isUserList = state.entity.key === "usuarios";
    const isSuperAdminUserList = state.user.role === "SuperAdmin" && isUserList;
    const isAdminUserList = state.user.role === "Admin" && isUserList;
    element("#institutionFilterGroup").hidden = !isSuperAdminUserList;
    element("#roleFilterGroup").hidden = !isUserList;
    element("#groupFilterGroup").hidden = !isAdminUserList;
    if (!isSuperAdminUserList) return;

    const institutionFilter = element("#institutionFilter");
    const selectedInstitution = institutionFilter.value;
    institutionFilter.replaceChildren(new Option("Todas las instituciones", ""));
    (state.references.get("instituciones") || [])
      .slice()
      .sort((left, right) => left.nombre.localeCompare(right.nombre, "es"))
      .forEach((institution) => {
        institutionFilter.add(new Option(institution.nombre, institution.id));
      });
    institutionFilter.value = selectedInstitution;
  };

  const loadUserGroupFilters = async () => {
    const groupFilter = element("#groupFilter");
    const isAdminUserList = state.user.role === "Admin" && state.entity.key === "usuarios";
    groupFilter.replaceChildren(new Option("Todos los grupos", ""));
    state.userGroups.clear();
    if (!isAdminUserList) return;

    const [courses, enrollments, subjects] = await Promise.all([
      api("/api/cursos?limit=200"),
      api("/api/matriculas?limit=200"),
      api("/api/asignaturas?limit=200")
    ]);
    const courseNames = new Map();
    const addUserToGroup = (groupId, userId) => {
      if (!groupId || !userId) return;
      if (!state.userGroups.has(groupId)) state.userGroups.set(groupId, new Set());
      state.userGroups.get(groupId).add(userId);
    };

    courses.records.forEach((course) => {
      courseNames.set(course.id, `${course.nombre} · ${course.periodo_lectivo}`);
      addUserToGroup(course.id, course.director_grupo_id);
    });
    enrollments.records.forEach((enrollment) => {
      addUserToGroup(enrollment.curso_id, enrollment.estudiante_id);
      addUserToGroup(enrollment.curso_id, enrollment.acudiente_id);
    });
    subjects.records.forEach((subject) => addUserToGroup(subject.curso_id, subject.profesor_id));

    courses.records
      .slice()
      .sort((left, right) => (
        left.nombre.localeCompare(right.nombre, "es")
        || Number(right.periodo_lectivo) - Number(left.periodo_lectivo)
      ))
      .forEach((course) => {
        groupFilter.add(new Option(courseNames.get(course.id), course.id));
      });
  };

  const selectEntity = async (entity) => {
    state.entity = entity;
    title.textContent = entity.label;
    description.textContent = entity.canWrite
      ? "Consulta y modifica solo registros permitidos para tu perfil e institución."
      : "Consulta de solo lectura dentro del alcance de tu perfil.";
    createButton.hidden = !entity.canCreate;
    createButton.disabled = !entity.canCreate;
    renderNavigation();
    try {
      await loadReferences();
      renderUserFilters();
      await loadUserGroupFilters();
      await loadRecords();
      report("");
    } catch (error) {
      report(error.message);
    }
  };

  const createControl = (field, record) => {
    const wrapper = document.createElement("div");
    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = field.label;
    const isStudentEnrollmentSearch = state.entity.key === "matriculas" && field.key === "estudiante_id";
    const isSubjectTeacherSearch = state.entity.key === "asignaturas" && field.key === "profesor_id";
    const isCourseDirectorSearch = state.entity.key === "cursos" && field.key === "director_grupo_id";
    if (isStudentEnrollmentSearch || isSubjectTeacherSearch || isCourseDirectorSearch) {
      wrapper.className = "reference-search-control";
      const input = document.createElement("input");
      input.className = "form-control field";
      input.type = "search";
      input.autocomplete = "off";
      input.placeholder = isStudentEnrollmentSearch
        ? "Escribe el nombre del estudiante"
        : "Escribe el nombre del profesor";
      input.required = Boolean(field.required);
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      const listId = `${field.key}SearchOptions`;
      input.setAttribute("aria-controls", listId);

      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = field.key;
      hidden.value = record?.[field.key] || "";

      const options = document.createElement("div");
      options.className = "student-search-options";
      options.id = listId;
      options.role = "listbox";
      options.hidden = true;

      const references = [...new Map((state.references.get("usuarios") || [])
        .filter((user) => !(isSubjectTeacherSearch || isCourseDirectorSearch) || user.rol === "Profesor")
        .map((user) => [user.id, user])).values()]
        .sort((left, right) => (
          `${left.nombre} ${left.apellido}`.localeCompare(`${right.nombre} ${right.apellido}`, "es")
        ));
      const normalize = (value) => String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
      const selectedReference = references.find((user) => user.id === hidden.value);
      if (selectedReference) input.value = `${selectedReference.nombre} ${selectedReference.apellido}`;

      let activeIndex = -1;
      let visibleReferences = references;
      const closeOptions = () => {
        options.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        activeIndex = -1;
      };
      const selectReference = (user) => {
        hidden.value = user.id;
        input.value = `${user.nombre} ${user.apellido}`;
        input.setCustomValidity("");
        closeOptions();
      };
      const renderOptions = () => {
        const search = normalize(input.value.trim());
        visibleReferences = references.filter((user) => (
          normalize(`${user.nombre} ${user.apellido}`).includes(search)
        ));
        options.replaceChildren();
        visibleReferences.forEach((user, index) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "student-search-option";
          option.id = `${listId}-${index}`;
          option.role = "option";
          option.setAttribute("aria-selected", String(index === activeIndex));
          option.textContent = `${user.nombre} ${user.apellido}`;
          option.addEventListener("mousedown", (event) => event.preventDefault());
          option.addEventListener("click", () => selectReference(user));
          options.append(option);
        });
        if (!visibleReferences.length) {
          const empty = document.createElement("p");
          empty.className = "student-search-empty";
          empty.textContent = isStudentEnrollmentSearch
            ? "No se encontraron estudiantes."
            : "No se encontraron profesores.";
          options.append(empty);
        }
        options.hidden = false;
        input.setAttribute("aria-expanded", "true");
      };

      input.addEventListener("input", () => {
        hidden.value = "";
        input.setCustomValidity(input.value
          ? `Selecciona ${isStudentEnrollmentSearch ? "un estudiante" : "un profesor"} de la lista.`
          : "");
        activeIndex = -1;
        renderOptions();
      });
      input.addEventListener("focus", renderOptions);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeOptions();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
        if (options.hidden) renderOptions();
        if (event.key === "Enter") {
          if (activeIndex >= 0 && visibleReferences[activeIndex]) {
            event.preventDefault();
            selectReference(visibleReferences[activeIndex]);
          }
          return;
        }
        event.preventDefault();
        if (!visibleReferences.length) return;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        activeIndex = activeIndex < 0
          ? direction > 0 ? 0 : visibleReferences.length - 1
          : (activeIndex + direction + visibleReferences.length) % visibleReferences.length;
        [...options.querySelectorAll('[role="option"]')].forEach((option, index) => {
          option.setAttribute("aria-selected", String(index === activeIndex));
        });
        input.setAttribute("aria-activedescendant", `${listId}-${activeIndex}`);
      });
      input.addEventListener("blur", () => window.setTimeout(closeOptions, 120));

      input.id = `record-${field.key}`;
      label.htmlFor = input.id;
      wrapper.append(label, input, hidden, options);
      return wrapper;
    }
    const control = document.createElement(field.type === "select" || field.type === "reference" ? "select" : "input");
    control.className = field.type === "select" || field.type === "reference"
      ? "form-select field"
      : "form-control field";
    control.name = field.key;
    control.required = Boolean(field.required && !(field.writeOnly && record));
    if (field.type === "select") {
      control.add(new Option("Selecciona una opción", ""));
      field.options.forEach((option) => control.add(new Option(option, option)));
    } else if (field.type === "reference") {
      control.add(new Option("Selecciona un registro", ""));
      (state.references.get(field.reference) || []).forEach((item) => {
        control.add(new Option(referenceLabel(field.reference, item), item.id));
      });
      if (field.reference === "instituciones" && state.user.role === "Admin") {
        control.value = state.user.institutionId;
        control.disabled = true;
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = field.key;
        hidden.value = state.user.institutionId;
        wrapper.append(hidden);
      }
    } else {
      control.type = field.type;
      if (field.maxLength) control.maxLength = field.maxLength;
      if (field.min !== undefined) control.min = field.min;
      if (field.max !== undefined) control.max = field.max;
      if (field.step !== undefined) control.step = field.step;
      if (field.type === "password" && record) control.placeholder = "Deja vacío para conservar la contraseña";
    }
    if (field.readOnly) {
      control.disabled = true;
      if (control instanceof HTMLInputElement) {
        control.readOnly = true;
        control.placeholder = "Se asigna automáticamente";
      }
    }
    if (record && record[field.key] !== undefined && field.type !== "password") {
      control.value = record[field.key] ?? "";
    }
    control.id = `record-${field.key}`;
    label.htmlFor = control.id;
    wrapper.append(label, control);
    return wrapper;
  };

  const openDialog = (record = null) => {
    state.recordId = record?.id || null;
    const label = singularLabels[state.entity.key] || state.entity.label.toLocaleLowerCase();
    element("#dialogTitle").textContent = record ? `Editar ${label}` : `Nuevo ${label}`;
    dialogFeedback.textContent = "";
    dialogFields.replaceChildren();
    state.entity.fields.forEach((field) => dialogFields.append(createControl(field, record)));
    dialog.showModal();
  };

  const deleteRecord = async (record) => {
    if (!window.confirm("¿Eliminar este registro? Si está relacionado con otros datos, Neon impedirá borrarlo.")) return;
    try {
      await api(`/api/${state.entity.key}/${record.id}`, { method: "DELETE" });
      report("Registro eliminado.", true);
      await loadRecords();
    } catch (error) {
      report(error.message);
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    saveButton.disabled = true;
    dialogFeedback.textContent = "";
    const body = Object.fromEntries(new FormData(form).entries());
    const url = state.recordId ? `/api/${state.entity.key}/${state.recordId}` : `/api/${state.entity.key}`;
    try {
      const saved = await api(url, {
        method: state.recordId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      dialog.close();
      if (state.entity.key === "usuarios" && !state.recordId) {
        report(
          `Usuario creado: ${saved.email}. Enlace de activación (válido 24 horas): ${saved.activationUrl}`
          + (saved.codigoVinculacion ? ` · Código para acudiente: ${saved.codigoVinculacion}` : ""),
          true
        );
      } else {
        report("Registro guardado correctamente.", true);
      }
      await loadRecords();
    } catch (error) {
      dialogFeedback.textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  });

  element("#logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login.html");
    }
  });
  element("#closeDialog").addEventListener("click", () => dialog.close());
  element("#cancelDialog").addEventListener("click", () => dialog.close());
  createButton.addEventListener("click", () => openDialog());
  element("#refreshRecords").addEventListener("click", () => loadRecords().catch((error) => report(error.message)));
  element("#searchRecords").addEventListener("input", renderRecords);
  element("#institutionFilter").addEventListener("change", renderRecords);
  element("#roleFilter").addEventListener("change", renderRecords);
  element("#groupFilter").addEventListener("change", renderRecords);

  const initialize = async () => {
    const user = await api("/api/auth/me");
    state.user = user;
    element("#adminUser").textContent = user.name;
    const health = await api("/api/health");
    element("#connectionState").textContent = `Neon conectado · ${health.database}`;
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "metrics" || view === "settings") {
      if (view === "metrics" && user.role !== "SuperAdmin") {
        window.location.replace("/dashboard.html");
        return;
      }
      if (view === "settings" && user.role !== "Admin") {
        window.location.replace("/dashboard.html");
        return;
      }
      await renderSpecialView(view);
      return;
    }
    state.entities = await api("/api/entities");
    if (user.role === "Profesor") {
      state.entities = state.entities.filter((entity) => entity.key !== "usuarios");
    }
    if (!state.entities.length) throw new Error("Este perfil no tiene entidades disponibles.");
    const requested = new URLSearchParams(window.location.search).get("entity");
    const entity = state.entities.find((item) => item.key === requested) || state.entities[0];
    await selectEntity(entity);
  };

  const renderSpecialView = async (view) => {
    navigation.replaceChildren();
    createButton.hidden = true;
    element(".admin-toolbar").hidden = true;
    element(".table-card").hidden = true;
    element("#entityTitle").textContent = view === "metrics" ? "Métricas SaaS y planes" : "Ajustes institucionales";
    element("#entityDescription").textContent = view === "metrics"
      ? "Uso de la plataforma y distribución actual de planes; no se realizan cobros."
      : "Configura la evaluación, los periodos y su cierre.";
    const panel = document.createElement("section");
    panel.className = "glass p-4";
    panel.setAttribute("aria-live", "polite");
    element(".admin-content").append(panel);
    if (view === "metrics") {
      const result = await api("/api/saas/metrics");
      const totals = result.totals;
      const summary = document.createElement("p");
      summary.className = "h5";
      summary.textContent = `${totals.instituciones} instituciones · ${totals.usuarios} usuarios · ${totals.cursos} cursos`;
      panel.append(summary);
      const table = document.createElement("table");
      table.className = "table align-middle";
      const head = document.createElement("tr");
      ["Institución", "Plan", "Usuarios", "Cursos"].forEach((label) => {
        const cell = document.createElement("th");
        cell.textContent = label;
        head.append(cell);
      });
      const thead = document.createElement("thead");
      thead.append(head);
      const tbody = document.createElement("tbody");
      result.institutions.forEach((institution) => {
        const row = document.createElement("tr");
        [institution.nombre, institution.plan_suscripcion, institution.usuarios, institution.cursos].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        });
        tbody.append(row);
      });
      table.append(thead, tbody);
      panel.append(table);
      return;
    }

    const result = await api("/api/configuracion-institucional");
    const form = document.createElement("form");
    form.className = "login-form";
    const fields = [
      ["notaMinimaAprobacion", "Nota mínima aprobatoria", result.settings.nota_minima_aprobacion, 0, 5, 0.01],
      ["escalaMin", "Mínimo de la escala", result.settings.escala_min, 0, 5, 0.01],
      ["escalaMax", "Máximo de la escala", result.settings.escala_max, 0, 5, 0.01],
      ["numPeriodos", "Número de periodos", result.settings.num_periodos, 1, 12, 1]
    ];
    const controls = {};
    fields.forEach(([name, labelText, value, min, max, step]) => {
      const label = document.createElement("label");
      label.className = "form-label";
      label.textContent = labelText;
      const input = document.createElement("input");
      input.className = "form-control field";
      input.name = name;
      input.type = "number";
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = value;
      input.required = true;
      controls[name] = input;
      form.append(label, input);
    });
    const yearLabel = document.createElement("label");
    yearLabel.className = "form-label";
    yearLabel.textContent = "Año lectivo";
    const yearInput = document.createElement("input");
    yearInput.className = "form-control field";
    yearInput.name = "periodoLectivo";
    yearInput.type = "number";
    yearInput.min = 2000;
    yearInput.max = 2200;
    yearInput.value = result.periodoLectivo;
    yearInput.required = true;
    form.append(yearLabel, yearInput);
    const weightsTitle = document.createElement("h3");
    weightsTitle.className = "h5 mt-3";
    weightsTitle.textContent = "Ponderación por periodo (debe sumar 100 %)";
    form.append(weightsTitle);
    let weightsContainer = document.createElement("div");
    weightsContainer.className = "row g-3";
    form.append(weightsContainer);
    const renderWeights = () => {
      weightsContainer.replaceChildren();
      const count = Number(controls.numPeriodos.value);
      for (let index = 0; index < count; index += 1) {
        const wrapper = document.createElement("div");
        wrapper.className = "col-sm-6";
        const label = document.createElement("label");
        label.className = "form-label";
        label.textContent = `Periodo ${index + 1} (%)`;
        const input = document.createElement("input");
        input.className = "form-control field period-weight";
        input.type = "number";
        input.min = 0;
        input.max = 100;
        input.step = 0.01;
        input.value = result.periodos[index]?.peso_porcentaje ?? (100 / count).toFixed(2);
        input.required = true;
        wrapper.append(label, input);
        weightsContainer.append(wrapper);
      }
    };
    controls.numPeriodos.addEventListener("change", renderWeights);
    renderWeights();
    const feedback = document.createElement("p");
    feedback.className = "admin-feedback";
    feedback.setAttribute("role", "status");
    const save = document.createElement("button");
    save.className = "btn btn-zetta";
    save.type = "submit";
    save.textContent = "Guardar configuración";
    form.append(feedback, save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const pesosPeriodos = [...form.querySelectorAll(".period-weight")].map((input) => Number(input.value));
      try {
        await api("/api/configuracion-institucional", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notaMinimaAprobacion: Number(controls.notaMinimaAprobacion.value),
            escalaMin: Number(controls.escalaMin.value),
            escalaMax: Number(controls.escalaMax.value),
            numPeriodos: Number(controls.numPeriodos.value),
            periodoLectivo: Number(yearInput.value),
            pesosPeriodos
          })
        });
        feedback.textContent = "Configuración guardada.";
        feedback.classList.add("is-success");
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.remove("is-success");
      }
    });
    panel.append(form);
    if (result.periodos.length) {
      const closure = document.createElement("div");
      closure.className = "mt-4";
      const heading = document.createElement("h3");
      heading.className = "h5";
      heading.textContent = "Cierre de periodos";
      closure.append(heading);
      result.periodos.forEach((period) => {
        const row = document.createElement("div");
        row.className = "d-flex align-items-center justify-content-between border-bottom py-2";
        const label = document.createElement("span");
        label.textContent = `Periodo ${period.numero} · ${period.peso_porcentaje}% · ${period.cerrado ? "Cerrado" : "Abierto"}`;
        const action = document.createElement("button");
        action.type = "button";
        action.className = "btn btn-ghost btn-sm";
        action.textContent = period.cerrado ? "Reabrir" : "Cerrar";
        action.addEventListener("click", async () => {
          try {
            await api(`/api/periodos/${period.id}/cierre`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accion: period.cerrado ? "reabrir" : "cerrar" })
            });
            window.location.reload();
          } catch (error) {
            feedback.textContent = error.message;
          }
        });
        row.append(label, action);
        closure.append(row);
      });
      panel.append(closure);
    }
  };

  initialize().catch((error) => {
    console.error("No fue posible iniciar la consola de administración.", error);
    report(error.message);
    element("#connectionState").textContent = "No se pudo conectar";
  });
})();
