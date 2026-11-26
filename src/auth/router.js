/**
 * auth/router.js — Rutas de autenticación (Fase 3)
 *   POST /api/auth/login   → valida credenciales, devuelve JWT
 *   POST /api/auth/logout  → invalida la cookie de sesión
 *   GET  /api/auth/me      → devuelve info del usuario autenticado
 */
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { verifyToken, SECRET } = require('./middleware');

const TOKEN_TTL = '8h';

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
    const body = req.body || {};
    const correo = body.correo || body.username || body.email;
    const password = body.password;

    if (!correo || !password) {
        return res.status(400).json({ ok: false, error: 'Campos requeridos: correo (o usuario) y password' });
    }

    try {
        // Se puede entrar con el correo completo (lizandro.reyes@utmetropolitana.edu.mx)
        // o solo con el usuario, que es la parte antes de la @ (lizandro.reyes)
        const entrada = String(correo).trim().toLowerCase();
        const [rows] = entrada.includes('@')
            ? await pool.query(
                'SELECT id_admin, correo, password_hash, rol, activo FROM admin_usuarios WHERE LOWER(correo) = ?',
                [entrada])
            : await pool.query(
                `SELECT id_admin, correo, password_hash, rol, activo FROM admin_usuarios
                 WHERE LOWER(SUBSTRING_INDEX(correo, '@', 1)) = ? LIMIT 1`,
                [entrada]);

        if (rows.length === 0 || !rows[0].activo) {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
        }

        const user = rows[0];
        const match = await bcrypt.compare(String(password), user.password_hash);
        if (!match) {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
        }

        // Generar JWT
        const payload = { id: user.id_admin, correo: user.correo, rol: user.rol };
        const token   = jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL });

        // Cookie HttpOnly + token en JSON para clientes REST (Postman)
        res.cookie('token', token, {
            httpOnly: true,
            secure  : false,
            sameSite: 'Lax',
            maxAge  : 8 * 60 * 60 * 1000,
        });

        return res.json({ ok: true, token, user: payload });

    } catch (e) {
        console.error('[auth/login]', e.message);
        return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', (_req, res) => {
    res.clearCookie('token');
    return res.json({ ok: true, message: 'Sesión cerrada' });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
    return res.json({ ok: true, user: req.user });
});

module.exports = router;
