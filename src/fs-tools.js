import fs from 'fs';
import path from 'path';

export const IGNORAR_DIRS = new Set([
    'node_modules', '.git', '.DS_Store', 'dist', 'build', 'coverage', '.next', '.gemini', 'vendor', '.cache'
]);

export const EXTENSIONES_VALIDAS = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.json',
    '.md', '.txt', '.py', '.java', '.c', '.cpp', '.h', '.rs', '.go', '.sh',
    '.yaml', '.yml', '.toml', '.sql', '.env.example'
]);

export const IGNORAR_ARCHIVOS = new Set([
    '.env', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
]);

export function leerCarpetaRecursiva(rutaBase, maxArchivos = 80, maxBytes = 600 * 1024) {
    let archivosLeidos = [];
    let totalBytes = 0;
    let archivosOmitidos = 0; // Archivos que existían pero se saltaron por límites
    let limitAlcanzado = false;

    function recorrer(dirActual, profundidad = 0) {
        if (profundidad > 6 || archivosLeidos.length >= maxArchivos) return;

        let items;
        try {
            items = fs.readdirSync(dirActual, { withFileTypes: true });
        } catch {
            return;
        }

        for (const item of items) {
            if (archivosLeidos.length >= maxArchivos || totalBytes >= maxBytes) {
                limitAlcanzado = true;
                break;
            }

            const nombre = item.name;
            const rutaCompleta = path.join(dirActual, nombre);
            const rutaRelativa = path.relative(rutaBase, rutaCompleta) || nombre;

            if (item.isDirectory()) {
                if (!IGNORAR_DIRS.has(nombre) && !nombre.startsWith('.')) {
                    recorrer(rutaCompleta, profundidad + 1);
                }
            } else if (item.isFile()) {
                if (IGNORAR_ARCHIVOS.has(nombre) || nombre.startsWith('.')) continue;

                const ext = path.extname(nombre).toLowerCase();
                if (EXTENSIONES_VALIDAS.has(ext) || nombre.toLowerCase() === 'license' || nombre.toLowerCase() === 'dockerfile') {
                    try {
                        const stats = fs.statSync(rutaCompleta);
                        if (stats.size > 150 * 1024) {
                            // Archivo individual demasiado grande: registrar en omitidos
                            archivosOmitidos++;
                            continue;
                        }
                        if (totalBytes + stats.size > maxBytes) {
                            limitAlcanzado = true;
                            break;
                        }

                        const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
                        totalBytes += stats.size;
                        archivosLeidos.push({ ruta: rutaRelativa, contenido, size: stats.size });
                    } catch {}
                }
            }
        }
    }

    recorrer(rutaBase, 0);
    return { archivos: archivosLeidos, totalBytes, limitAlcanzado, archivosOmitidos };
}

export function formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes, limitAlcanzado = false) {
    const kbTotal = (totalBytes / 1024).toFixed(1);
    const avisoLimite = limitAlcanzado
        ? `\n⚠️ NOTA: Se alcanzó el límite de carga. Solo se incluyen ${archivos.length} archivos (${kbTotal} KB). El workspace puede contener más archivos no mostrados aquí.\n`
        : '';
    let resumen = `=== REPOSITORIO / CARPETA: ${rutaObjetivo} (${archivos.length} archivos, ${kbTotal} KB) ===\n`;
    resumen += avisoLimite;
    resumen += `Estructura de archivos incluidos:\n` + archivos.map(a => `- ${a.ruta}`).join('\n') + `\n\n`;
    for (const a of archivos) {
        resumen += `--- INICIO ARCHIVO: ${a.ruta} ---\n${a.contenido}\n--- FIN ARCHIVO: ${a.ruta} ---\n\n`;
    }
    resumen += `====================================================\n\n`;
    return { resumen, kbTotal };
}
