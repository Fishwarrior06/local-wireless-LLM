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

/**
 * Detecta si el texto del usuario en lenguaje natural solicita crear una carpeta/directorio.
 * Soporta español e inglés, singular, plural y variaciones comunes (carpet, carpets, carpetas, folders, etc.).
 * Ej:
 *  - "Crea una carpeta llamada \"test\" dentro de la carpeta \"src\""
 *  - "crea la carpets test dentro de la carpeta src del repositorio"
 *  - "create a folder named test inside of src"
 *  - "make folder src/test"
 * Retorna la ruta relativa normalizada (ej: "src/test") o null.
 */
function extraerIntencionCrearCarpeta(texto) {
    if (!texto) return null;

    // Normalizar comillas y limpiar sufijos comunes como "del repositorio", "en el repo", etc.
    const limpio = texto.replace(/["'`]/g, ' ')
                        .replace(/\b(?:del|en\s+el|de\s+este|in\s+the|from\s+the)\s+(?:repositorio|repo|workspace|proyecto|project)\b/gi, ' ');

    const regexDir = '(?:carpeta|carpetas|carpets?|directorio|directorios|folder|folders|directory|directories|dir)';

    // Caso 1: ... carpeta [llamada/named] X (adentro de|dentro de|inside of|inside|in|en) [la carpeta] Y
    const m1 = limpio.match(new RegExp(`\\b${regexDir}\\s+(?:llamad[ao]|called|named)?\\s*([^\\s]+)\\s+(?:adentro\\s+de|dentro\\s+de|inside\\s+of|inside|in|en)\\s+(?:la\\s+carpeta\\s+|el\\s+directorio\\s+|the\\s+folder\\s+|the\\s+directory\\s+|${regexDir}\\s+)?([^\\s\\.,;!]+)`, 'i'));
    if (m1) {
        const sub = m1[1].replace(/^[\\/]+|[\\/]+$/g, '');
        const padre = m1[2].replace(/^[\\/]+|[\\/]+$/g, '');
        const stopWords = ['a', 'the', 'una', 'la', 'el', 'de', 'of', 'en', 'in'];
        if (sub && padre && !stopWords.includes(sub.toLowerCase()) && !stopWords.includes(padre.toLowerCase())) {
            return `${padre}/${sub}`;
        }
    }

    // Caso 2: (adentro de|dentro de|inside of|inside|in|en) [la carpeta] Y ... crea [la carpeta] X
    const m2 = limpio.match(new RegExp(`(?:adentro\\s+de|dentro\\s+de|inside\\s+of|inside|in|en)\\s+(?:la\\s+carpeta\\s+|el\\s+directorio\\s+|the\\s+folder\\s+|the\\s+directory\\s+|${regexDir}\\s+)?([^\\s\\.,;!]+)[\\s,]+(?:crea|crear|haz|hacer|create|make|mkdir)\\s+(?:una\\s+|la\\s+|a\\s+|the\\s+)?${regexDir}\\s+(?:llamad[ao]|called|named)?\\s*([^\\s\\.,;!]+)`, 'i'));
    if (m2) {
        const padre = m2[1].replace(/^[\\/]+|[\\/]+$/g, '');
        const sub = m2[2].replace(/^[\\/]+|[\\/]+$/g, '');
        const stopWords = ['a', 'the', 'una', 'la', 'el', 'de', 'of'];
        if (sub && padre && !stopWords.includes(padre.toLowerCase()) && !stopWords.includes(sub.toLowerCase())) {
            return `${padre}/${sub}`;
        }
    }

    // Caso 3: crea/create [la|a] carpeta [llamada] <ruta>
    const m3 = limpio.match(new RegExp(`\\b(?:crea|crear|haz|hacer|create|make|mkdir|new)\\s+(?:una\\s+|la\\s+|a\\s+|the\\s+)?${regexDir}\\s+(?:llamad[ao]|called|named)?\\s*([a-zA-Z0-9_\\-\\.\\/]+)`, 'i'));
    if (m3) {
        const candidata = m3[1].replace(/^[\\/]+|[\\/]+$/g, '');
        const stopWords = ['una', 'la', 'el', 'un', 'nuevo', 'nueva', 'a', 'the', 'new'];
        if (candidata && !stopWords.includes(candidata.toLowerCase())) {
            return candidata;
        }
    }

    return null;
}

/**
 * Extrae si el usuario quiere crear o generar un archivo específico.
 * Ejemplos:
 *   - "crea un nuevo AGENT.md basado en este archivo" -> "AGENT.md"
 *   - "crea el archivo AGENT.md" -> "AGENT.md"
 *   - "genera un AGENT.md para este repo" -> "AGENT.md"
 *   - "escribe un README.md" -> "README.md"
 *   - "crea src/index.js con la api" -> "src/index.js"
 */
function extraerIntencionArchivoIndividual(texto) {
    if (!texto) return null;
    const m = texto.match(/\b(?:crea|crear|genera|generar|haz|hacer|escribe|escribir|create|generate|write|make|new)\s+(?:un\s+|una\s+|el\s+|la\s+|new\s+|the\s+|a\s+)?(?:nuevo\s+|nueva\s+)?(?:archivo\s+|fichero\s+|file\s+)?(["']?[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+["']?)/i);
    if (!m) return null;
    const candidata = m[1].replace(/["']/g, '').trim();
    const ignorar = ['node_modules', '.git', 'dist', 'build'];
    if (ignorar.some(ig => candidata.toLowerCase().includes(ig))) return null;
    if (/\.[a-zA-Z0-9]{1,8}$/.test(candidata)) {
        return candidata;
    }
    return null;
}

/**
 * Detecta si el texto en lenguaje natural expresa intención de escribir/crear/modificar código en el workspace.
 * Soporta tanto español como inglés (create, update, edit, modify, change, add, write, etc.).
 */
function detectarIntencionEdicionAutonoma(texto) {
    if (!texto) return false;
    const regexAccion = /\b(?:crea|crear|genera|generar|agrega|agregar|añade|añadir|haz|hacer|escribe|escribir|modifica|modificar|edita|editar|actualiza|actualizar|corrige|corregir|implementa|implementar|create|creating|make|making|add|adding|write|writing|generate|generating|modify|modifying|edit|editing|update|updating|change|changing|fix|fixing|refactor|refactoring|implement|implementing)\b/i;
    const regexObjetivo = /\b(?:archivo|archivos|fichero|ficheros|test|tests|testing|prueba|pruebas|unit\s*tests?|código|codigo|code|función|funcion|function|functions|método|metodo|method|methods|clase|class|classes|módulo|modulo|module|modules|component|components|componente|componentes|endpoint|endpoints|file|files|\.(?:js|ts|jsx|tsx|html|css|json|py|md|sh))\b/i;
    return regexAccion.test(texto) && regexObjetivo.test(texto);
}

export function procesarInputUsuario(input, workspacePath = null) {
    let contexto = "";
    let promptFinal = input;
    let modoEdicion = false;
    let modoEditaRepo = false;
    let modoCreacion = false;
    let archivoDestino = "";
    let skillAplicada = null;

    // Normalizar si viene con slash
    const limpio = input.startsWith('/') ? input.slice(1).trim() : input.trim();

    // 1. Detectar si hay alusión o comando de Skill
    const infoSkill = detectarSkill(limpio);
    if (infoSkill) {
        skillAplicada = infoSkill.skill;
        contexto += `[DIRECTRICES DE LA SKILL '${skillAplicada.nombre.toUpperCase()}']:\n${skillAplicada.instrucciones}\n\n`;
        
        if (skillAplicada.nombre === 'testear') {
            contexto += `[FORMATO OBLIGATORIO]: Genera siempre todo el código de las pruebas dentro de bloques de código Markdown (\`\`\`lenguaje\\n...\\n\`\`\`). Nunca devuelvas código en texto plano.\n\n`;
        }

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
    // Comando /crea: crea un archivo nuevo (y su carpeta si no existe) con contenido generado por la IA
    const regexCreacion = /^(?:crea|crear|new|nuevo|genera|generar)\s+(?:un\s+|una\s+|el\s+|la\s+|new\s+|the\s+|a\s+)?(?:nuevo\s+|nueva\s+)?(?:archivo\s+|fichero\s+|file\s+)?(?:"([^"]+)"|([a-zA-Z0-9_\-\.\/]+))\s*(.*)/i;

    const matchRepo = promptFinal.match(regexRepo);
    const matchCarpeta = promptFinal.match(regexCarpeta);
    const matchLectura = promptFinal.match(regexLectura);
    const matchEdicion = promptFinal.match(regexEdicion);
    const matchEditaRepo = promptFinal.match(regexEditaRepo);
    const matchCreacion = promptFinal.match(regexCreacion);

    const rutaRaizEfectiva = workspacePath || config.projectRoot;

    // ── 1. Comandos explícitos o prefijados ────────────────────────────────────

    // A. Lectura de archivo o carpeta (/lee <archivo|carpeta> [instrucción])
    if (matchLectura) {
        const rutaParam = (matchLectura[1] || matchLectura[2]).trim();
        const rutaEncontrada = resolverArchivoEnWorkspace(rutaRaizEfectiva, rutaParam) || (fs.existsSync(rutaParam) ? rutaParam : null);
        if (!rutaEncontrada) {
            return { error: `No se encontró el archivo o carpeta '${rutaParam}'.` };
        }
        try {
            const stats = fs.statSync(rutaEncontrada);
            if (stats.isDirectory()) {
                const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaEncontrada);
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaEncontrada, archivos, totalBytes, limitAlcanzado);
                contexto += resumen;
                promptFinal = matchLectura[3] || "Analiza esta carpeta.";
                return {
                    promptFinal,
                    contexto,
                    workspaceYaCargado: true,
                    info: `[Mac: ${archivos.length} archivos de '${rutaParam}' cargados (${kbTotal} KB)]`,
                    skillAplicada
                };
            } else {
                const contenido = fs.readFileSync(rutaEncontrada, 'utf-8');
                const rutaRelativa = path.relative(rutaRaizEfectiva, rutaEncontrada) || rutaParam;
                contexto += `=== ARCHIVO DE REFERENCIA / EJEMPLO (${rutaRelativa}) ===\n${contenido}\n=== FIN ARCHIVO DE REFERENCIA ===\n\n`;

                const instruccionRestante = matchLectura[3] ? matchLectura[3].trim() : '';
                const archivosCargados = [rutaRelativa];

                // Escanear si hay archivos adicionales mencionados en la instrucción (ej: "y el readme.md")
                const regexArchivoMencion = /(?:^|\s)["']?([a-zA-Z0-9_\-\.\/]+\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|md|txt|py|java|c|cpp|h|rs|go|sh|yaml|yml|toml|sql))["']?(?:\?|\!|,|\s|$)/gi;
                let mArch;
                while ((mArch = regexArchivoMencion.exec(instruccionRestante)) !== null) {
                    const candidato = mArch[1];
                    const rutaSec = resolverArchivoEnWorkspace(rutaRaizEfectiva, candidato) || (fs.existsSync(candidato) ? candidato : null);
                    if (rutaSec && fs.existsSync(rutaSec) && fs.statSync(rutaSec).isFile() && !archivosCargados.some(a => a.toLowerCase() === candidato.toLowerCase())) {
                        try {
                            const contSec = fs.readFileSync(rutaSec, 'utf-8');
                            const relSec = path.relative(rutaRaizEfectiva, rutaSec) || candidato;
                            contexto += `=== CONTENIDO DE: ${relSec} ===\n${contSec}\n=== FIN ARCHIVO: ${relSec} ===\n\n`;
                            archivosCargados.push(relSec);
                        } catch {}
                    }
                }

                const targetIndividual = extraerIntencionArchivoIndividual(instruccionRestante);

                if (targetIndividual) {
                    // El usuario adjuntó un archivo de ejemplo y pidió crear/generar otro archivo específico (ej: AGENT.md)
                    const rutaDestino = path.isAbsolute(targetIndividual)
                        ? targetIndividual
                        : path.join(rutaRaizEfectiva, targetIndividual);

                    promptFinal = `Instrucción: ${instruccionRestante}\n\n` +
                        `TAREA: Basándote en el archivo de referencia adjunto y en la estructura real del repositorio actual, ` +
                        `genera el contenido completo, detallado y profesional para el archivo '${targetIndividual}'. ` +
                        `Devuelve el contenido completo listo para ser guardado (sin textos de introducción ni despedidas).`;

                    return {
                        promptFinal,
                        contexto,
                        modoCreacion: true,
                        archivoDestino: rutaDestino,
                        info: `[Mac: Archivo(s) '${archivosCargados.join(', ')}' cargado(s) — Generando '${targetIndividual}']`,
                        skillAplicada
                    };
                }

                promptFinal = instruccionRestante || "Analiza este archivo de referencia y responde en base a su estructura y contenido.";
                const kb = (Buffer.byteLength(contenido, 'utf-8') / 1024).toFixed(1);
                return {
                    promptFinal,
                    contexto,
                    info: `[Mac: Archivo(s) '${archivosCargados.join(', ')}' cargado(s) (${kb} KB)]`,
                    skillAplicada
                };
            }
        } catch (e) {
            return { error: `Error leyendo '${rutaParam}': ${e.message}` };
        }
    }

    // B. Creación de un archivo individual (/crea <archivo> <instrucción>)
    if (matchCreacion) {
        modoCreacion = true;
        const rutaParam = (matchCreacion[1] || matchCreacion[2]).trim();
        const instruccion = matchCreacion[3] || 'Genera el contenido apropiado para este archivo.';

        const rutaAbsoluta = path.isAbsolute(rutaParam)
            ? rutaParam
            : path.join(rutaRaizEfectiva, rutaParam);

        if (fs.existsSync(rutaAbsoluta) && fs.statSync(rutaAbsoluta).isFile()) {
            const contenidoExistente = fs.readFileSync(rutaAbsoluta, 'utf-8');
            contexto += `Contenido actual de ${rutaParam}:\n${contenidoExistente}\n\n`;
        }

        promptFinal = `Instrucción: ${instruccion}\n\nREGLA: Genera el contenido completo y bien estructurado del archivo '${rutaParam}'. Devuelve el contenido listo para guardar sin bloques conversacionales extras.`;
        archivoDestino = rutaAbsoluta;

        return {
            promptFinal,
            contexto,
            modoCreacion: true,
            archivoDestino: rutaAbsoluta,
            info: `[Creando archivo: ${rutaParam}]`,
            skillAplicada
        };
    }

    // C. Edición de un archivo individual (/edita <archivo> <instrucción>)
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
            return {
                promptFinal,
                contexto,
                modoEdicion: true,
                archivoDestino: rutaCompleta,
                info: `[Modificando archivo: ${rutaRelativa}]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo '${archivoBuscado}' para edición: ${e.message}` };
        }
    }

    // D. Lectura de repositorio (/lee-repo [pregunta])
    if (matchRepo) {
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
    }

    // E. Lectura de carpeta (/lee-carpeta <directorio>)
    if (matchCarpeta) {
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
    }

    // F. Edición multi-archivo explícita (/edita-repo <instrucción>)
    if (matchEditaRepo) {
        modoEditaRepo = true;
        const instruccion = matchEditaRepo[1] || "Optimiza el repositorio.";
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaRaizEfectiva);
            if (archivos.length === 0) {
                return { error: 'No se encontraron archivos compatibles en el repositorio.' };
            }
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaRaizEfectiva, archivos, totalBytes, limitAlcanzado);

            const instruccionSistema = [
                `Eres un agente autónomo de creación y modificación de código.`,
                `TAREA: Analiza el repositorio proporcionado y aplica la instrucción del usuario generando los archivos necesarios.`,
                `FORMATO DE RESPUESTA OBLIGATORIO:`,
                `  Devuelve EXCLUSIVAMENTE un array JSON válido. Sin texto previo, sin explicaciones, sin bloques markdown.`,
                `  Cada elemento debe tener:`,
                `    - "ruta": ruta relativa del archivo desde la raíz del workspace`,
                `    - "contenido": código completo y funcional del archivo`,
                `REGLAS ABSOLUTAS:`,
                `  - NUNCA escribas texto antes del JSON. Tu primera respuesta debe ser el carácter [`,
                `  - NUNCA uses bloques \`\`\`json ni \`\`\` de ningún tipo`,
                `  - NUNCA expliques lo que vas a hacer. Solo genera el JSON.`,
                `  - Puedes crear archivos en rutas nuevas (las carpetas se crean automáticamente)`,
            ].join('\n');

            const promptEditaRepo = [
                `=== REPOSITORIO ===`,
                resumen,
                `===================`,
                ``,
                `INSTRUCCIÓN DEL USUARIO: ${instruccion}`,
                ``,
                `IMPORTANTE: Responde ÚNICAMENTE con el array JSON. Empieza con [`,
            ].join('\n');

            return {
                promptFinal: promptEditaRepo,
                contexto: '',
                modoEditaRepo: true,
                instruccionSistema,
                workspaceYaCargado: true,
                info: `[Mac: ${archivos.length} archivos del repositorio cargados para edición múltiple (${kbTotal} KB)${limitAlcanzado ? ' — límite alcanzado' : ''}]`,
                skillAplicada
            };
        } catch (e) {
            return { error: `Error leyendo repositorio: ${e.message}` };
        }
    }

    // ── 2. Detección en Lenguaje Natural (sin prefijo de comando) ─────────────

    // A. Creación de carpeta pura (ej: "crea una carpeta llamada test en src")
    const carpetaSolicitada = extraerIntencionCrearCarpeta(promptFinal);
    const regexPideCodigoReal = /\b(?:unit\s*tests?|pruebas?\s+unitarias?|archivos?|ficheros?|files?|código|codigo|code|escribe|escribir|genera|generar|implementa|implementar|donde\s+ir[aá]n|para\s+verificar|verifiquemos|nesecitemos|necesitemos|tests?\s+que)\b/i;
    const pideCodigo = regexPideCodigoReal.test(promptFinal);

    if (carpetaSolicitada && workspacePath && !pideCodigo) {
        return {
            promptFinal,
            contexto,
            crearCarpetaDirecta: carpetaSolicitada,
            info: `[Creando carpeta: ${carpetaSolicitada}]`,
            skillAplicada
        };
    }

    // B. Creación de archivo individual en lenguaje natural (ej: "crea un nuevo AGENT.md basado en...")
    const targetIndividual = extraerIntencionArchivoIndividual(promptFinal);
    if (targetIndividual && workspacePath) {
        // Inyectar referencias de archivos si fueron mencionados en el texto (ej: "basado en AGENTS.md")
        const regexArchivoMencion = /(?:^|\s)["']?([a-zA-Z0-9_\-\.\/]+\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|md|txt|py|java|c|cpp|h|rs|go|sh|yaml|yml|toml|sql))["']?(?:\?|\!|,|\s|$)/gi;
        let mArch;
        while ((mArch = regexArchivoMencion.exec(promptFinal)) !== null) {
            const candidato = mArch[1];
            if (candidato.toLowerCase() === targetIndividual.toLowerCase()) continue;
            const ruta = resolverArchivoEnWorkspace(rutaRaizEfectiva, candidato) || (fs.existsSync(candidato) ? candidato : null);
            if (ruta && fs.existsSync(ruta) && fs.statSync(ruta).isFile()) {
                try {
                    const contenido = fs.readFileSync(ruta, 'utf-8');
                    const rutaRelativa = path.relative(rutaRaizEfectiva, ruta) || candidato;
                    contexto += `=== CONTENIDO DE REFERENCIA: ${rutaRelativa} ===\n${contenido}\n=== FIN REFERENCIA ===\n\n`;
                } catch {}
            }
        }

        const rutaDestino = path.isAbsolute(targetIndividual)
            ? targetIndividual
            : path.join(rutaRaizEfectiva, targetIndividual);

        promptFinal = `Instrucción del usuario: ${promptFinal}\n\n` +
            `TAREA: Genera el contenido completo, detallado y profesional para el archivo '${targetIndividual}'. ` +
            `Básate en el archivo de referencia si se proporcionó y en la estructura real del repositorio actual. ` +
            `Devuelve el contenido completo listo para ser guardado.`;

        return {
            promptFinal,
            contexto,
            modoCreacion: true,
            archivoDestino: rutaDestino,
            info: `[Mac: Preparando creación de '${targetIndividual}']`,
            skillAplicada
        };
    }

    // C. Edición multi-archivo autónoma (solo si se pide expresamente modificar todo el repo y no hay archivo individual)
    const pideModificarTodoElRepo = /\b(?:todo\s+el\s+repo|todos\s+los\s+archivos|el\s+repositorio\s+entero|all\s+files|whole\s+repo|entire\s+repo)\b/i.test(promptFinal);
    if (workspacePath && pideModificarTodoElRepo && detectarIntencionEdicionAutonoma(promptFinal)) {
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaRaizEfectiva);
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaRaizEfectiva, archivos, totalBytes, limitAlcanzado);

            const instruccionSistema = [
                `Eres un agente autónomo de creación y modificación de código.`,
                `TAREA: Analiza el repositorio proporcionado y aplica la instrucción del usuario.`,
                `FORMATO DE RESPUESTA OBLIGATORIO:`,
                `  Devuelve EXCLUSIVAMENTE un array JSON válido. Sin texto previo, sin explicaciones, sin bloques markdown.`,
                `  Cada elemento debe tener:`,
                `    - "ruta": ruta relativa del archivo desde la raíz del workspace`,
                `    - "contenido": código completo y funcional del archivo`,
                `REGLAS ABSOLUTAS:`,
                `  - NUNCA escribas texto antes del JSON. Tu primera respuesta debe ser el carácter [`,
                `  - NUNCA uses bloques \`\`\`json ni \`\`\` de ningún tipo`,
                `  - NUNCA expliques lo que vas a hacer. Solo genera el JSON.`,
            ].join('\n');

            const promptEditaRepo = [
                `=== REPOSITORIO ===`,
                resumen,
                `===================`,
                ``,
                `INSTRUCCIÓN DEL USUARIO: ${promptFinal}`,
                ``,
                `IMPORTANTE: Responde ÚNICAMENTE con el array JSON. Empieza con [`,
            ].join('\n');

            return {
                promptFinal: promptEditaRepo,
                contexto: '',
                modoEditaRepo: true,
                instruccionSistema,
                workspaceYaCargado: true,
                info: `[Agente autónomo: ${archivos.length} archivos del workspace cargados para edición múltiple (${kbTotal} KB)]`,
                skillAplicada
            };
        } catch (e) {
            console.error('[Autónomo] Error cargando repositorio:', e.message);
        }
    }

    // D. Inyección automática en lenguaje natural si se menciona un archivo existente en el workspace (modo informativo/pregunta)
    if (rutaRaizEfectiva) {
        const regexArchivoMencion = /(?:^|\s)["']?([a-zA-Z0-9_\-\.\/]+\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|md|txt|py|java|c|cpp|h|rs|go|sh|yaml|yml|toml|sql))["']?(?:\?|\!|,|\s|$)/gi;
        let match;
        const archivosInyectados = [];
        while ((match = regexArchivoMencion.exec(promptFinal)) !== null) {
            const candidato = match[1];
            const ruta = resolverArchivoEnWorkspace(rutaRaizEfectiva, candidato) || (fs.existsSync(candidato) ? candidato : null);
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
            const nombres = archivosInyectados.map(r => path.relative(rutaRaizEfectiva, r) || r).join(', ');
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
        modoCreacion,
        archivoDestino,
        skillAplicada
    };
}
