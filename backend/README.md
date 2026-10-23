# Backend ZETTA · Neon PostgreSQL

## Configuración local

1. Copia `backend/.env.example` como `backend/.env` y completa `DATABASE_URL` con la URL de Neon.
   No publiques `.env` ni compartas su contenido. Si la URL ya se incluyó en un
   commit, rótala en Neon: eliminar el archivo del commit actual no borra su
   contenido de la historia anterior.
2. Para una base nueva, ejecuta `backend/schema.postgres.sql`. Para una base con
   datos, haz un respaldo y ejecuta una sola vez
   `backend/migrations/001_funcionalidad_roles.sql`. La migración es aditiva y
   copia las asociaciones de acudientes ya guardadas en `matriculas`.
3. Configura las variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
   `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` para enviar activaciones y alertas.
   Si SMTP no está configurado, los mensajes quedan pendientes en `email_outbox`;
   el enlace de activación se muestra una vez al administrador que creó la cuenta.
4. Desde la raíz del proyecto ejecuta `npm --prefix backend start`.
5. Abre `http://localhost:3000`.

## Despliegue en Render

1. Sube el repositorio a GitHub sin incluir `backend/.env`. En Render, crea un
   Blueprint desde el repositorio; `render.yaml` configura el servicio web,
   instala las dependencias del backend y usa `/api/health` para comprobarlo.
2. Configura `DATABASE_URL` en el servicio con la URL de conexión de Neon.
   Render no crea ni migra esta base de datos automáticamente.
3. En una base nueva, ejecuta `backend/schema.postgres.sql` en Neon antes del
   primer despliegue. Para una base existente, respáldala y ejecuta una sola vez
   `backend/migrations/001_funcionalidad_roles.sql` en lugar del esquema inicial.
4. `PUBLIC_BASE_URL` es opcional: por defecto, los enlaces de activación usan la
   URL pública asignada por Render. Para enviar correos, configura también
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y
   `SMTP_FROM` como variables del servicio. Sin SMTP, los correos quedan en la
   cola de salida y las activaciones se pueden copiar desde el panel Admin.

El servidor consulta tablas PostgreSQL en minúsculas con los nombres definidos en
`schema.postgres.sql`. Ese archivo sirve para una base nueva; no lo ejecutes sobre
una base existente sin revisar antes sus tablas y respaldar los datos.

## Cuentas y sesión

- El login valida correo, contraseña y rol contra `usuarios` en Neon.
- El servidor usa cookies de sesión opacas `HttpOnly`, `SameSite=Strict` y con
  una duración de ocho horas. Las contraseñas nuevas se almacenan con scrypt.
- Las cuentas de estudiantes, profesores y administradores se crean sin
  contraseña; el enlace aleatorio de activación vence en 24 horas y solo puede
  utilizarse una vez. Acudientes se autorregistran y vinculan estudiantes con
  el código mostrado desde el perfil del estudiante.
- Los correos institucionales se generan con el dominio registrado para la
  institución. Los duplicados reciben un sufijo numérico; estudiantes pueden
  actualizar su correo desde su perfil.
- Las sesiones opacas se guardan como hashes en `zetta_sessions`; cerrar sesión
  invalida la sesión en el servidor y eliminar un usuario invalida sus sesiones.
- El formulario público solo registra Acudientes, asociados a una institución
  existente. La creación de los demás perfiles debe hacerse desde la consola
  institucional o por un proceso administrativo autorizado.
- Las rutas CRUD comprueban el rol, la institución y las asignaciones en cada
  consulta. Las vistas del navegador no sustituyen esas comprobaciones.

## Alcance

SuperAdmin registra instituciones, asigna administradores, consulta métricas de
uso por plan y revisa auditoría global. Admin gestiona usuarios, cursos,
materias, horarios, matrículas, parámetros de evaluación, periodos, excusas y
cierres de su institución. Profesor gestiona actividades, notas, asistencia y
observaciones dentro de sus asignaciones. Estudiantes y Acudientes consultan
solo los datos propios o vinculados.

La planilla de notas permite a Admin y Profesor cargar y actualizar en bloque
las calificaciones por actividad de una asignatura. Las celdas vacías conservan
su valor y el servidor rechaza cambios si el periodo está cerrado.

Las ponderaciones de periodos y actividades se validan en el servidor; no se
aceptan notas que excedan el 100 %. El promedio requerido se calcula sobre el
peso pendiente y advierte cuando supera el máximo de la escala. Los cierres
bloquean cambios de calificaciones y solo Admin puede reabrirlos. Los
certificados son vistas previas imprimibles, no documentos oficiales. Las
métricas de facturación muestran planes y uso; no procesan cobros.
