import { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './src/config.js';
import { generarStream, listarModelosOllama } from './src/ollama.js';
import { procesarInputUsuario } from './src/commands.js';
import { obtenerSkills } from './src/skills-loader.js';
import { leerCarpetaRecursiva, formatearContextoCarpeta } from './src/fs-tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Nombre oficial de la aplicación en macOS, Dock y Menú del Sistema
const APP_NAME = 'Local-LLM';
app.name = APP_NAME;
app.setName(APP_NAME);
process.title = APP_NAME;

let mainWindow;
let abortController = null;

// Configurar Menú Nativo de macOS (Para que junto a la manzana  diga "Local-LLM")
function configurarMenuMac() {
    if (process.platform === 'darwin') {
        const template = [
            {
                label: APP_NAME,
                submenu: [
                    { role: 'about', label: `Acerca de ${APP_NAME}` },
                    { type: 'separator' },
                    { role: 'services', label: 'Servicios' },
                    { type: 'separator' },
                    { role: 'hide', label: `Ocultar ${APP_NAME}` },
                    { role: 'hideOthers', label: 'Ocultar otros' },
                    { role: 'unhide', label: 'Mostrar todo' },
                    { type: 'separator' },
                    { role: 'quit', label: `Salir de ${APP_NAME}` }
                ]
            },
            {
                label: 'Edición',
                submenu: [
                    { role: 'undo', label: 'Deshacer' },
                    { role: 'redo', label: 'Rehacer' },
                    { type: 'separator' },
                    { role: 'cut', label: 'Cortar' },
                    { role: 'copy', label: 'Copiar' },
                    { role: 'paste', label: 'Pegar' },
                    { role: 'selectAll', label: 'Seleccionar todo' }
                ]
            },
            {
                label: 'Ventana',
                submenu: [
                    { role: 'minimize', label: 'Minimizar' },
                    { role: 'zoom', label: 'Zoom' },
                    { role: 'close', label: 'Cerrar ventana' }
                ]
            }
        ];
        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    } else {
        Menu.setApplicationMenu(null);
    }
}

function setDockIcon() {
    // En app empaquetada (.dmg / .app), el ícono ya está en el bundle (.icns)
    // y macOS lo gestiona solo. Llamar setIcon() aquí causaría conflictos de timing.
    // Solo lo forzamos en dev mode para sobrescribir el ícono del binario de Electron.
    if (process.platform !== 'darwin' || !app.dock || app.isPackaged) return;
    const iconPath = path.join(__dirname, 'ui', 'assets', 'icon.png');
    if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }
}

function createWindow() {
    configurarMenuMac();

    const iconPath = path.join(__dirname, 'ui', 'assets', 'icon.png');

    mainWindow = new BrowserWindow({
        title: APP_NAME,
        width: 1140,
        height: 800,
        minWidth: 840,
        minHeight: 560,
        icon: iconPath,
        show: false, // No mostrar hasta que esté listo para evitar flash y lucha con el Dock
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 18, y: 18 },
        vibrancy: 'under-window',
        visualEffectState: 'active',
        transparent: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            devTools: false // Bloquea el inspector DevTools
        }
    });

    // Desactivar menú por defecto y atajos de inspección en producción
    mainWindow.removeMenu();
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // Bloquea Cmd+Alt+I (Mac), F12, Ctrl+Shift+I (Windows/Linux)
        if (
            (input.key.toLowerCase() === 'i' && (input.meta || input.control) && input.alt) ||
            input.key === 'F12'
        ) {
            event.preventDefault();
        }
    });

    mainWindow.once('ready-to-show', () => {
        // Setear el ícono JUSTO antes de mostrar la ventana
        setDockIcon();
        mainWindow.show();
        // Re-aplicar después de que la ventana es visible por si macOS lo revierte
        setTimeout(setDockIcon, 300);
        setTimeout(setDockIcon, 1000);
    });

    mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(() => {
    setDockIcon(); // Primera vez, antes de crear la ventana
    createWindow();
});

// Detener generación activa
ipcMain.on('detener-generacion', () => {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
});

// Selector de carpeta para workspace de sesión
ipcMain.handle('seleccionar-carpeta-workspace', async () => {
    const parentWin = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    const result = await dialog.showOpenDialog(parentWin, {
        properties: ['openDirectory'],
        buttonLabel: 'Usar como Workspace'
    });
    return result.canceled ? null : result.filePaths[0];
});

// Selector de archivos nativo
ipcMain.handle('seleccionar-archivo', async () => {
    const parentWin = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    const result = await dialog.showOpenDialog(parentWin, {
        properties: ['openFile', 'openDirectory'],
        buttonLabel: 'Cargar al Chat'
    });
    return result.canceled ? null : result.filePaths[0];
});

