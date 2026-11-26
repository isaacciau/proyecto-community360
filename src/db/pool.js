/**
 * db/pool.js — Pool de conexiones compartido (mysql2/promise)
 */
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host    : process.env.DB_HOST,
    port    : Number(process.env.DB_PORT) || 4000,
    user    : process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl     : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    // Devuelve DATE/DATETIME como texto tal cual están guardados (UTC),
    // sin que Node los reinterprete con la zona horaria de la computadora.
    dateStrings: true,
    waitForConnections: true,
    connectionLimit   : 10,
    queueLimit        : 0,
});

module.exports = pool;
