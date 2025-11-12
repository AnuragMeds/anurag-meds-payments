import mysql from "mysql2/promise";

const {
  DB_HOST = process.env.MYSQLHOST || process.env.DB_HOSTNAME,
  DB_PORT = process.env.MYSQLPORT || "3306",
  DB_USER = process.env.MYSQLUSER,
  DB_PASSWORD = process.env.MYSQLPASSWORD,
  DB_NAME = process.env.MYSQLDATABASE
} = process.env;

let pool;

export async function getPool() {
  if (!pool) {
    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
      console.warn("[db] Missing DB env vars. Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.");
    }
    pool = mysql.createPool({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      namedPlaceholders: true
    });
  }
  return pool;
}

export async function initSchema() {
  const conn = await getPool();
  // Users (both customers and admins)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(191) UNIQUE,
      phone VARCHAR(32),
      name VARCHAR(191),
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Prescriptions
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NULL,
      full_name VARCHAR(191),
      phone VARCHAR(32),
      address TEXT,
      file_name VARCHAR(255),
      file_mime VARCHAR(128),
      file_size INT,
      file_data LONGBLOB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (user_id),
      CONSTRAINT fk_presc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}


