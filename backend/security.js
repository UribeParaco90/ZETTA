const {
  createHash,
  pbkdf2: pbkdf2Callback,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(scryptCallback);
const pbkdf2 = promisify(pbkdf2Callback);
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyPbkdf2 = async (password, salt, expected, iterations) => {
  if (salt.length < 16 || expected.length < 32 || expected.length > 128) return false;
  const actual = await pbkdf2(password, salt, iterations, expected.length, "sha256");
  return safeEqual(actual, expected);
};

const hashPassword = async (password) => {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_KEY_BYTES, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
};

const verifyPassword = async (password, encodedHash) => {
  if (typeof encodedHash !== "string") return false;
  const parts = encodedHash.split("$");
  const algorithm = parts[0];
  if (algorithm === "pbkdf2" && parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) return false;
    let salt;
    let expected;
    try {
      salt = Buffer.from(parts[2], "base64url");
      expected = Buffer.from(parts[3], "base64url");
    } catch {
      return false;
    }
    return verifyPbkdf2(password, salt, expected, iterations);
  }
  if (parts[0] === "pbkdf2_sha256" && parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) return false;
    try {
      return await verifyPbkdf2(
        password,
        Buffer.from(parts[2], "base64"),
        Buffer.from(parts[3], "base64"),
        iterations
      );
    } catch {
      return false;
    }
  }
  if (parts.length === 1 && /^[0-9a-f]{32,128}:[0-9a-f]{64,256}$/i.test(encodedHash)) {
    const [saltHex, hashHex] = encodedHash.split(":");
    return verifyPbkdf2(password, Buffer.from(saltHex, "hex"), Buffer.from(hashHex, "hex"), 210000);
  }
  if (algorithm !== "scrypt" || parts.length !== 3) return false;
  const [, saltValue, hashValue] = parts;
  if (!saltValue || !hashValue) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltValue, "base64url");
    expected = Buffer.from(hashValue, "base64url");
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length !== PASSWORD_KEY_BYTES) return false;

  if (algorithm === "scrypt") {
    const actual = await scrypt(password, salt, expected.length, SCRYPT_OPTIONS);
    return safeEqual(actual, expected);
  }
  return false;
};

const createSessionToken = () => randomBytes(32).toString("base64url");
const hashSessionToken = (token) => createHash("sha256").update(token).digest("hex");

module.exports = {
  SESSION_TTL_SECONDS,
  createSessionToken,
  hashSessionToken,
  hashPassword,
  verifyPassword,
};
