CREATE DATABASE GestionAcademica;
GO

USE GestionAcademica;
GO

-- 1. INSTITUCIONES
CREATE TABLE INSTITUCIONES (
    id                UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    nombre            NVARCHAR(150)    NOT NULL,
    nit_codigo        NVARCHAR(30)     NOT NULL,
    plan_suscripcion  NVARCHAR(20)     NOT NULL,
    CONSTRAINT PK_INSTITUCIONES PRIMARY KEY (id),
    CONSTRAINT UQ_INSTITUCIONES_nit UNIQUE (nit_codigo),
    CONSTRAINT CK_INSTITUCIONES_plan
        CHECK (plan_suscripcion IN ('Lite', 'Standard', 'Enterprise'))
);
GO

-- 2. USUARIOS
CREATE TABLE USUARIOS (
    id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    institucion_id  UNIQUEIDENTIFIER NOT NULL,
    documento       NVARCHAR(30)     NOT NULL,
    nombre          NVARCHAR(80)     NOT NULL,
    apellido        NVARCHAR(80)     NOT NULL,
    email           NVARCHAR(150)    NOT NULL,
    password_hash   NVARCHAR(255)    NOT NULL,
    rol             NVARCHAR(20)     NOT NULL,
    CONSTRAINT PK_USUARIOS PRIMARY KEY (id),
    CONSTRAINT FK_USUARIOS_institucion
        FOREIGN KEY (institucion_id) REFERENCES INSTITUCIONES(id),
    CONSTRAINT UQ_USUARIOS_email UNIQUE (email),
    CONSTRAINT UQ_USUARIOS_documento UNIQUE (institucion_id, documento),
    CONSTRAINT CK_USUARIOS_rol
        CHECK (rol IN ('SuperAdmin', 'Admin', 'Profesor', 'Estudiante', 'Acudiente'))
);
GO

-- 3. CURSOS
CREATE TABLE CURSOS (
    id               UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    institucion_id   UNIQUEIDENTIFIER NOT NULL,
    nombre           NVARCHAR(50)     NOT NULL,   -- ej. '10°B'
    periodo_lectivo  INT              NOT NULL,   -- año escolar, ej. 2026
    CONSTRAINT PK_CURSOS PRIMARY KEY (id),
    CONSTRAINT FK_CURSOS_institucion
        FOREIGN KEY (institucion_id) REFERENCES INSTITUCIONES(id),
    CONSTRAINT UQ_CURSOS_nombre_periodo
        UNIQUE (institucion_id, nombre, periodo_lectivo)
);
GO

-- 4. ASIGNATURAS
CREATE TABLE ASIGNATURAS (
    id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    curso_id     UNIQUEIDENTIFIER NOT NULL,
    profesor_id  UNIQUEIDENTIFIER NOT NULL,
    nombre       NVARCHAR(100)    NOT NULL,
    CONSTRAINT PK_ASIGNATURAS PRIMARY KEY (id),
    CONSTRAINT FK_ASIGNATURAS_curso
        FOREIGN KEY (curso_id) REFERENCES CURSOS(id),
    CONSTRAINT FK_ASIGNATURAS_profesor
        FOREIGN KEY (profesor_id) REFERENCES USUARIOS(id)
);
GO

-- 5. MATRICULAS
CREATE TABLE MATRICULAS (
    id             UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    estudiante_id  UNIQUEIDENTIFIER NOT NULL,
    curso_id       UNIQUEIDENTIFIER NOT NULL,
    acudiente_id   UNIQUEIDENTIFIER NULL,
    CONSTRAINT PK_MATRICULAS PRIMARY KEY (id),
    CONSTRAINT FK_MATRICULAS_estudiante
        FOREIGN KEY (estudiante_id) REFERENCES USUARIOS(id),
    CONSTRAINT FK_MATRICULAS_curso
        FOREIGN KEY (curso_id) REFERENCES CURSOS(id),
    CONSTRAINT FK_MATRICULAS_acudiente
        FOREIGN KEY (acudiente_id) REFERENCES USUARIOS(id),
    CONSTRAINT UQ_MATRICULAS_estudiante_curso UNIQUE (estudiante_id, curso_id)
);
GO

-- 6. CALIFICACIONES
CREATE TABLE CALIFICACIONES (
    id             UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    matricula_id   UNIQUEIDENTIFIER NOT NULL,
    asignatura_id  UNIQUEIDENTIFIER NOT NULL,
    periodo        TINYINT          NOT NULL,
    nota           DECIMAL(4,2)     NOT NULL,
    porcentaje     DECIMAL(5,2)     NOT NULL,   -- peso en la nota final
    CONSTRAINT PK_CALIFICACIONES PRIMARY KEY (id),
    CONSTRAINT FK_CALIFICACIONES_matricula
        FOREIGN KEY (matricula_id) REFERENCES MATRICULAS(id),
    CONSTRAINT FK_CALIFICACIONES_asignatura
        FOREIGN KEY (asignatura_id) REFERENCES ASIGNATURAS(id),
    CONSTRAINT CK_CALIFICACIONES_periodo CHECK (periodo BETWEEN 1 AND 4),
    CONSTRAINT CK_CALIFICACIONES_nota CHECK (nota BETWEEN 0 AND 5),
    CONSTRAINT CK_CALIFICACIONES_porcentaje CHECK (porcentaje BETWEEN 0 AND 100)
);
GO

-- 7. ASISTENCIA
CREATE TABLE ASISTENCIA (
    id             UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    matricula_id   UNIQUEIDENTIFIER NOT NULL,
    asignatura_id  UNIQUEIDENTIFIER NOT NULL,
    fecha          DATE             NOT NULL,
    estado         NVARCHAR(10)     NOT NULL,
    CONSTRAINT PK_ASISTENCIA PRIMARY KEY (id),
    CONSTRAINT FK_ASISTENCIA_matricula
        FOREIGN KEY (matricula_id) REFERENCES MATRICULAS(id),
    CONSTRAINT FK_ASISTENCIA_asignatura
        FOREIGN KEY (asignatura_id) REFERENCES ASIGNATURAS(id),
    CONSTRAINT CK_ASISTENCIA_estado
        CHECK (estado IN ('Presente', 'Ausente', 'Excusado', 'Retardo')),
    CONSTRAINT UQ_ASISTENCIA_dia UNIQUE (matricula_id, asignatura_id, fecha)
);
GO