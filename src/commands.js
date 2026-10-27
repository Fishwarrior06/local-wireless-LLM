import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { leerCarpetaRecursiva, formatearContextoCarpeta } from './fs-tools.js';
import { detectarSkill } from './skills-loader.js';

export function procesarInputUsuario(input) {
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

    const regexRepo = /^lee-repo\s*(.*)/i;
    const regexCarpeta = /^lee-carpeta\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexLectura = /^lee\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexEdicion = /^edita\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexEditaRepo = /^edita-repo\s*(.*)/i;

    const matchRepo = promptFinal.match(regexRepo);
    const matchCarpeta = promptFinal.match(regexCarpeta);
    const matchLectura = promptFinal.match(regexLectura);
    const matchEdicion = promptFinal.match(regexEdicion);
    const matchEditaRepo = promptFinal.match(regexEditaRepo);

    if (matchEdicion) {
        modoEdicion = true;
        archivoDestino = (matchEdicion[1] || matchEdicion[2]).trim();
        try {
            const contenido = fs.readFileSync(archivoDestino, 'utf-8');
            contexto += `Código actual de ${archivoDestino}:\n${contenido}\n\n`;
            promptFinal = `Instrucción: ${matchEdicion[3] || 'Optimiza este código'}\n\nREGLA ESTRICTA: Devuelve ÚNICAMENTE el código final modificado. Sin saludos, explicaciones ni bloques markdown.`;
        } catch (e) {
            return { error: `No se encontró el archivo '${archivoDestino}'` };
        }
    } else if (matchEditaRepo) {
        modoEditaRepo = true;
        const instruccion = matchEditaRepo[1] || "Optimiza el repositorio.";
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(config.projectRoot);
            if (archivos.length === 0) {
                return { error: 'No se encontraron archivos compatibles en el repositorio.' };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(config.projectRoot, archivos, totalBytes);
            contexto += `Eres un agente de modificación de código. Se te proporciona el contenido de un repositorio y una instrucción.\nTu tarea es devolver ÚNICAMENTE un array JSON válido con los archivos que necesiten ser modificados.\nCada elemento del array debe tener exactamente dos campos: "ruta" (string con la ruta relativa del archivo) y "contenido" (string con el código completo y final del archivo modificado).\nNo incluyas explicaciones, comentarios, bloques markdown ni texto fuera del JSON.\n\n=== REPOSITORIO ===\n${resumen}===================\n\n`;
            promptFinal = `Instrucción: ${instruccion}`;
            return {
                promptFinal,
                contexto,
                modoEditaRepo: true,
                info: `[Mac: ${archivos.length} archivos del repositorio cargados para edición múltiple (${kbTotal} KB)]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo repositorio: ${e.message}` };
        }
    } else if (matchRepo) {
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(config.projectRoot);
            if (archivos.length === 0) {
                return { error: 'No se encontraron archivos compatibles en el repositorio.' };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(config.projectRoot, archivos, totalBytes);
            contexto += resumen;
            promptFinal = matchRepo[1] || "Analiza la arquitectura y estructura de este repositorio.";
            return {
                promptFinal,
                contexto,
                info: `[Mac: ${archivos.length} archivos del repositorio cargados en contexto (${kbTotal} KB)]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo repositorio: ${e.message}` };
        }
    } else if (matchCarpeta) {
        const rutaObjetivo = (matchCarpeta[1] || matchCarpeta[2]).trim();
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(rutaObjetivo);
            if (archivos.length === 0) {
                return { error: `No se encontraron archivos compatibles en '${rutaObjetivo}'.` };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes);
            contexto += resumen;
            promptFinal = matchCarpeta[3] || "Analiza los archivos de esta carpeta.";
            return {
                promptFinal,
                contexto,
                info: `[Mac: ${archivos.length} archivos de '${rutaObjetivo}' cargados en contexto (${kbTotal} KB)]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo carpeta '${rutaObjetivo}': ${e.message}` };
        }
    } else if (matchLectura) {
        const rutaArchivo = (matchLectura[1] || matchLectura[2]).trim();
        try {
            const stats = fs.statSync(rutaArchivo);
            if (stats.isDirectory()) {
                const { archivos, totalBytes } = leerCarpetaRecursiva(rutaArchivo);
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaArchivo, archivos, totalBytes);
                contexto += resumen;
                promptFinal = matchLectura[3] || "Analiza esta carpeta.";
                return {
                    promptFinal,
                    contexto,
                    info: `[Mac: ${archivos.length} archivos cargados (${kbTotal} KB)]`,
                    skillAplicada
                };
            } else {
                const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
                contexto += `Archivo ${rutaArchivo}:\n${contenido}\n\n`;
                promptFinal = matchLectura[3] || "Analiza este archivo.";
                return {
                    promptFinal,
                    contexto,
                    info: `[Mac: Archivo '${rutaArchivo}' cargado]`,
                    skillAplicada
                };
            }
        } catch (e) {
            return { error: `Error leyendo '${rutaArchivo}': ${e.message}` };
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
