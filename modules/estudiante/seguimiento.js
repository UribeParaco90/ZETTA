(() => {
  const api = async (url, options) => {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    if (response.status !== 204 && !contentType.includes("application/json")) {
      throw new Error(`El servidor no devolvió una respuesta válida (${response.status}).`);
    }
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(body?.error || "No se pudo completar la solicitud.");
    return body;
  };

  const parameters = new URLSearchParams(window.location.search);
  const view = parameters.get("tipo") === "observaciones" ? "observaciones" : "asistencia";
  const isAttendance = view === "asistencia";
  const heading = document.querySelector("#recordsHeading");
  const description = document.querySelector("#recordsDescription");
  const tableHead = document.querySelector("#recordsHead");
  const tableBody = document.querySelector("#recordsBody");
  const feedback = document.querySelector("#recordsFeedback");

  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeZone: "UTC"
    }).format(date);
  };

  const render = (records) => {
    const columns = isAttendance
      ? [["asignatura", "Materia"], ["estado", "Estado"], ["fecha", "Fecha"]]
      : [["descripcion", "Observación"], ["profesor", "Profesor"], ["fecha", "Fecha"]];
    const header = document.createElement("tr");
    columns.forEach(([, label]) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      header.append(cell);
    });
    tableHead.replaceChildren(header);

    tableBody.replaceChildren();
    records.forEach((record) => {
      const row = document.createElement("tr");
      columns.forEach(([key]) => {
        const cell = document.createElement("td");
        cell.textContent = key === "fecha" ? formatDate(record[key]) : record[key] || "—";
        row.append(cell);
      });
      tableBody.append(row);
    });
    feedback.textContent = records.length
      ? ""
      : isAttendance ? "Todavía no tienes registros de asistencia." : "Todavía no tienes observaciones.";
  };

  const initialize = async () => {
    const user = await api("/api/auth/me");
    document.querySelector("#userName").textContent = user.name;
    heading.textContent = isAttendance ? "Mi asistencia" : "Mi observador";
    description.textContent = isAttendance
      ? "Consulta tus materias, el estado y la fecha de cada registro."
      : "Consulta las observaciones realizadas por tus profesores y la fecha.";
    const activeLink = document.querySelector(isAttendance ? "#attendanceLink" : "#observationsLink");
    activeLink.classList.add("active");
    activeLink.setAttribute("aria-current", "page");
    const endpoint = isAttendance ? "mi-asistencia" : "mi-observador";
    const data = await api(`/api/academico/${endpoint}`);
    render(data.records);
  };

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login.html");
    }
  });

  initialize().catch((error) => {
    console.error("No fue posible cargar el seguimiento académico.", error);
    feedback.textContent = error.message;
  });
})();
