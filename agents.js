import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Cargar variables del archivo .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') }); // Ruta absoluta para que siempre encuentre el .env

const OLLAMA_HOST = process.env.OLLAMA_HOST;
const MODEL = process.env.OLLAMA_MODEL;
const OLLAMA_URL = `http://${OLLAMA_HOST}/api/generate`;

if (!OLLAMA_HOST) {
    console.error(chalk.red("Error: Falta OLLAMA_HOST en el archivo .env"));
    process.exit(1);
}

// Interfaz de consola
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function preguntarAPI(promptBase, contexto = "") {
    const promptCompleto = `${contexto}\n\nInstrucción: ${promptBase}`.trim();
    
    try {
        const respuesta = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                prompt: promptCompleto,
                stream: true // Muestra la respuesta en tiempo real
            })
        });

        if (!respuesta.ok) throw new Error(`HTTP Error: ${respuesta.status}`);

        process.stdout.write(chalk.green('\n🤖 Qwen: '));

        // Procesamiento del stream para ver la respuesta escribiéndose
        for await (const chunk of respuesta.body) {
            const textoLimpio = new TextDecoder("utf-8").decode(chunk);
            const lineas = textoLimpio.split('\n').filter(linea => linea.trim() !== '');
            
            for (const linea of lineas) {
                const json = JSON.parse(linea);
                if (json.response) {
                    process.stdout.write(chalk.cyan(json.response));
                }
            }
        }
        console.log(chalk.gray('\n----------------------------------------\n'));
    } catch (error) {
        console.error(chalk.red("\n[Error de conexión con la PC]:", error.message));
        console.log(chalk.yellow("Verifica que Tailscale esté activo y la IP sea correcta en el .env\n"));
    }
}

const IGNORAR_DIRS = new Set([
    'node_modules', '.git', '.DS_Store', 'dist', 'build', 'coverage', '.next', '.gemini', 'vendor', '.cache'
]);

const EXTENSIONES_VALIDAS = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.json',
    '.md', '.txt', '.py', '.java', '.c', '.cpp', '.h', '.rs', '.go', '.sh',
    '.yaml', '.yml', '.toml', '.sql', '.env.example'
]);

const IGNORAR_ARCHIVOS = new Set([
    '.env', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
]);

function leerCarpetaRecursiva(rutaBase, maxArchivos = 40, maxBytes = 300 * 1024) {
    let archivosLeidos = [];
    let totalBytes = 0;

    function recorrer(dirActual, profundidad = 0) {
        if (profundidad > 4 || archivosLeidos.length >= maxArchivos) return;

        let items;
        try {
            items = fs.readdirSync(dirActual, { withFileTypes: true });
        } catch {
            return;
        }

        for (const item of items) {
            if (archivosLeidos.length >= maxArchivos || totalBytes >= maxBytes) break;

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
                        if (stats.size > 100 * 1024) continue;
                        if (totalBytes + stats.size > maxBytes) break;

                        const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
                        totalBytes += stats.size;
                        archivosLeidos.push({ ruta: rutaRelativa, contenido, size: stats.size });
                    } catch {}
                }
            }
        }
    }

    recorrer(rutaBase, 0);
    return { archivos: archivosLeidos, totalBytes };
}

function formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes) {
    const kbTotal = (totalBytes / 1024).toFixed(1);
    let resumen = `=== REPOSITORIO / CARPETA: ${rutaObjetivo} (${archivos.length} archivos, ${kbTotal} KB) ===\n`;
    resumen += `Estructura de archivos incluidos:\n` + archivos.map(a => `- ${a.ruta}`).join('\n') + `\n\n`;
    for (const a of archivos) {
        resumen += `--- INICIO ARCHIVO: ${a.ruta} ---\n${a.contenido}\n--- FIN ARCHIVO: ${a.ruta} ---\n\n`;
    }
    resumen += `====================================================\n\n`;
    return { resumen, kbTotal };
}

