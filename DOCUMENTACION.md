# ZETTA: roles, reglas funcionales y datos

ZETTA es una plataforma académica SaaS multiinstitución con control de acceso por rol y aislamiento en la API. Los permisos de las pantallas no sustituyen los controles del servidor.

## Roles y módulos

| Rol | Alcance | Funciones disponibles |
|---|---|---|
| SuperAdmin | Plataforma | Crear instituciones y administradores, revisar métricas de uso por plan y auditoría global. |
| Admin | Una institución | Usuarios, matrículas, cursos, materias, horarios, actividades, planilla masiva, configuración de evaluación, cierres, excusas, marca institucional y auditoría de cambios. |
| Profesor | Materias asignadas y grupos que dicta; puede ser director de grupo | Actividades y notas mediante planilla masiva, asistencia, observaciones y consulta de horario. No consulta el directorio institucional de usuarios. |
| Estudiante | Sus propios datos | Perfil académico, edición de correo personal y cumpleaños, notas por periodo, asistencia y observaciones. |
| Acudiente | Estudiantes vinculados | Autorregistro, vinculación mediante código, consulta de matrículas, notas, asistencia, observaciones y presentación de excusas. |

## Alta, correos y acceso

- Solo SuperAdmin registra instituciones y crea sus cuentas Admin.
- Admin crea cuentas de Profesor y Estudiante. El servidor genera `nombre.apellido@dominio` y prueba sufijos numéricos si el correo ya existe.
- Las cuentas creadas por Admin no reciben una contraseña predeterminada. Se crea un token aleatorio, de un solo uso y con vencimiento de 24 horas. El administrador obtiene el enlace una vez al crear la cuenta; también se encola un correo de activación.
- Acudientes se autorregistran y vinculan uno o varios estudiantes con el código generado desde el perfil del estudiante. La relación es muchos a muchos.
- El correo institucional generado no se puede modificar. Estudiantes pueden registrar un correo personal y editar su fecha de cumpleaños desde el perfil.
- SMTP se configura con variables de entorno. Sin configuración, los envíos permanecen pendientes en `email_outbox`; no se incluyen credenciales en el repositorio.

## Institución y evaluación

- La institución guarda un dominio único, nombre, plan y referencias de logo/firma. Admin puede actualizar su dominio y marca. El nombre se puede cambiar como máximo cada 60 días; el servidor guarda la fecha del cambio.
- Admin configura la escala, la nota mínima aprobatoria, el número de periodos y sus pesos. Los pesos deben sumar exactamente 100 %.
- Profesor define actividades por asignatura y periodo; el peso total no puede superar 100 %. Solo se registran notas de actividad cuando sus pesos suman 100 %.
- La planilla masiva permite consultar las actividades y estudiantes de una asignatura, guardar varias notas en una operación y actualizar notas existentes. Las notas vacías no modifican el valor guardado.
- El cálculo de nota requerida usa las ponderaciones de los periodos ya calificados y pendientes. Si supera el máximo de la escala, se informa que no es matemáticamente posible aprobar.
- Admin puede cerrar o reabrir periodos. El cierre requiere que los pesos de periodos y actividades sumen 100 % y bloquea cambios de actividades y calificaciones; solo Admin puede reabrir. Las operaciones sensibles quedan en `audit_log`.
- Los certificados son vistas previas basadas en los datos de Neon, imprimibles desde el navegador; no son documentos oficiales.

## Asistencia, excusas y observaciones

- Profesores registran asistencia en las asignaturas asignadas. Una ausencia genera una alerta de correo al acudiente vinculado y queda en la cola de correo.
- El perfil de profesor distingue los cursos donde dicta asignaturas de aquellos donde es director de grupo. Materias, matrículas, calificaciones y asistencia se limitan a sus asignaciones; la vista de usuarios no está disponible para este rol.
- Acudientes pueden presentar excusas; Admin puede aprobarlas o rechazarlas.
- Profesores registran observaciones solo sobre estudiantes de cursos que tienen asignados. Estudiantes y acudientes vinculados pueden consultarlas.
- `horarios` registra día, hora y aula por asignatura; Admin los administra y el profesor consulta sus propios horarios.

## Modelo relacional

El esquema vigente está en `backend/schema.postgres.sql`; para actualizar una base existente se debe respaldar y ejecutar las migraciones `backend/migrations/001_funcionalidad_roles.sql` y `backend/migrations/002_fecha_nacimiento_estudiante.sql`.

- `instituciones`: dominio, plan, nombre y marca.
- `usuarios`: institución opcional para SuperAdmin, credenciales hash opcionales hasta activar, estado de primer ingreso, correo personal y fecha de cumpleaños.
- `cursos`, `asignaturas`, `horarios`, `matriculas`: estructura académica, aula, dirección de grupo e intensidad horaria.
- `configuracion_institucional`, `periodos`: escala, nota mínima, cantidad y ponderación de periodos, con estado de cierre.
- `actividades`, `notas_actividades` y `calificaciones`: evaluación por actividad y compatibilidad con notas previas.
- `acudientes_estudiantes`: vínculo N:M; la migración conserva relaciones antiguas de `matriculas.acudiente_id`.
- `asistencia`, `excusas`, `observaciones`: seguimiento académico y de convivencia.
- `activaciones_cuenta`, `zetta_sessions`, `email_outbox`: activación segura, sesiones opacas y entrega de mensajes.
- `audit_log`: registro de cambios sensibles con alcance institucional o global.

La tabla raíz `GestionAcademica.sql` contiene el esquema para una instalación nueva y se mantiene alineada con el esquema de backend. Los planes son métricas de uso; no hay cobros reales ni integración con una pasarela de pago.

## Interfaz

La interfaz conserva el tema oscuro glassmórfico, gradientes nocturnos, acentos cian/índigo y tarjetas de navegación por rol. Solo se muestran módulos disponibles para cada perfil. Los estudiantes consultan sus notas por periodo, asistencia y observaciones con profesor y fecha. Las operaciones académicas y la consola administrativa consultan la API; las vistas de certificado muestran de forma explícita que no tienen validez oficial.
