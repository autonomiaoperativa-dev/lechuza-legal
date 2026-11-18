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

### Búsqueda incógnito

Activa el interruptor **Búsqueda incógnito** antes de buscar:

- No se guarda nada en la computadora: ni las listas descargadas ni lo que buscaste.
- "Borrar resultados" limpia la pantalla y los campos.
- En cualquier modo, los nombres y expedientes que escribes **nunca se envían** al Poder Judicial: el
  programa descarga la lista completa del juzgado y busca en tu computadora.

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
