const assert = require("node:assert/strict");
const { pbkdf2Sync, randomBytes } = require("node:crypto");
const test = require("node:test");
const {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword
} = require("../security");

test("scrypt password hashes accept only the original password", async () => {
  const hash = await hashPassword("A secure test password 42!");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("A secure test password 42!", hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
});

test("previous PBKDF2 base64 password hashes remain usable", async () => {
  const password = "Existing Neon account password";
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, 210000, 32, "sha256");
  const hash = `pbkdf2$210000$${salt.toString("base64")}$${digest.toString("base64")}`;

  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("legacy PBKDF2 hex password hashes remain usable", async () => {
  const password = "Existing legacy password";
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, 210000, 32, "sha256");
  const hash = `${salt.toString("hex")}:${digest.toString("hex")}`;

  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("session tokens are opaque and stored by a one-way hash", () => {
  const token = createSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(hashSessionToken(token), token);
  assert.equal(hashSessionToken(token).length, 64);
});