// Probar conexión a una IP y obtener modelos (Setup inicial y Ajustes)
ipcMain.handle('test-conexion-ollama', async (event, hostAProbar) => {
    let cleanHost = (hostAProbar || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (!cleanHost.includes(':')) cleanHost += ':11434';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 seg timeout

        const res = await fetch(`http://${cleanHost}/api/tags`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`Ollama respondió con error HTTP ${res.status}`);

        const data = await res.json();
        const modelos = data.models ? data.models.map(m => m.name) : [];
        return { success: true, modelos, host: cleanHost };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Guardar configuración confirmada por el usuario (IP, modelo, idioma)
ipcMain.handle('guardar-config-ip', async (event, { host, model, language }) => {
    config.guardarConfig({ host, model, language });
    return { success: true, host: config.ollamaHost, model: config.currentModel, language: config.language };
});

// Obtener lista de modelos de Ollama
ipcMain.handle('obtener-modelos', async () => {
    const modelos = await listarModelosOllama();
    return {
        modelos,
        modeloActual: config.currentModel,
        hostActual: config.ollamaHost,
        language: config.language
    };
});

// Cambiar modelo activo
ipcMain.handle('cambiar-modelo', async (event, nuevoModelo) => {
    config.setModel(nuevoModelo);
    return { success: true, modeloActual: config.currentModel };
});

// Obtener skills para autocompletado en frontend
ipcMain.handle('obtener-skills', async () => {
    const skills = obtenerSkills();
    return skills.map(s => ({
        nombre: s.nombre,
        descripcion: s.descripcion,
        triggers: s.triggers
    }));
});

// Procesar mensaje del usuario
ipcMain.on('mensaje-usuario', async (event, data) => {
    // Soportar tanto string directo como objeto estructurado { input, historial, carpeta }
    const inputTexto = typeof data === 'string' ? data : (data?.input || '');
    const historial = Array.isArray(data?.historial) ? data.historial : [];
    const carpeta = data?.carpeta || null;

    const parsed = procesarInputUsuario(inputTexto, carpeta || null);

    if (parsed.error) {
        event.sender.send('stream-ia', `[Error]: ${parsed.error}\n\n`);
        event.sender.send('fin-stream');
        return;
    }

    if (parsed.skillAplicada) {
        event.sender.send('stream-ia', `⚡ [Skill activada: ${parsed.skillAplicada.nombre.toUpperCase()}]\n`);
    }

    if (parsed.info) {
        event.sender.send('stream-ia', `${parsed.info}\n\n`);
    }

    if (parsed.modoEdicion) {
        event.sender.send('stream-ia', `[Modificando ${parsed.archivoDestino}...]\n\n`);
    } else if (parsed.modoEditaRepo) {
        event.sender.send('stream-ia', `[Analizando repositorio para edición múltiple...]\n\n`);
    }

    // Si la sesión tiene un workspace asignado y el mensaje no es ya un comando con contexto cargado,
    // inyectar automáticamente el contexto del repositorio/carpeta como contexto del sistema.
    //
    // La flag `parsed.workspaceYaCargado` se activa cuando commands.js ya leyó el repo completo
    // (ej. /lee-repo, /edita-repo). En ese caso solo inyectamos el mapa de estructura para
    // no duplicar tokens. Si hay un archivo específico cargado (=== CONTENIDO DE:), también
    // acompañamos con el mapa. En cualquier otro mensaje normal, se inyecta el repo completo.
    let workspaceContexto = '';
    if (carpeta && !parsed.modoEdicion && !parsed.modoEditaRepo) {
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(carpeta);
            if (archivos.length > 0) {
                const mapEstructura = `Estructura del workspace (${archivos.length} archivos${limitAlcanzado ? ' — límite alcanzado, hay más archivos' : ''}):\n` +
                    archivos.map(a => `- ${a.ruta}`).join('\n') + '\n\n';

                if (parsed.workspaceYaCargado || parsed.contexto.includes('=== CONTENIDO DE:')) {
                    // Ya hay contexto de archivo/repo: solo incluir el mapa para no duplicar tokens
                    workspaceContexto = mapEstructura;
                } else {
                    // Mensaje de conversación normal: inyectar repo completo
                    const { resumen } = formatearContextoCarpeta(carpeta, archivos, totalBytes, limitAlcanzado);
                    workspaceContexto = resumen;
                }
            }
        } catch (e) {
            console.error('[Workspace] Error leyendo carpeta del workspace:', e.message);
        }
    }

    const promptCompleto = `${workspaceContexto}${parsed.contexto}Instrucción: ${parsed.promptFinal}`.trim();
    abortController = new AbortController();

    try {
        const respuestaFinal = await generarStream({
            prompt: promptCompleto,
            // Pasar historial de la sesión para que el modelo recuerde el contexto previo.
            // En modos de edición/skill usamos historial vacío para no contaminar el contexto.
            historial: (parsed.modoEdicion || parsed.modoEditaRepo || parsed.skillAplicada)
                ? []
                : (historial || []),
            signal: abortController.signal,
            onChunk: (chunk) => event.sender.send('stream-ia', chunk)
        });

        // Si fue edición individual
        if (parsed.modoEdicion && parsed.archivoDestino) {
            fs.writeFileSync(parsed.archivoDestino, respuestaFinal.trim(), 'utf-8');
            event.sender.send('stream-ia', `\n\n✅ [Guardado en ${parsed.archivoDestino}]`);
        }

        // Si fue edición de repositorio (múltiples archivos)
        if (parsed.modoEditaRepo) {
            try {
                const cambios = JSON.parse(respuestaFinal.trim());
                let count = 0;
                for (const { ruta, contenido } of cambios) {
                    const rutaAbsoluta = path.join(carpeta || config.projectRoot, ruta);
                    fs.writeFileSync(rutaAbsoluta, contenido.trim(), 'utf-8');
                    event.sender.send('stream-ia', `\n✅ [Guardado: ${ruta}]`);
                    count++;
                }
                event.sender.send('stream-ia', `\n\n🎯 [edita-repo completado: ${count} archivo(s) modificado(s)]`);
            } catch (err) {
                event.sender.send('stream-ia', `\n\n❌ [Error parseando JSON del modelo: ${err.message}]\nRespuesta cruda:\n${respuestaFinal.slice(0, 500)}`);
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            event.sender.send('stream-ia', `\n\n🛑 [Generación detenida]`);
        } else {
            event.sender.send('stream-ia', `\n[Error]: ${err.message}`);
        }
    } finally {
        event.sender.send('fin-stream');
    }
});
