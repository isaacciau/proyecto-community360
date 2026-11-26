require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 4000,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        enableKeepAlive: true,
    });
    const [v] = await db.query('SELECT VERSION() AS version');
    console.log('Conectado a TiDB. Versión:', v[0].version);

    await db.query('DROP TABLE IF EXISTS t_hija, t_padre');
    await db.query('CREATE TABLE t_padre (id VARCHAR(10) PRIMARY KEY)');
    await db.query(`CREATE TABLE t_hija (id INT PRIMARY KEY, id_padre VARCHAR(10) NOT NULL,
    FOREIGN KEY (id_padre) REFERENCES t_padre(id))`);
    await db.query("INSERT INTO t_padre VALUES ('U1')");
    await db.query("INSERT INTO t_hija VALUES (1,'U1')");
    console.log('OK: inserción válida');
    try {
        await db.query("INSERT INTO t_hija VALUES (2,'U999')");
        console.log('MAL: aceptó un registro huérfano');
    } catch (e) {
        console.log('OK: rechazó el huérfano ->', e.code);
    }
    await db.query('DROP TABLE t_hija, t_padre');
    await db.end();
})().catch(e => { console.error('Error:', e.code || e.message); process.exit(1); });