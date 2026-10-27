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

let mainWindow;
let abortController = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1140,
        height: 800,
        minWidth: 840,
        minHeight: 560,
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

// Obtener lista de modelos de Ollama
ipcMain.handle('obtener-modelos', async () => {
    const modelos = await listarModelosOllama();
    return {
        modelos,
        modeloActual: config.currentModel
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
