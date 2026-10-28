import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { leerCarpetaRecursiva, formatearContextoCarpeta } from './fs-tools.js';
import { detectarSkill } from './skills-loader.js';

function buscarArchivoRecursivo(dir, nombreBuscado, profundidad = 0) {
    if (profundidad > 4) return null;
    let items;
    try {
        items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const item of items) {
        if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'dist' || item.name === 'build' || item.name === '.git') continue;
        const fullPath = path.join(dir, item.name);
        if (item.isFile() && item.name.toLowerCase() === nombreBuscado.toLowerCase()) {
            return fullPath;
        }
        if (item.isDirectory()) {
            const res = buscarArchivoRecursivo(fullPath, nombreBuscado, profundidad + 1);
            if (res) return res;
        }
    }
    return null;
}

function resolverArchivoEnWorkspace(rutaRaiz, rutaParam) {
    if (!rutaParam) return null;
    const clean = rutaParam.trim().replace(/^['"`]|['"`]$/g, '').replace(/[?,;!]+$/, '');
    if (!clean) return null;

    if (path.isAbsolute(clean)) {
        return fs.existsSync(clean) ? clean : null;
    }

    // 1. Probar ruta directa relativa a la raíz del workspace
    const directa = path.join(rutaRaiz, clean);
    if (fs.existsSync(directa)) return directa;

    // 2. Probar ruta relativa a process.cwd()
    if (fs.existsSync(clean)) return path.resolve(clean);

    // 3. Buscar por nombre de archivo dentro del workspace recursivamente
    const soloNombre = path.basename(clean);
    return buscarArchivoRecursivo(rutaRaiz, soloNombre);
}

export function procesarInputUsuario(input, workspacePath = null) {
    let contexto = "";
    let promptFinal = input;
    let modoEdicion = false;
    let modoEditaRepo = false;
    let archivoDestino = "";
    let skillAplicada = null;

    // Normalizar si viene con slash
    const limpio = input.startsWith('/') ? input.slice(1).trim() : input.trim();

    // 1. Detectar si hay alusión o comando de Skill
    const infoSkill = detectarSkill(limpio);
    if (infoSkill) {
        skillAplicada = infoSkill.skill;
        contexto += `[DIRECTRICES DE LA SKILL '${skillAplicada.nombre.toUpperCase()}']:\n${skillAplicada.instrucciones}\n\n`;
        
        // Si fue invocado como /refactorizar <texto> o /skill <nombre> <texto>, extraer la instrucción
        if (infoSkill.resto) {
            promptFinal = infoSkill.resto;
        } else if (infoSkill.tipo === 'comando_explicito') {
            promptFinal = limpio.replace(/^\/?skill\s+[a-zA-Z0-9_-]+\s*/i, '') || `Aplica la skill ${skillAplicada.nombre}`;
        }
    }

    const regexRepo = /^(?:lee-repo|repo|analiza-repo)\s*(.*)/i;
    const regexCarpeta = /^(?:lee-carpeta|carpeta|folder)\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexLectura = /^(?:lee|leer|cat|read|ver|abre|abrir|muestra|mostrar)\s+(?:el\s+archivo\s+|el\s+fichero\s+|archivo\s+|fichero\s+|file\s+)?(?:"([^"]+)"|([^\s\?]+))\s*(.*)/i;
    const regexEdicion = /^(?:edita|editar|modifica|modificar|edit)\s+(?:el\s+archivo\s+|el\s+fichero\s+|archivo\s+|fichero\s+|file\s+)?(?:"([^"]+)"|([^\s\?]+))\s*(.*)/i;
    const regexEditaRepo = /^(?:edita-repo|editar-repo)\s*(.*)/i;

    const matchRepo = promptFinal.match(regexRepo);
    const matchCarpeta = promptFinal.match(regexCarpeta);
    const matchLectura = promptFinal.match(regexLectura);
    const matchEdicion = promptFinal.match(regexEdicion);
    const matchEditaRepo = promptFinal.match(regexEditaRepo);

    const rutaRaizEfectiva = workspacePath || config.projectRoot;

    if (matchEdicion) {
        modoEdicion = true;
        const archivoBuscado = (matchEdicion[1] || matchEdicion[2]).trim();
        const rutaCompleta = resolverArchivoEnWorkspace(rutaRaizEfectiva, archivoBuscado);
        if (!rutaCompleta) {
            return { error: `No se encontró el archivo '${archivoBuscado}' en el workspace.` };
        }
        try {
            const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
            const rutaRelativa = path.relative(rutaRaizEfectiva, rutaCompleta) || archivoBuscado;
            contexto += `Código actual de ${rutaRelativa}:\n${contenido}\n\n`;
            promptFinal = `Instrucción: ${matchEdicion[3] || 'Optimiza este código'}\n\nREGLA ESTRICTA: Devuelve ÚNICAMENTE el código final modificado. Sin saludos, explicaciones ni bloques markdown.`;
            archivoDestino = rutaCompleta;
        } catch (e) {
            return { error: `Error leyendo '${archivoBuscado}' para edición: ${e.message}` };
        }
    } else if (matchEditaRepo) {
        modoEditaRepo = true;
        const instruccion = matchEditaRepo[1] || "Optimiza el repositorio.";
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaRaizEfectiva);
            if (archivos.length === 0) {
                return { error: 'No se encontraron archivos compatibles en el repositorio.' };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaRaizEfectiva, archivos, totalBytes, limitAlcanzado);
            contexto += `Eres un agente de modificación de código. Se te proporciona el contenido de un repositorio y una instrucción.\nTu tarea es devolver ÚNICAMENTE un array JSON válido con los archivos que necesiten ser modificados.\nCada elemento del array debe tener exactamente dos campos: "ruta" (string con la ruta relativa del archivo) y "contenido" (string con el código completo y final del archivo modificado).\nNo incluyas explicaciones, comentarios, bloques markdown ni texto fuera del JSON.\n\n=== REPOSITORIO ===\n${resumen}===================\n\n`;
            promptFinal = `Instrucción: ${instruccion}`;
            return {
                promptFinal,
                contexto,
                modoEditaRepo: true,
                workspaceYaCargado: true,
                info: `[Mac: ${archivos.length} archivos del repositorio cargados para edición múltiple (${kbTotal} KB)${limitAlcanzado ? ' — límite alcanzado' : ''}]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo repositorio: ${e.message}` };
        }
    } else if (matchRepo) {
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaRaizEfectiva);
            if (archivos.length === 0) {
                return { error: 'No se encontraron archivos compatibles en el repositorio.' };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaRaizEfectiva, archivos, totalBytes, limitAlcanzado);
            contexto += resumen;
            promptFinal = matchRepo[1] || "Analiza la arquitectura y estructura de este repositorio.";
            return {
                promptFinal,
                contexto,
                workspaceYaCargado: true,
                info: `[Mac: ${archivos.length} archivos del repositorio cargados en contexto (${kbTotal} KB)${limitAlcanzado ? ' — límite alcanzado' : ''}]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo repositorio: ${e.message}` };
        }
    } else if (matchCarpeta) {
        const rutaParam = (matchCarpeta[1] || matchCarpeta[2]).trim();
        const rutaObjetivo = resolverArchivoEnWorkspace(rutaRaizEfectiva, rutaParam) || path.join(rutaRaizEfectiva, rutaParam);
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaObjetivo);
            if (archivos.length === 0) {
                return { error: `No se encontraron archivos compatibles en '${rutaParam}'.` };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes, limitAlcanzado);
            contexto += resumen;
            promptFinal = matchCarpeta[3] || "Analiza los archivos de esta carpeta.";
            return {
                promptFinal,
                contexto,
                workspaceYaCargado: true,
                info: `[Mac: ${archivos.length} archivos de '${rutaParam}' cargados en contexto (${kbTotal} KB)${limitAlcanzado ? ' — límite alcanzado' : ''}]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo carpeta '${rutaParam}': ${e.message}` };
        }
    } else if (matchLectura) {
        const rutaParam = (matchLectura[1] || matchLectura[2]).trim();
        const rutaEncontrada = resolverArchivoEnWorkspace(rutaRaizEfectiva, rutaParam);
        if (!rutaEncontrada) {
            return { error: `No se encontró el archivo o carpeta '${rutaParam}' en el workspace actual (${rutaRaizEfectiva}).` };
        }
        try {
            const stats = fs.statSync(rutaEncontrada);
            if (stats.isDirectory()) {
                const { archivos, totalBytes } = leerCarpetaRecursiva(rutaEncontrada);
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaEncontrada, archivos, totalBytes);
                contexto += resumen;
                promptFinal = matchLectura[3] || "Analiza esta carpeta.";
                return {
                    promptFinal,
                    contexto,
                    info: `[Mac: ${archivos.length} archivos de '${rutaParam}' cargados (${kbTotal} KB)]`,
                    skillAplicada
                };
            } else {
                const contenido = fs.readFileSync(rutaEncontrada, 'utf-8');
                const rutaRelativa = path.relative(rutaRaizEfectiva, rutaEncontrada) || rutaParam;
                contexto += `=== CONTENIDO DE: ${rutaRelativa} ===\n${contenido}\n=== FIN ARCHIVO: ${rutaRelativa} ===\n\n`;
                promptFinal = matchLectura[3] || "Analiza este archivo y responde en base a su código y estructura.";
                const kb = (Buffer.byteLength(contenido, 'utf-8') / 1024).toFixed(1);
                return {
                    promptFinal,
                    contexto,
                    info: `[Mac: Archivo '${rutaRelativa}' cargado (${kb} KB)]`,
                    skillAplicada
                };
            }
        } catch (e) {
            return { error: `Error leyendo '${rutaParam}': ${e.message}` };
        }
    }

    // Detección automática en lenguaje natural si se menciona un archivo existente en el workspace
    if (rutaRaizEfectiva) {
        const regexArchivoMencion = /(?:^|\s)["']?([a-zA-Z0-9_\-\.\/]+\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|md|txt|py|java|c|cpp|h|rs|go|sh|yaml|yml|toml|sql))["']?(?:\?|\!|,|\s|$)/gi;
        let match;
        const archivosInyectados = [];
        while ((match = regexArchivoMencion.exec(promptFinal)) !== null) {
            const candidato = match[1];
            const ruta = resolverArchivoEnWorkspace(rutaRaizEfectiva, candidato);
            if (ruta && fs.existsSync(ruta) && fs.statSync(ruta).isFile() && !archivosInyectados.includes(ruta)) {
                try {
                    const contenido = fs.readFileSync(ruta, 'utf-8');
                    const rutaRelativa = path.relative(rutaRaizEfectiva, ruta) || candidato;
                    contexto += `=== CONTENIDO DE: ${rutaRelativa} ===\n${contenido}\n=== FIN ARCHIVO: ${rutaRelativa} ===\n\n`;
                    archivosInyectados.push(ruta);
                } catch {}
            }
        }
        if (archivosInyectados.length > 0) {
            const nombres = archivosInyectados.map(r => path.relative(rutaRaizEfectiva, r)).join(', ');
            return {
                promptFinal,
                contexto,
                info: `[Mac: Archivo(s) '${nombres}' inyectado(s) al contexto]`,
                skillAplicada
            };
        }
    }

    return {
        promptFinal,
        contexto,
        modoEdicion,
        modoEditaRepo,
        archivoDestino,
        skillAplicada
    };
}
