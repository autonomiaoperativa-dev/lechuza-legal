# Lechuza Legal (versión de prueba)

Buscador de listas de acuerdos del Poder Judicial del Estado de San Luis Potosí. Descarga las listas
oficiales (PDF), las lee y busca números de expediente y nombres. Tiene una pestaña para comparar sus
resultados contra los de Buholegal.

Es información de apoyo, no asesoría legal, y no sustituye la revisión del expediente oficial.

## Usarlo en línea (sin instalar nada)

**https://lechuza-legal.onrender.com**

Está en el plan gratuito de Render: si nadie la usa en 15 minutos se "duerme", y la primera visita
después tarda cerca de 1 minuto en abrir. Luego funciona normal.

## Instalarlo en tu computadora (opcional)

1. Instala **Node.js** (versión LTS) desde https://nodejs.org, si no lo tienes.
2. Descarga este proyecto: botón verde **Code → Download ZIP** en GitHub, y descomprímelo.
   (O con Git: `git clone <dirección del repositorio>`.)
3. **Windows:** doble clic en `ABRIR LECHUZA LEGAL.bat`. La primera vez instala lo necesario.
   **Mac o Linux:** en una terminal dentro de la carpeta, `npm install` y luego `npm start`.
4. Se abre `http://localhost:3077` en el navegador. Para apagarlo, cierra la ventana negra.

Funciona solo en la computadora de cada quien: no hay un servidor compartido.

## Cómo probarlo

1. Pestaña **Buscar**: escribe expedientes (ej. `954/2014`) o nombres, elige fechas y juzgados, y presiona Buscar.
2. Pestaña **Comparar con Buholegal**: busca lo mismo en Buholegal y pega lo que te reporta
   (una línea por expediente, con fecha si la tienes). Verás qué encontraron ambos y qué solo uno.
3. Si algo falla o no coincide, anota el juzgado, la fecha y el expediente, y repórtalo.

### Resumen por expediente y PDF

Cuando una búsqueda encuentra acuerdos de un expediente, aparece la sección **Resumen por expediente**:
una ficha por expediente y juzgado con el tipo de juicio, las partes, cuántos acuerdos hay y una línea
de tiempo. Cada acuerdo trae una o dos frases del texto oficial, etiquetas (Admisión, Audiencia,
Sentencia, Recurso…), los plazos que menciona ("término de 3 días") y los montos.

**Descargar PDF** (en cada ficha, o "de todos") genera el resumen en PDF; con "incluir texto completo"
agrega el texto íntegro de cada acuerdo. El resumen es automático (extractivo): no inventa ni interpreta,
y no es asesoría legal. El PDF se genera al momento y no se guarda en el servidor.

### Búsqueda incógnito

Activa el interruptor **Búsqueda incógnito** antes de buscar:

- No se guarda nada en la computadora: ni las listas descargadas ni lo que buscaste.
- "Borrar resultados" limpia la pantalla y los campos.
- En cualquier modo, los nombres y expedientes que escribes **nunca se envían** al Poder Judicial: el
  programa descarga la lista completa del juzgado y busca en tu computadora.

### Historial de búsquedas

La pestaña **Historial** guarda cada búsqueda (en este navegador): qué se buscó, juzgados, periodo,
listas revisadas, resultados y si ese expediente o nombre ya tiene alerta. Se puede **repetir** una
búsqueda o **crear la alerta** desde ahí. Las búsquedas en modo incógnito no se guardan.

Arriba de los resultados aparece el **Resumen de la búsqueda** (identidad, juzgado, listas revisadas,
fechas, actor, demandado y número de acuerdos), y cada expediente se puede bajar en **CSV** o **PDF**.

## Antecedentes legales (en la versión instalada)

La pestaña **Antecedentes** busca a una persona física (nombre y apellidos) o moral (razón social) en
**todas las listas de acuerdos de SLP** del periodo elegido (1, 3, 5 o 10 años) y arma un reporte:
resumen de la consulta, participación (expedientes, como demandado, como actor), análisis de homonimia,
resultados por materia y por juzgado, cada expediente con su línea de tiempo y las fuentes consultadas.
Se descarga en **PDF** (con "Detalle", incluye el texto de cada acuerdo) y **CSV**, y desde el reporte se
puede crear una **alerta por nombre**. Tiene su propio historial de búsquedas.

El nombre debe aparecer **completo y con las palabras juntas** (en orden normal o con los apellidos
primero), para no mezclar a personas distintas. CURP solo se anota como referencia: las listas no la
publican. Cédulas, edictos y CURP aparecen como "no consultado en esta versión".

**Situación ante el SAT:** el reporte busca a la persona (por nombre completo y, si se da, por RFC) en
los listados públicos del SAT (Datos Abiertos): artículo 69-B (EFOS: presuntos, definitivos, desvirtuados,
sentencias favorables) y artículo 69 (créditos cancelados y condonados). `node sat.js` los descarga al
archivo local (unos 232 mil registros); `ACTUALIZAR ARCHIVO.bat` los vuelve a bajar solo si el SAT los
cambió. Fuente: https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html

