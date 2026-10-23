const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateRequiredGrade,
  createInstitutionalEmail,
  isValidDomain
} = require("../business-rules");

test("generates institutional emails and increments duplicate local parts", async () => {
  const checked = [];
  const pool = {
    query: async (query, values) => {
      if (query.includes("SELECT dominio")) return { rows: [{ dominio: "colegio.edu.co" }] };
      checked.push(values[0]);
      return { rowCount: checked.length === 1 ? 1 : 0 };
    }
  };

  assert.equal(await createInstitutionalEmail(pool, "institution-id", "José Luis", "Pérez"),
    "jose.luis.perez1@colegio.edu.co");
  assert.deepEqual(checked, ["jose.luis.perez@colegio.edu.co", "jose.luis.perez1@colegio.edu.co"]);
});

test("accepts a domain name but rejects URL or email syntax", () => {
  assert.equal(isValidDomain("colegio.edu.co"), true);
  assert.equal(isValidDomain("https://colegio.edu.co"), false);
  assert.equal(isValidDomain("admin@colegio.edu.co"), false);
});

test("calculates the remaining score across a weighted year", () => {
  const result = calculateRequiredGrade({
    passingGrade: 3,
    maximumGrade: 5,
    completed: [
      { grade: 1.5, weight: 30 },
      { grade: 2.4, weight: 30 }
    ],
    remainingWeight: 40
  });

  assert.deepEqual(result, { required: 4.58, mathematicallyLost: false, earnedPoints: 1.17 });
});

test("marks a course as mathematically lost when the required grade exceeds the scale", () => {
  const result = calculateRequiredGrade({
    passingGrade: 4,
    maximumGrade: 5,
    completed: [{ grade: 1, weight: 80 }],
    remainingWeight: 20
  });

  assert.equal(result.required, 16);
  assert.equal(result.mathematicallyLost, true);
});

test("rejects invalid remaining weights and scores", () => {
  assert.throws(() => calculateRequiredGrade({
    passingGrade: 3,
    maximumGrade: 5,
    completed: [],
    remainingWeight: 0
  }), RangeError);
  assert.throws(() => calculateRequiredGrade({
    passingGrade: 3,
    maximumGrade: 5,
    completed: [{ grade: -1, weight: 50 }],
    remainingWeight: 50
  }), RangeError);
});
