/**
 * auth/middleware.js — Verificación de JWT para rutas protegidas
 */
const jwt = require('jsonwebtoken');
require('dotenv').config({ quiet: true });

// El secreto se lee SOLO del archivo .env; si falta, el servidor no arranca.
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    throw new Error('Falta JWT_SECRET en el archivo .env');
}

/**
 * verifyToken — middleware Express que valida el JWT del header Authorization.
 * Uso: router.get('/ruta', verifyToken, handler)
 */
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.cookies && req.cookies.token;

    if (!token) {
        return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    try {
        const payload = jwt.verify(token, SECRET);
        req.user = payload;   // { id, username, nombre }
        next();
    } catch (e) {
        return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
    }
}

/**
 * verifyTokenPage — igual que verifyToken pero para páginas HTML:
 * redirige a /login en vez de responder 401.
 */
function verifyTokenPage(req, res, next) {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.redirect('/login');
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch {
        return res.redirect('/login');
    }
}

module.exports = { verifyToken, verifyTokenPage, SECRET };
