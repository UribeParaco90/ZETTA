const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("@neondatabase/serverless");

dotenv.config({ path: path.join(__dirname, ".env") });

let pool;

const getPool = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("Configura DATABASE_URL en backend/.env.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
};

const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
};

module.exports = { closePool, getPool };