function procesarComando(input) {
    let contexto = "";
    let promptFinal = input;

    const regexRepo = /^lee-repo\s*(.*)/i;
    const regexCarpeta = /^lee-carpeta\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexLectura = /^lee\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;

    const matchRepo = input.match(regexRepo);
    const matchCarpeta = input.match(regexCarpeta);
    const matchLectura = input.match(regexLectura);

    if (matchRepo) {
        const rutaObjetivo = process.cwd();
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(rutaObjetivo);
            if (archivos.length === 0) {
                console.log(chalk.yellow(`[Mac: No se encontraron archivos de código compatibles en el repositorio]`));
            } else {
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes);
                contexto = resumen;
                console.log(chalk.gray(`[Mac: ${archivos.length} archivos del repositorio cargados en memoria (${kbTotal} KB)]`));
            }
            promptFinal = matchRepo[1] || "Analiza la arquitectura y estructura de este repositorio.";
        } catch (e) {
            console.log(chalk.red(`[Mac: Error leyendo repositorio: ${e.message}]`));
            return { promptFinal: null, contexto: '' };
        }
    } else if (matchCarpeta) {
        const rutaObjetivo = (matchCarpeta[1] || matchCarpeta[2]).trim();
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(rutaObjetivo);
            if (archivos.length === 0) {
                console.log(chalk.yellow(`[Mac: No se encontraron archivos compatibles en '${rutaObjetivo}']`));
            } else {
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes);
                contexto = resumen;
                console.log(chalk.gray(`[Mac: ${archivos.length} archivos de '${rutaObjetivo}' cargados en memoria (${kbTotal} KB)]`));
            }
            promptFinal = matchCarpeta[3] || "Analiza los archivos de esta carpeta.";
        } catch (e) {
            console.log(chalk.red(`[Mac: Error leyendo carpeta '${rutaObjetivo}': ${e.message}]`));
            return { promptFinal: null, contexto: '' };
        }
    } else if (matchLectura) {
        const rutaArchivo = (matchLectura[1] || matchLectura[2]).trim();
        try {
            const stats = fs.statSync(rutaArchivo);
            if (stats.isDirectory()) {
                const { archivos, totalBytes } = leerCarpetaRecursiva(rutaArchivo);
                if (archivos.length === 0) {
                    console.log(chalk.yellow(`[Mac: No se encontraron archivos compatibles en '${rutaArchivo}']`));
                } else {
                    const { resumen, kbTotal } = formatearContextoCarpeta(rutaArchivo, archivos, totalBytes);
                    contexto = resumen;
                    console.log(chalk.gray(`[Mac: ${archivos.length} archivos de '${rutaArchivo}' cargados en memoria (${kbTotal} KB)]`));
                }
                promptFinal = matchLectura[3] || "Analiza esta carpeta.";
            } else {
                const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
                contexto = `--- INICIO DEL ARCHIVO: ${rutaArchivo} ---\n${contenido}\n--- FIN DEL ARCHIVO ---`;
                console.log(chalk.gray(`[Mac: Archivo '${rutaArchivo}' cargado en memoria]`));
                promptFinal = matchLectura[3] || "Analiza este archivo.";
            }
        } catch (e) {
            console.log(chalk.red(`[Mac: Error leyendo el archivo '${rutaArchivo}': ${e.message}]`));
            return { promptFinal: null, contexto: '' };
        }
    }

    return { promptFinal, contexto };
}

function iniciarChat() {
    rl.question(chalk.yellow('Tú: '), async (input) => {
        if (input.toLowerCase() === 'salir' || input.toLowerCase() === 'exit') {
            console.log(chalk.gray('Apagando Nube Privada...'));
            rl.close();
            return;
        }

        if (input.trim() === '') {
            iniciarChat();
            return;
        }

        const { promptFinal, contexto } = procesarComando(input);
        
        if (promptFinal !== null) {
            await preguntarAPI(promptFinal, contexto);
        }
        
        iniciarChat();
    });
}

console.log(chalk.bgBlue.white.bold(` INICIANDO ENLACE TAILSCALE -> ${OLLAMA_HOST} [${MODEL}] `));
console.log(chalk.gray(`Comandos: "lee <archivo|carpeta>", "lee-repo", "lee-carpeta <dir>", "salir"\n`));
iniciarChat();
