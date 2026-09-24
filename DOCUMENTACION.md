1. Maqueta Estructural e Interfaz de Usuario (UI/UX)
La interfaz de ZETTA implementa una estética traslúcida (Frosted Glass) sobre un fondo oscuro dinámico, estructurada para minimizar la carga cognitiva del usuario mediante acceso rápido flotante.

Componentes de Estilo:
- Barra Isla Flotante (Top Bar): Suspendida a 20px del borde superior con un borde sutil rgba(255, 255, 255, 0.18) y desenfoque de fondo (backdrop-filter blur).
- Tarjetas Glassmorphic: Paneles de información con transparencia suave, sombras proyectadas y bordes reactivos (hover) para interacción visual.
- Paleta de Colores: Fondo base en gradiente oscuro nocturno (#0f172a a #1e1b4b), acentos primarios en cian eléctrico (#38bdf8) e índigo (#818cf8).

2. Matriz Granular de Permisos por Rol
El sistema utiliza un modelo de Control de Acceso Basado en Roles (RBAC) con soporte para aislamiento por institución (Multitenancy):
<img width="1408" height="768" alt="Gemini_Generated_Image_91996k91996k9199" src="https://github.com/user-attachments/assets/43be37a1-d1fc-4376-afe9-2cb81a9770dd" />

3. Desglose Mapeado de Módulos y Funciones:

<img width="717" height="356" alt="image" src="https://github.com/user-attachments/assets/ae7ebfa1-315c-4e60-84ac-db982fb31b71" />

  1. Módulo de Matrículas y Usuarios (Ubicación: Menú Isla -> Matrículas)
  - Gestión de Estudiantes y Cursos: Registro de datos personales, asignación de cursos/grupos (ej. 10°A) y vinculación con acudientes responsables.
  - Asignación Docente: Vinculación de profesores con asignaturas específicas e intensidad horaria semanal.

  2. Módulo Académico y Calificaciones (Ubicación: Menú Isla -> Académico)
  - Ingreso Masivo de Notas: Matriz interactiva para que los profesores ingresen notas por periodo académico.
  - Cálculo Automático: Motor de ponderación por porcentajes (evaluaciones, tareas, talleres) y generación automática de boletines en PDF.
  
  3. Módulo de Control de Asistencia (Ubicación: Menú Isla -> Asistencia)
  - Registro en Tiempo Real: Toma de lista diaria por asignatura con estados (Presente, Ausente, Excusado, Retardo).
  - Alertas Tempranas: Notificación automática al módulo del acudiente en caso de inasistencia no justificada.

  4. Módulo de Configuración y Auditoría (Ubicación: Menú Isla -> Ajustes)
  - Parámetros Institucionales: Escala de valoración académica, número de periodos lectivos y personalización de marca (logos, firmas institucionales).
  - Historial de Cambios: Registro de auditoría (Log) de modificaciones realizadas a las calificaciones o datos sensibles.

4. Diagrama y Estructura de la Base de Datos
La arquitectura relacional utiliza claves primarias tipo UUID para garantizar la seguridad de los registros en entornos distribuidos.

Diccionario de Datos Relacional:

1.INSTITUCIONES

id (PK): Identificador único de la institución.

nombre: Nombre del colegio o universidad.

nit_codigo: Código de registro oficial.

plan_suscripcion: Nivel del servicio (Lite, Standard, Enterprise).

2.USUARIOS

id (PK): Identificador del usuario.

institucion_id (FK): Vinculación con la institución pertenencia.

documento: Número de identificación.

nombre, apellido, email, password_hash.

rol: Rol del usuario dentro del sistema (SuperAdmin, Admin, Profesor, Estudiante, Acudiente).

3. CURSOS

id (PK): Identificador del curso.

institucion_id (FK): Colegio al que pertenece el curso.

nombre: Denominación del grupo (ej. "10°B").

periodo_lectivo: Año escolar en curso.

4. ASIGNATURAS

id (PK): Identificador de la materia.

curso_id (FK): Curso donde se imparte.

profesor_id (FK): Docente a cargo.

nombre: Nombre de la asignatura.

5. MATRICULAS

id (PK): Identificador de la matrícula.

estudiante_id (FK): Usuario con rol estudiante.

curso_id (FK): Curso asignado.

acudiente_id (FK): Usuario con rol acudiente vinculado.

6. CALIFICACIONES

id (PK): Identificador del registro.

matricula_id (FK): Estudiante matriculado.

asignatura_id (FK): Materia correspondiente.

periodo: Número de periodo (1, 2, 3, 4).

nota / porcentaje: Valor numérico y su peso en la nota final.

7. ASISTENCIA

id (PK): Identificador de la asistencia.

matricula_id (FK): Estudiante.

asignatura_id (FK): Materia.

fecha: Día del registro.

estado: Indicador de presencia (Presente, Ausente, Excusado, Retardo).

  
