const assert = require("node:assert/strict");
const test = require("node:test");
const { publicEntities } = require("../entities");

test("teachers cannot access the institution-wide user directory", () => {
  const entities = publicEntities("Profesor");

  assert.equal(entities.some((entity) => entity.key === "usuarios"), false);
});

test("teacher course lists distinguish group directors from subject teachers", () => {
  const courses = publicEntities("Profesor").find((entity) => entity.key === "cursos");

  assert.deepEqual(courses.display, ["nombre", "periodo_lectivo", "rol_docente"]);
  assert.deepEqual(courses.displayFields.map((field) => field.label), [
    "Curso",
    "Año lectivo",
    "Rol en el curso"
  ]);
});

test("teacher academic tables display readable assignments, groups, and grades", () => {
  const entities = publicEntities("Profesor");

  assert.deepEqual(
    entities.find((entity) => entity.key === "asignaturas").display,
    ["nombre", "curso_nombre"]
  );
  assert.deepEqual(
    entities.find((entity) => entity.key === "matriculas").display,
    ["estudiante_nombre", "curso_nombre"]
  );
  assert.deepEqual(
    entities.find((entity) => entity.key === "calificaciones").display,
    ["asignatura_nombre", "periodo", "nota", "porcentaje"]
  );
});
