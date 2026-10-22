-- Esquema PostgreSQL para Neon.
-- Ejecuta una vez sobre una base nueva; las tablas existentes no se modifican.

CREATE TABLE IF NOT EXISTS instituciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    nit_codigo VARCHAR(30) NOT NULL UNIQUE,
    plan_suscripcion VARCHAR(20) NOT NULL
        CHECK (plan_suscripcion IN ('Lite', 'Standard', 'Enterprise'))
);

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    documento VARCHAR(30) NOT NULL,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL
        CHECK (rol IN ('SuperAdmin', 'Admin', 'Profesor', 'Estudiante', 'Acudiente')),
    UNIQUE (institucion_id, documento)
);

CREATE TABLE IF NOT EXISTS cursos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    nombre VARCHAR(50) NOT NULL,
    periodo_lectivo INTEGER NOT NULL,
    UNIQUE (institucion_id, nombre, periodo_lectivo)
);

CREATE TABLE IF NOT EXISTS asignaturas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curso_id UUID NOT NULL REFERENCES cursos(id),
    profesor_id UUID NOT NULL REFERENCES usuarios(id),
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS matriculas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estudiante_id UUID NOT NULL REFERENCES usuarios(id),
    curso_id UUID NOT NULL REFERENCES cursos(id),
    acudiente_id UUID REFERENCES usuarios(id),
    UNIQUE (estudiante_id, curso_id)
);

CREATE TABLE IF NOT EXISTS calificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matricula_id UUID NOT NULL REFERENCES matriculas(id),
    asignatura_id UUID NOT NULL REFERENCES asignaturas(id),
    periodo SMALLINT NOT NULL CHECK (periodo BETWEEN 1 AND 4),
    nota NUMERIC(4, 2) NOT NULL CHECK (nota BETWEEN 0 AND 5),
    porcentaje NUMERIC(5, 2) NOT NULL CHECK (porcentaje BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS asistencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matricula_id UUID NOT NULL REFERENCES matriculas(id),
    asignatura_id UUID NOT NULL REFERENCES asignaturas(id),
    fecha DATE NOT NULL,
    estado VARCHAR(10) NOT NULL
        CHECK (estado IN ('Presente', 'Ausente', 'Excusado', 'Retardo')),
    UNIQUE (matricula_id, asignatura_id, fecha)
);

CREATE TABLE IF NOT EXISTS zetta_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_institucion_rol ON usuarios (institucion_id, rol);
CREATE INDEX IF NOT EXISTS idx_matriculas_estudiante ON matriculas (estudiante_id);
CREATE INDEX IF NOT EXISTS idx_matriculas_acudiente ON matriculas (acudiente_id);
CREATE INDEX IF NOT EXISTS idx_asignaturas_profesor ON asignaturas (profesor_id);
CREATE INDEX IF NOT EXISTS idx_calificaciones_matricula_periodo ON calificaciones (matricula_id, periodo);
CREATE INDEX IF NOT EXISTS idx_asistencia_fecha ON asistencia (fecha);
CREATE INDEX IF NOT EXISTS idx_zetta_sessions_expires_at ON zetta_sessions (expires_at);
