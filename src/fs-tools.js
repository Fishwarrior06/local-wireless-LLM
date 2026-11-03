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

/**
 * Estima el número de tokens de un texto (≈1 token por 3.5 caracteres).
 * @param {string} texto
 * @returns {number}
 */
export function estimarTokens(texto) {
    if (!texto) return 0;
    return Math.ceil(texto.length / 3.5);
}

/**
 * Selecciona los archivos más relevantes para el prompt respetando un presupuesto de tokens.
 * Siempre incluye el mapa estructural (barato, ~400 tokens).
 * Si todos los archivos caben en el budget, los devuelve todos.
 * Si no, puntúa cada archivo por relevancia al prompt y selecciona los mejores.
 *
 * @param {Array<{ruta:string, contenido:string, size:number}>} archivos
 * @param {string} prompt - mensaje del usuario (para scoring de relevancia)
 * @param {number} tokenBudget - tokens disponibles para contexto de archivos (default 10000)
 * @returns {{ seleccionados: Array, todosCaben: boolean, tokensUsados: number, mapa: string }}
 */
export function seleccionarArchivosRelevantes(archivos, prompt, tokenBudget = 10000) {
    if (!archivos || archivos.length === 0) {
        return { seleccionados: [], todosCaben: true, tokensUsados: 0, mapa: '' };
    }

    // Mapa estructural — siempre incluido, coste fijo y pequeño
    const mapa =
        `Workspace (${archivos.length} archivos disponibles):\n` +
        archivos.map(a => `- ${a.ruta}`).join('\n') + '\n';
    const tokensMapas = estimarTokens(mapa);
    const tokenRestante = tokenBudget - tokensMapas;

    // ¿Caben todos los contenidos dentro del budget?
    const tokensContenidoTotal = archivos.reduce((s, a) => s + estimarTokens(a.contenido), 0);
    if (tokensContenidoTotal <= tokenRestante) {
        return {
            seleccionados: archivos,
            todosCaben: true,
            tokensUsados: tokensContenidoTotal + tokensMapas,
            mapa
        };
    }

    // Puntuar relevancia de cada archivo respecto al prompt
    const promptLower = (prompt || '').toLowerCase();
    const palabras = promptLower.split(/\s+/).filter(p => p.length > 3);
    const archivosNucleo = ['main.js', 'package.json', 'config.js', 'index.js', 'app.js', 'agents.md', 'readme.md'];

    const puntuados = archivos.map(archivo => {
        let puntuacion = 0;
        const rutaLower = archivo.ruta.toLowerCase();
        const nombre = path.basename(rutaLower);

        // Máxima prioridad: el archivo es mencionado explícitamente en el prompt
        if (promptLower.includes(nombre) || promptLower.includes(rutaLower)) puntuacion += 100;

        // Prioridad media: alguna palabra del prompt coincide con parte del path
        for (const palabra of palabras) {
            if (rutaLower.includes(palabra)) puntuacion += 10;
        }

        // Pequeño bonus para archivos raíz de referencia
        if (archivosNucleo.includes(nombre)) puntuacion += 5;

        // Penalizar archivos más grandes cuando la puntuación empata
        puntuacion -= archivo.size / 10000;

        return { ...archivo, puntuacion, tokens: estimarTokens(archivo.contenido) };
    });

    puntuados.sort((a, b) => b.puntuacion - a.puntuacion);

    // Llenar con los más relevantes hasta agotar el budget
    const seleccionados = [];
    let tokensUsados = tokensMapas;
    for (const archivo of puntuados) {
        if (tokensUsados + archivo.tokens <= tokenBudget) {
            seleccionados.push(archivo);
            tokensUsados += archivo.tokens;
        }
    }

    return { seleccionados, todosCaben: false, tokensUsados, mapa };
}

/**
 * Formatea el contexto del workspace como mapa estructural + archivos seleccionados.
 * Se usa en cada turno de conversación con workspace activo.
 *
 * @param {string} rutaBase - ruta raíz del workspace
 * @param {Array}  seleccionados - archivos a incluir en el contexto
 * @param {boolean} todosCaben - si false se añade aviso de contexto parcial
 * @param {string} mapa - mapa estructural pre-generado por seleccionarArchivosRelevantes()
 * @returns {string}
 */
export function formatearContextoInteligente(rutaBase, seleccionados, todosCaben, mapa) {
    let resumen = `=== WORKSPACE: ${rutaBase} ===\n` + mapa + '\n';
    if (!todosCaben) {
        resumen += `⚠️ Contexto parcial: se incluyen ${seleccionados.length} archivo(s) más relevantes para esta consulta.\n\n`;
    }
    for (const a of seleccionados) {
        resumen += `--- ARCHIVO: ${a.ruta} ---\n${a.contenido}\n--- FIN: ${a.ruta} ---\n\n`;
    }
    return resumen;
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
