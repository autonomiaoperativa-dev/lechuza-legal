// Dónde guarda Lechuza Legal sus datos (archivo de listas, caché, registros).
// Por defecto en app/data. Para guardarlos en otro disco (por ejemplo fuera de OneDrive), escribe en
// app/.env una línea como:   LECHUZA_DATOS=D:\LechuzaLegal\datos
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(APP_DIR, '.env')); } catch {}
export const DATOS = process.env.LECHUZA_DATOS ? path.resolve(process.env.LECHUZA_DATOS) : path.join(APP_DIR, 'data');
