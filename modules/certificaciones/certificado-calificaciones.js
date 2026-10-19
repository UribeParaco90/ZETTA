(() => {
  const SESSION_KEY = "zetta-demo-session";
  const INSTITUTION = "Institución Educativa Demo ZETTA";
  const ASSESSMENT_WEIGHTS = [30, 30, 40];
  const students = [
    {
      id: "estudiante-001",
      name: "Valentina Ríos",
      document: "DEMO-102030",
      course: "10°A",
      year: 2026,
      subjects: [
        { name: "Matemáticas", periods: [[4.2, 4.5, 4.6], [4.0, 4.3, 4.4], [4.4, 4.6, 4.7], [4.5, 4.8, 4.9]] },
        { name: "Ciencias Naturales", periods: [[4.6, 4.2, 4.7], [4.4, 4.5, 4.6], [4.3, 4.7, 4.8], [4.7, 4.6, 4.9]] },
        { name: "Lengua Castellana", periods: [[4.4, 4.7, 4.5], [4.6, 4.5, 4.8], [4.2, 4.4, 4.7], [4.6, 4.8, 4.9]] }
      ]
    },
    {
      id: "estudiante-002",
      name: "Samuel Gómez",
      document: "DEMO-204060",
      course: "10°A",
      year: 2026,
      subjects: [
        { name: "Matemáticas", periods: [[3.8, 4.0, 4.2], [4.1, 4.3, 4.1], [4.0, 4.4, 4.5], [4.3, 4.5, 4.6]] },
        { name: "Ciencias Naturales", periods: [[4.1, 4.4, 4.2], [3.9, 4.2, 4.4], [4.3, 4.5, 4.6], [4.4, 4.7, 4.5]] },
        { name: "Lengua Castellana", periods: [[4.5, 4.2, 4.4], [4.3, 4.6, 4.5], [4.4, 4.6, 4.7], [4.6, 4.7, 4.8]] }
      ]
    }
  ];

  const readDemoSession = () => {
    try {
      const storedSession = localStorage.getItem(SESSION_KEY);
      if (!storedSession) {
        return null;
      }
      const session = JSON.parse(storedSession);
      const validRoles = ["SuperAdmin", "Admin", "Profesor", "Estudiante", "Acudiente"];
      const isLegacyDemoSession = session?.email === "demo@zetta.edu.co"
        && typeof session.name === "string";
      const isCurrentDemoSession = typeof session?.email === "string"
        && session.email.length > 0
        && typeof session.name === "string"
        && session.name.length > 0
        && validRoles.includes(session.role);
      if (!isLegacyDemoSession && !isCurrentDemoSession) {
        return null;
      }
      return session;
    } catch (error) {
      console.error("No fue posible leer la sesión de demostración.", error);
      return null;
    }
  };

  const session = readDemoSession();
  if (!session) {
    window.location.replace("../../landing_page/login.html");
    return;
  }

  const form = document.querySelector("#certificateForm");
  const studentSelect = document.querySelector("#studentSelect");
  const periodSelect = document.querySelector("#periodSelect");
  const feedback = document.querySelector("#certificateFeedback");
  const result = document.querySelector("#certificateResult");
  const userName = document.querySelector("#userName");
  const printButton = document.querySelector("#printButton");
  const logoutButton = document.querySelector("#logoutButton");

  if (!form || !studentSelect || !periodSelect || !feedback || !result || !userName || !printButton || !logoutButton) {
    console.error("Faltan elementos requeridos para inicializar el módulo de certificaciones.");
    return;
  }

  userName.textContent = session.name;

  students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = `${student.name} · ${student.course}`;
    studentSelect.append(option);
  });

  const formatGrade = (value) => new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

  const clearPreview = () => {
    result.hidden = true;
    feedback.textContent = "";
  };

  const getWeightedAverage = (grades) => {
    const weightedTotal = grades.reduce((total, grade, index) => (
      total + grade * ASSESSMENT_WEIGHTS[index]
    ), 0);
    return weightedTotal / ASSESSMENT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  };

  const appendGradeRow = (subject, grade) => {
    const row = document.createElement("tr");
    const subjectCell = document.createElement("th");
    const gradeCell = document.createElement("td");
    const scaleCell = document.createElement("td");

    subjectCell.scope = "row";
    subjectCell.textContent = subject;
    gradeCell.textContent = formatGrade(grade);
    scaleCell.textContent = "0,00 – 5,00";
    row.append(subjectCell, gradeCell, scaleCell);
    document.querySelector("#gradesBody").append(row);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }

    const student = students.find((item) => item.id === studentSelect.value);
    if (!student) {
      feedback.textContent = "Selecciona un estudiante disponible en los datos de demostración.";
      return;
    }

    const periodIndex = Number(periodSelect.value) - 1;
    const subjectGrades = student.subjects.map((subject) => ({
      name: subject.name,
      grade: getWeightedAverage(subject.periods[periodIndex])
    }));
    const overallAverage = subjectGrades.reduce((sum, subject) => sum + subject.grade, 0) / subjectGrades.length;
    const folio = `DEMO-${student.year}-${Date.now().toString(36).toUpperCase()}`;
    const issuedDate = new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date());

    document.querySelector("#institutionName").textContent = INSTITUTION;
    document.querySelector("#certificatePeriod").textContent = `Periodo ${periodIndex + 1} · Año lectivo ${student.year}`;
    document.querySelector("#certificateStudent").textContent = student.name;
    document.querySelector("#certificateDocument").textContent = student.document;
    document.querySelector("#certificateCourse").textContent = student.course;
    document.querySelector("#certificateYear").textContent = String(student.year);
    document.querySelector("#overallAverage").textContent = formatGrade(overallAverage);
    document.querySelector("#certificateFolio").textContent = folio;
    document.querySelector("#gradeMethod").textContent =
      `Calificación por área: promedio ponderado de tres componentes (30 %, 30 % y 40 %). Fecha de emisión de muestra: ${issuedDate}.`;

    const gradesBody = document.querySelector("#gradesBody");
    gradesBody.replaceChildren();
    subjectGrades.forEach(({ name, grade }) => appendGradeRow(name, grade));

    feedback.textContent = "";
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  studentSelect.addEventListener("change", clearPreview);
  periodSelect.addEventListener("change", clearPreview);
  printButton.addEventListener("click", () => window.print());
  logoutButton.addEventListener("click", () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error("No fue posible borrar la sesión local.", error);
      feedback.textContent = "No se pudo cerrar la sesión local. Intenta nuevamente.";
      return;
    }
    window.location.assign("../../landing_page/login.html");
  });
})();
