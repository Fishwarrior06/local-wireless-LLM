import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './src/config.js';
import { generarStream, listarModelosOllama } from './src/ollama.js';
import { procesarInputUsuario } from './src/commands.js';
import { obtenerSkills } from './src/skills-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar el nombre oficial de la aplicación en macOS y el Dock
app.setName('Wireless LLM');

let mainWindow;
let abortController = null;

function createWindow() {
    const iconPath = path.join(__dirname, 'ui', 'assets', 'icon.png');

    // Configurar icono en el Dock de macOS
    if (process.platform === 'darwin' && app.dock && fs.existsSync(iconPath)) {
        app.dock.setIcon(iconPath);
    }

    mainWindow = new BrowserWindow({
        title: 'Wireless LLM',
        width: 1140,
        height: 800,
        minWidth: 840,
        minHeight: 560,
        icon: iconPath,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 18, y: 18 },
        vibrancy: 'under-window',
        visualEffectState: 'active',
        transparent: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(createWindow);

// Detener generación activa
ipcMain.on('detener-generacion', () => {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
});

// Selector de archivos nativo
ipcMain.handle('seleccionar-archivo', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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

// Guardar IP confirmada por el usuario
ipcMain.handle('guardar-config-ip', async (event, { host, model }) => {
    config.guardarConfig({ host, model });
    return { success: true, host: config.ollamaHost, model: config.currentModel };
});

// Obtener lista de modelos de Ollama
ipcMain.handle('obtener-modelos', async () => {
    const modelos = await listarModelosOllama();
    return {
        modelos,
        modeloActual: config.currentModel,
        hostActual: config.ollamaHost
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
ipcMain.on('mensaje-usuario', async (event, input) => {
    const parsed = procesarInputUsuario(input);

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

    const promptCompleto = `${parsed.contexto}Instrucción: ${parsed.promptFinal}`.trim();
    abortController = new AbortController();

    try {
        const respuestaFinal = await generarStream({
            prompt: promptCompleto,
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
                    const rutaAbsoluta = path.join(config.projectRoot, ruta);
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
