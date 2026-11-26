-- ============================================================
--  COMMUNITY 360 — Tabla de administradores del sistema
--  Fase 3: Autenticación
--  Ejecutar UNA vez con: node src/setup_auth.js
-- ============================================================
USE community360;

CREATE TABLE IF NOT EXISTS admin_usuarios (
    id_admin       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    correo         VARCHAR(100) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    rol            VARCHAR(20)  NOT NULL,
    activo         TINYINT(1)   NOT NULL DEFAULT 1,
    fecha_creacion DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
