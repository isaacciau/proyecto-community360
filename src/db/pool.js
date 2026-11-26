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
    // Conexión estable con la nube: más tiempo para conectar, conexiones vivas
    // y se cierran las que llevan mucho tiempo sin usarse (el gateway las corta).
    connectTimeout       : 20000,
    enableKeepAlive      : true,
    keepAliveInitialDelay: 10000,
    maxIdle              : 5,
    idleTimeout          : 60000,
});

// Si la conexión no se pudo ABRIR (tiempo agotado o rechazada), se intenta una vez más.
// Solo se reintenta cuando la consulta nunca llegó a la base, así no se duplica un INSERT.
const ERRORES_DE_CONEXION = ['ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'];
const consultaOriginal = pool.query.bind(pool);
pool.query = async (...args) => {
    try {
        return await consultaOriginal(...args);
    } catch (e) {
        if (!ERRORES_DE_CONEXION.includes(e.code)) throw e;
        console.warn(`[db] ${e.code} al conectar con TiDB, reintentando…`);
        await new Promise(r => setTimeout(r, 500));
        return consultaOriginal(...args);
    }
};

module.exports = pool;
