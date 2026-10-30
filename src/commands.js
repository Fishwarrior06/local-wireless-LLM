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
 * Detecta si el texto en lenguaje natural expresa intención de escribir/crear/modificar código en el workspace.
 * Soporta tanto español como inglés (create, update, edit, modify, change, add, write, etc.).
 */
function detectarIntencionEdicionAutonoma(texto) {
    if (!texto) return false;
    const regexAccion = /\b(?:crea|crear|genera|generar|agrega|agregar|añade|añadir|haz|hacer|escribe|escribir|modifica|modificar|edita|editar|actualiza|actualizar|corrige|corregir|implementa|implementar|create|creating|make|making|add|adding|write|writing|generate|generating|modify|modifying|edit|editing|update|updating|change|changing|fix|fixing|refactor|refactoring|implement|implementing)\b/i;
    // Nota: "carpeta/folder/directorio" están EXCLUIDOS intencionalmente.
    // Si estuvieran, "crea la carpeta X" dispararía modoEditaRepo en lugar de crearCarpetaDirecta.
    // Cuando el usuario pide carpeta + archivos/tests, palabras como "test/code/archivo"
    // activan tieneIntencionEdicion igualmente — y modoEditaRepo crea las carpetas intermedias
    // automáticamente con mkdirSync({ recursive: true }) al escribir cada archivo.
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
    const regexCreacion = /^(?:crea|crear|new|nuevo|genera|generar)\s+(?:el\s+archivo\s+|el\s+fichero\s+|archivo\s+|fichero\s+|file\s+)?(?:"([^"]+)"|([^\s\?]+))\s*(.*)/i;

    const matchRepo = promptFinal.match(regexRepo);
    const matchCarpeta = promptFinal.match(regexCarpeta);
    const matchLectura = promptFinal.match(regexLectura);
    const matchEdicion = promptFinal.match(regexEdicion);
    const matchEditaRepo = promptFinal.match(regexEditaRepo);
    const matchCreacion = promptFinal.match(regexCreacion);

    const rutaRaizEfectiva = workspacePath || config.projectRoot;

    // ── Detección autónoma de creación/edición en lenguaje natural ─────────────
    const carpetaSolicitada = extraerIntencionCrearCarpeta(promptFinal);

    // Si se solicitó una carpeta, verificar si el texto restante pide generar código/archivos
    let tieneIntencionEdicion = false;
    if (workspacePath) {
        if (carpetaSolicitada) {
            // El usuario pidió crear una carpeta. Solo activamos modoEditaRepo si
            // el prompt pide explícitamente generar o escribir archivos/código/tests reales
            // (ej: "crea carpeta src/test donde irán los unit tests para verificar...").
            // Si el prompt solo es "crea la carpeta test dentro de src del repositorio",
            // la palabra "test" es el nombre de la carpeta, no un pedido de código.
            const regexPideCodigoReal = /\b(?:unit\s*tests?|pruebas?\s+unitarias?|archivos?|ficheros?|files?|código|codigo|code|escribe|escribir|genera|generar|implementa|implementar|donde\s+ir[aá]n|para\s+verificar|verifiquemos|nesecitemos|necesitemos|tests?\s+que)\b/i;
            tieneIntencionEdicion = regexPideCodigoReal.test(promptFinal);
        } else {
            tieneIntencionEdicion = detectarIntencionEdicionAutonoma(promptFinal) ||
                (matchLectura && detectarIntencionEdicionAutonoma(matchLectura[3] || ''));
        }
    }

    // 1. Si es creación de carpeta pura:
    // Se ejecuta de inmediato en disco (1ms) sin quemar tokens del LLM ni fallar en parseos
    if (carpetaSolicitada && workspacePath && !tieneIntencionEdicion) {
        return {
            promptFinal,
            contexto,
            crearCarpetaDirecta: carpetaSolicitada,
            info: `[Creando carpeta: ${carpetaSolicitada}]`,
            skillAplicada
        };
    }

    // 2. Si hay intención autónoma de crear o editar archivos/tests/código:
    if (tieneIntencionEdicion) {
        // Inyectar archivos específicos si fueron mencionados (ej: "lee AGENTS.md y crea...")
        let referenciaArchivos = '';
        if (rutaRaizEfectiva) {
            const regexArchivoMencion = /(?:^|\s)["']?([a-zA-Z0-9_\-\.\/]+\.(?:js|mjs|cjs|ts|tsx|jsx|html|css|json|md|txt|py|java|c|cpp|h|rs|go|sh|yaml|yml|toml|sql))["']?(?:\?|\!|,|\s|$)/gi;
            let mArch;
            while ((mArch = regexArchivoMencion.exec(promptFinal)) !== null) {
                const candidato = mArch[1];
                const ruta = resolverArchivoEnWorkspace(rutaRaizEfectiva, candidato);
                if (ruta && fs.existsSync(ruta) && fs.statSync(ruta).isFile() && !referenciaArchivos.includes(`=== ${candidato}`)) {
                    try {
                        const contenido = fs.readFileSync(ruta, 'utf-8');
                        const rutaRelativa = path.relative(rutaRaizEfectiva, ruta) || candidato;
                        referenciaArchivos += `=== CONTENIDO DE REFERENCIA: ${rutaRelativa} ===\n${contenido}\n=== FIN REFERENCIA: ${rutaRelativa} ===\n\n`;
                    } catch {}
                }
            }
        }

        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(rutaRaizEfectiva);
            const { resumen, kbTotal } = formatearContextoCarpeta(rutaRaizEfectiva, archivos, totalBytes, limitAlcanzado);

            // La instrucción de sistema se envía por separado en systemPrompt (rol 'system' en Ollama),
            // lo que evita que el modelo la olvide por el efecto de recency bias al tener 100KB+ de repo.
            // El promptFinal solo lleva el contenido del repo + instrucción del usuario.
            // Al final se añade el prefijo `[` para forzar que el modelo complete en JSON directamente.
            const instruccionSistema = [
                `Eres un agente autónomo de creación y modificación de código.`,
                `TAREA: Analiza el repositorio y las referencias proporcionadas, y aplica la instrucción del usuario.`,
                `FORMATO DE RESPUESTA OBLIGATORIO:`,
                `  Devuelve EXCLUSIVAMENTE un array JSON válido. Sin texto previo, sin explicaciones, sin bloques markdown.`,
                `  Cada elemento debe tener:`,
                `    - "ruta": ruta relativa del archivo desde la raíz del workspace (ej: "src/test/foo.test.js")`,
                `    - "contenido": código completo y funcional del archivo`,
                `REGLAS ABSOLUTAS:`,
                `  - NUNCA escribas texto antes del JSON. Tu primera respuesta debe ser el carácter [`,
                `  - NUNCA uses bloques \`\`\`json ni \`\`\` de ningún tipo`,
                `  - NUNCA expliques lo que vas a hacer. Solo genera el JSON.`,
                `  - Puedes crear archivos nuevos en rutas nuevas (el sistema crea las carpetas automáticamente)`,
                `  - Si la instrucción pide archivos en src/test/, usa rutas como "src/test/archivo.test.js"`,
            ].join('\n');

            // El contexto del usuario lleva: referencias de archivos pedidos + mapa del repo + instrucción
            const promptEditaRepo = [
                referenciaArchivos,
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
                contexto: '',  // vacío: toda la info ya está en promptFinal e instruccionSistema
                modoEditaRepo: true,
                instruccionSistema,  // se enviará como rol 'system' en ollama.js
                workspaceYaCargado: true,
                info: `[Agente autónomo: ${archivos.length} archivos del workspace cargados para aplicar cambios en disco (${kbTotal} KB)]`,
                skillAplicada
            };
        } catch (e) {
            console.error('[Autónomo] Error cargando repositorio para edición autónoma:', e.message);
        }
    }

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
    } else if (matchCreacion) {
        // Modo creación: el archivo puede no existir todavía.
        // La IA generará su contenido completo y main.js lo escribirá en disco
        // creando la carpeta padre si es necesario.
        modoCreacion = true;
        const rutaParam = (matchCreacion[1] || matchCreacion[2]).trim();
        const instruccion = matchCreacion[3] || 'Genera el contenido apropiado para este archivo.';

        // Normalizar: si es relativa, unirla a la raíz del workspace
        const rutaAbsoluta = path.isAbsolute(rutaParam)
            ? rutaParam
            : path.join(rutaRaizEfectiva, rutaParam);

        // Si el archivo ya existe, incluir su contenido como contexto para que la IA lo amplíe
        if (fs.existsSync(rutaAbsoluta) && fs.statSync(rutaAbsoluta).isFile()) {
            const contenidoExistente = fs.readFileSync(rutaAbsoluta, 'utf-8');
            contexto += `Contenido actual de ${rutaParam}:\n${contenidoExistente}\n\n`;
        }

        promptFinal = `Instrucción: ${instruccion}\n\nREGLA ESTRICTA: Devuelve ÚNICAMENTE el código o contenido final del archivo '${rutaParam}'. Sin saludos, explicaciones, prefijos de ruta ni bloques markdown.`;
        archivoDestino = rutaAbsoluta;

        return {
            promptFinal,
            contexto,
            modoCreacion: true,
            archivoDestino: rutaAbsoluta,
            info: `[Creando archivo: ${rutaParam}]`,
            skillAplicada
        };
    } else if (matchEditaRepo) {
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

    // Detección automática en lenguaje natural si se menciona un archivo existente en el workspace (solo lectura informativa)
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
        modoCreacion,
        archivoDestino,
        skillAplicada
    };
}
