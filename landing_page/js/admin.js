(() => {
  const state = { user: null, entities: [], entity: null, records: [], references: new Map(), recordId: null };
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
    if (key === "usuarios") return `${record.nombre} ${record.apellido} · ${record.email}`;
    if (key === "instituciones") return record.nombre;
    if (key === "cursos") return `${record.nombre} · ${record.periodo_lectivo}`;
    if (key === "asignaturas") return record.nombre;
    return Object.entries(record).filter(([field]) => field !== "id").slice(0, 2).map(([, value]) => value).join(" · ");
  };

  const displayValue = (field, value) => {
    if (!value) return "—";
    if (field.type === "reference") {
      const record = (state.references.get(field.reference) || []).find((item) => item.id === value);
      return record ? referenceLabel(field.reference, record) : value;
    }
    return String(value);
  };

  const loadReferences = async () => {
    const keys = new Set(state.entity.fields.filter((field) => field.type === "reference").map((field) => field.reference));
    for (const key of keys) {
      if (key === "instituciones" && state.user.role === "Admin") {
        state.references.set(key, [{ id: state.user.institutionId, nombre: "Mi institución" }]);
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
    const fields = state.entity.fields.filter((field) => state.entity.display.includes(field.key));
    const search = element("#searchRecords").value.trim().toLocaleLowerCase();
    const records = state.records.filter((record) => fields.some((field) => (
      displayValue(field, record[field.key]).toLocaleLowerCase().includes(search)
    )));
    tableHead.replaceChildren();
    tableBody.replaceChildren();
    const header = document.createElement("tr");
    fields.forEach((field) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = field.label;
      header.append(cell);
    });
    if (state.entity.canWrite) {
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
      if (state.entity.canWrite) {
        const actions = document.createElement("td");
        actions.className = "text-end";
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
        row.append(actions);
      }
      tableBody.append(row);
    });
    element("#recordCount").textContent = `${records.length} registros`;
    element("#emptyState").hidden = records.length > 0;
  };

  const loadRecords = async () => {
    const result = await api(`/api/${state.entity.key}?limit=200`);
    state.records = result.records;
    renderRecords();
  };

  const selectEntity = async (entity) => {
    state.entity = entity;
    title.textContent = entity.label;
    description.textContent = entity.canWrite
      ? "Consulta y modifica solo registros permitidos para tu perfil e institución."
      : "Consulta de solo lectura dentro del alcance de tu perfil.";
    createButton.hidden = !entity.canWrite;
    createButton.disabled = !entity.canWrite;
    renderNavigation();
    try {
      await loadReferences();
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
      await api(url, {
        method: state.recordId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      dialog.close();
      report("Registro guardado correctamente.", true);
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

  const initialize = async () => {
    const user = await api("/api/auth/me");
    if (!["Admin", "SuperAdmin"].includes(user.role)) {
      window.location.replace("/dashboard.html");
      return;
    }
    state.user = user;
    element("#adminUser").textContent = user.name;
    const health = await api("/api/health");
    element("#connectionState").textContent = `Neon conectado · ${health.database}`;
    state.entities = await api("/api/entities");
    if (!state.entities.length) throw new Error("Este perfil no tiene entidades disponibles.");
    const requested = new URLSearchParams(window.location.search).get("entity");
    const entity = state.entities.find((item) => item.key === requested) || state.entities[0];
    await selectEntity(entity);
  };

  initialize().catch((error) => {
    console.error("No fue posible iniciar la consola de administración.", error);
    report(error.message);
    element("#connectionState").textContent = "No se pudo conectar";
  });
})();
