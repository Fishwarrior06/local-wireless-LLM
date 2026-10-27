import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') }); // Ruta absoluta para funcionar desde Finder/Electron empaquetado
const OLLAMA_HOST = process.env.OLLAMA_HOST;
const MODEL = process.env.OLLAMA_MODEL;

let mainWindow;
let abortController = null; // Controlador para detener el streaming

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 750,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#000000', // Negro sólido puro
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Botón de pánico para detener la generación
ipcMain.on('detener-generacion', () => {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
});

// Cuadro de diálogo para el botón "+" (permite archivos o carpetas)
ipcMain.handle('seleccionar-archivo', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'openDirectory'],
        buttonLabel: 'Cargar al Chat'
    });
    return result.canceled ? null : result.filePaths[0];
});

// Configuración de directorios y extensiones para lectura masiva
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

ipcMain.on('mensaje-usuario', async (event, input) => {
    let contexto = "";
    let promptFinal = input;
    let modoEdicion = false;
    let archivoDestino = "";

    const regexRepo = /^lee-repo\s*(.*)/i;
    const regexCarpeta = /^lee-carpeta\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexLectura = /^lee\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;
    const regexEdicion = /^edita\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i;

    const matchRepo = input.match(regexRepo);
    const matchCarpeta = input.match(regexCarpeta);
    const matchLectura = input.match(regexLectura);
    const matchEdicion = input.match(regexEdicion);

    if (matchEdicion) {
        modoEdicion = true;
        archivoDestino = (matchEdicion[1] || matchEdicion[2]).trim();
        try {
            const contenido = fs.readFileSync(archivoDestino, 'utf-8');
            contexto = `Código actual de ${archivoDestino}:\n${contenido}\n\n`;
            promptFinal = `Instrucción: ${matchEdicion[3] || 'Optimiza este código'}\n\nREGLA ESTRICTA: Devuelve ÚNICAMENTE el código final modificado. Sin saludos, explicaciones ni bloques markdown.`;
            event.sender.send('stream-ia', `[Modificando ${archivoDestino}...]\n\n`);
        } catch (e) {
            event.sender.send('stream-ia', `[Error: No se encontró el archivo ${archivoDestino}]`);
            event.sender.send('fin-stream');
            return;
        }
    } else if (matchRepo) {
        const rutaObjetivo = __dirname; // Siempre apunta al directorio del proyecto
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(rutaObjetivo);
            if (archivos.length === 0) {
                event.sender.send('stream-ia', `[Aviso: No se encontraron archivos de código compatibles en el repositorio]\n\n`);
            } else {
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes);
                contexto = resumen;
                event.sender.send('stream-ia', `[Mac: ${archivos.length} archivos del repositorio cargados en contexto (${kbTotal} KB)]\n\n`);
            }
            promptFinal = matchRepo[1] || "Analiza la arquitectura y estructura de este repositorio.";
        } catch (e) {
            event.sender.send('stream-ia', `[Error leyendo repositorio: ${e.message}]`);
            event.sender.send('fin-stream');
            return;
        }
    } else if (matchCarpeta) {
        const rutaObjetivo = (matchCarpeta[1] || matchCarpeta[2]).trim();
        try {
            const { archivos, totalBytes } = leerCarpetaRecursiva(rutaObjetivo);
            if (archivos.length === 0) {
                event.sender.send('stream-ia', `[Aviso: No se encontraron archivos de código en '${rutaObjetivo}']\n\n`);
            } else {
                const { resumen, kbTotal } = formatearContextoCarpeta(rutaObjetivo, archivos, totalBytes);
                contexto = resumen;
                event.sender.send('stream-ia', `[Mac: ${archivos.length} archivos de '${rutaObjetivo}' cargados en contexto (${kbTotal} KB)]\n\n`);
            }
            promptFinal = matchCarpeta[3] || "Analiza los archivos de esta carpeta.";
        } catch (e) {
            event.sender.send('stream-ia', `[Error leyendo carpeta '${rutaObjetivo}': ${e.message}]`);
            event.sender.send('fin-stream');
            return;
        }
    } else if (matchLectura) {
        const rutaArchivo = (matchLectura[1] || matchLectura[2]).trim();
        try {
            const stats = fs.statSync(rutaArchivo);
            if (stats.isDirectory()) {
                const { archivos, totalBytes } = leerCarpetaRecursiva(rutaArchivo);
                if (archivos.length === 0) {
                    event.sender.send('stream-ia', `[Aviso: No se encontraron archivos de código en '${rutaArchivo}']\n\n`);
                } else {
                    const { resumen, kbTotal } = formatearContextoCarpeta(rutaArchivo, archivos, totalBytes);
                    contexto = resumen;
                    event.sender.send('stream-ia', `[Mac: ${archivos.length} archivos de '${rutaArchivo}' cargados en contexto (${kbTotal} KB)]\n\n`);
                }
                promptFinal = matchLectura[3] || "Analiza esta carpeta.";
            } else {
                const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
                contexto = `Archivo ${rutaArchivo}:\n${contenido}\n\n`;
                promptFinal = matchLectura[3] || "Analiza esto.";
            }
        } catch (e) {
            event.sender.send('stream-ia', `[Error leyendo archivo: ${e.message}]`);
            event.sender.send('fin-stream');
            return;
        }
    }

    const promptCompleto = `${contexto}Instrucción: ${promptFinal}`;
    let respuestaAcumulada = "";
    abortController = new AbortController(); // Nuevo controlador para esta petición

    try {
        const respuesta = await fetch(`http://${OLLAMA_HOST}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, prompt: promptCompleto, stream: true }),
            signal: abortController.signal // Enlazar el botón de pánico
        });

        if (!respuesta.ok) {
            const errorTexto = await respuesta.text();
            event.sender.send('stream-ia', `\n[Error Ollama ${respuesta.status}]: ${errorTexto}`);
            return;
        }

        for await (const chunk of respuesta.body) {
            const textoLimpio = new TextDecoder("utf-8").decode(chunk);
            const lineas = textoLimpio.split('\n').filter(l => l.trim() !== '');
            for (const linea of lineas) {
                const json = JSON.parse(linea);
                if (json.response) {
                    respuestaAcumulada += json.response;
                    event.sender.send('stream-ia', json.response);
                }
            }
        }

        if (modoEdicion) {
            fs.writeFileSync(archivoDestino, respuestaAcumulada.trim(), 'utf-8');
            event.sender.send('stream-ia', `\n\n✅ [Guardado en ${archivoDestino}]`);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            event.sender.send('stream-ia', `\n\n🛑 [Generación detenida]`);
        } else {
            event.sender.send('stream-ia', `\n[Error]: ${error.message}`);
        }
    } finally {
        event.sender.send('fin-stream'); // Avisar al frontend que terminó
    }
});