**Posibles variantes:** si escribes el apellido materno, el reporte también busca "nombre + apellido
paterno" y muestra aparte los expedientes donde la persona aparece **sin** segundo apellido (y sin otro
nombre pegado antes o después). No se suman al resultado: son para revisar uno por uno.

## Configuración opcional (archivo `app/.env`, no se sube a GitHub)

```
LECHUZA_DATOS=D:\LechuzaLegal\datos     # carpeta de datos (por defecto app\data)
LECHUZA_CLAVE=una-clave-larga            # si existe, la página pide esta clave para entrar
```

La clave de acceso también se puede poner como variable de entorno en Render. Tras 5 intentos fallidos
se bloquea 10 minutos.

## Alertas (en la versión instalada)

Una alerta revisa **cada mañana** las listas nuevas y avisa por correo si hay movimiento:

- **Por expediente:** un número (NNN/AAAA) en uno, varios o todos los juzgados.
- **Por nombre:** una persona o empresa como parte del juicio (o en todo el texto del acuerdo).

Se crean en la pestaña **Alertas** (o con "Crear alerta" en una ficha o en el historial). Cada alerta
tiene un nombre para reconocerla y el correo de quien recibe los avisos. Lo encontrado queda en
**Novedades**. Empiezan a revisar desde el día en que se crean; lo anterior se ve con una búsqueda normal.

La revisión corre con `ACTUALIZAR ARCHIVO.bat` (programado a las 9:00) o con "Revisar ahora".
Necesita el archivo local, por eso no funciona en la versión en línea.

**Configurar el correo de envío:** crea el archivo `app/.env` (no se sube a GitHub) con:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=cuenta-de-envio@gmail.com
SMTP_PASS=contraseña-de-aplicación
SMTP_FROM=Lechuza Legal <cuenta-de-envio@gmail.com>
```

Con Gmail se usa una "contraseña de aplicación" (Cuenta de Google → Seguridad → Verificación en dos
pasos → Contraseñas de aplicaciones), no la contraseña normal.

## Archivo local: búsquedas de años en segundos (en tu computadora)

Para buscar en muchos años sin esperar descargas, Lechuza Legal puede guardar todas las listas en un
archivo local (`data/lechuza.db`, una base de datos SQLite con índice de texto).

1. Doble clic en `DESCARGAR ARCHIVO.bat`. Baja los últimos 10 años de los 73 juzgados, de lo más
   reciente a lo más antiguo, con 3 descargas a la vez para no saturar el sitio oficial
   (~47 listas por minuto, unos 3 días en total, ~15 GB). Se puede cerrar y volver a abrir: retoma donde iba.
2. Abre Lechuza Legal como siempre (`ABRIR LECHUZA LEGAL.bat`). Lo que ya esté en el archivo se busca al
   instante (cientos de miles de listas en menos de un segundo) y solo se descarga lo que falte.
3. Para mantenerlo al día: `ACTUALIZAR ARCHIVO.bat` baja lo que falte de las últimas 2 semanas, sin abrir
   ventana. Se puede programar en Windows (Programador de tareas) para que corra solo cada mañana; puede
   correr mientras sigue la descarga grande.

Otras opciones: `--desde=2020-01-01`, `--juzgados=1C,2C`, `--descargas=2`.
El archivo contiene nombres publicados en las listas: es solo para uso del despacho y nunca se sube a GitHub.
La versión en línea (Render) no tiene archivo local; ahí cada búsqueda descarga del sitio oficial.

## Qué hace por dentro

1. Por cada juzgado y día hábil descarga el PDF oficial:
   `https://www.stjslp.gob.mx/Archivos/Listas/tradicionales/<CÓDIGO><DDMMAA>.pdf`
2. Lo convierte en texto y lo separa por acuerdo ("Expediente:", "Causa Penal", "Toca", "Carpeta").
3. Busca números de expediente y nombres (sin acentos ni mayúsculas).

En modo normal, las listas descargadas se guardan en `data/` para no pedirlas otra vez.

## Archivos

- `server.js`: servidor local (Node).
- `slp.js`: descarga, lectura del PDF y búsqueda para SLP.
- `fuentes/slp_juzgados.csv`: los 75 juzgados y salas con su código.
- `fuentes/investigacion_*.json`: 70 fuentes jurídicas revisadas el 18-11-2026 (pestaña Fuentes).
- `public/`: la pantalla (HTML, CSS, JS).

## Límites conocidos

- Máximo 1,500 listas por búsqueda (juzgados × días hábiles), con 4 descargas a la vez. Se puede cambiar con
  las variables `MAX_LISTAS` y `MAX_DESCARGAS`. El sitio oficial tiene listas desde el 3 de noviembre de 2010.
- Las listas reservadas ("SECRETO") solo traen números, sin partes.
- Si el PDF separa dígitos ("37 8/2026"), ese expediente puede no encontrarse.
- Un nombre igual no prueba que sea la misma persona (homónimos).
