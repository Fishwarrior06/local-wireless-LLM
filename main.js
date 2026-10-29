import { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, powerMonitor } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './src/config.js';
import { generarStream, listarModelosOllama, consultarEstadoJob, abortarJob, verificarDaemonDisponible } from './src/ollama.js';
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

    // Monitoreo nativo de suspensión y reanudación de macOS (Cerrar / Abrir tapa del MacBook)
    if (powerMonitor) {
        powerMonitor.on('suspend', () => {
            console.log('[PowerMonitor] macOS entrando en suspensión / sleep.');
        });

        powerMonitor.on('resume', () => {
            console.log('[PowerMonitor] macOS reanudado tras suspensión. Esperando que Tailscale/WiFi restablezcan conexión...');
            // Esperar 1.8 segundos a que el túnel de red WireGuard y WiFi se reconecten
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('sistema-resumed');
                }
            }, 1800);
        });
    }
});

/**
 * Parsea la respuesta del modelo en modo edición múltiple.
 * Soporta JSON estricto (o dentro de bloques ```json) y fallback robusto
 * para respuestas formateadas con bloques de código Markdown con rutas asociadas.
 * Normaliza las propiedades para tolerar { ruta, contenido }, { file, type }, { path, content }, etc.
 */
function parsearCambiosMultiples(texto) {
    if (!texto) return [];

    let jsonLimpio = texto.trim();
    if (jsonLimpio.startsWith('```json')) {
        jsonLimpio = jsonLimpio.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (jsonLimpio.startsWith('```')) {
        jsonLimpio = jsonLimpio.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Tolerar texto antes o después del array JSON: extraer el bloque entre [ y ]
    const primerCorchete = jsonLimpio.indexOf('[');
    const ultimoCorchete = jsonLimpio.lastIndexOf(']');
    if (primerCorchete !== -1 && ultimoCorchete > primerCorchete) {
        jsonLimpio = jsonLimpio.slice(primerCorchete, ultimoCorchete + 1);
    }

    try {
        const parsed = JSON.parse(jsonLimpio);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map(item => {
                const rutaRaw = (item.ruta || item.path || item.file || item.filepath || item.filename || item.name || '').trim();
                const esDirectorio = item.type === 'directory' || item.tipo === 'directorio' || item.type === 'folder' || item.tipo === 'carpeta';
                const contenido = item.contenido !== undefined ? item.contenido : (item.content !== undefined ? item.content : (item.code !== undefined ? item.code : ''));
                return {
                    ruta: rutaRaw.replace(/^[\\/]+/, ''),
                    contenido: typeof contenido === 'string' ? contenido : (contenido ? JSON.stringify(contenido, null, 2) : ''),
                    esDirectorio
                };
            }).filter(item => item.ruta.length > 0);
        }
    } catch {}

    // Fallback: Si el modelo devolvió bloques markdown en vez de JSON
    const archivos = [];
    const regexBloque = /```([a-zA-Z0-9_\-]*)\r?\n([\s\S]*?)\r?\n```/g;
    let m;
    let ultimoIndex = 0;

    while ((m = regexBloque.exec(texto)) !== null) {
        const lang = m[1].toLowerCase();
        const contenido = m[2];
        const bloqueIndex = m.index;

        if (['bash', 'sh', 'shell', 'tree', 'text'].includes(lang) && (contenido.includes('├──') || contenido.includes('└──'))) {
            ultimoIndex = bloqueIndex + m[0].length;
            continue;
        }

        let rutaEncontrada = null;
        // Método A: Comentario en primera línea del código
        const primeraLinea = contenido.split('\n')[0].trim();
        const mA = primeraLinea.match(/^(?:\/\/\s*|#\s*|\/\*\s*|<!--\s*)([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        if (mA) {
            rutaEncontrada = mA[1];
        }

        // Método B: Encabezado inmediatamente anterior en el texto markdown
        if (!rutaEncontrada) {
            const textoPrevio = texto.slice(ultimoIndex, bloqueIndex);
            const lineasPrevias = textoPrevio.split('\n').map(l => l.trim()).filter(Boolean).reverse();
            for (const linea of lineasPrevias) {
                const mB = linea.match(/([a-zA-Z0-9_\-\.\/]+\.(?:js|ts|jsx|tsx|json|md|html|css|py|java|c|cpp|h|rs|go|sh|yaml|yml|toml|sql))/i);
                if (mB) {
                    rutaEncontrada = mB[1];
                    break;
                }
            }
        }

        if (rutaEncontrada) {
            archivos.push({
                ruta: rutaEncontrada.replace(/^[\\/]+/, '').trim(),
                contenido: contenido.trim()
            });
        }
        ultimoIndex = bloqueIndex + m[0].length;
    }

    return archivos;
}

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

// Consultar estado de un job pendiente tras reinicio de la Mac o corte de red
ipcMain.handle('consultar-job-pendiente', async (event, { jobId, carpeta, modoEditaRepo, archivoDestino, modoCreacion, modoEdicion }) => {
    if (!jobId) return { success: false, error: 'No jobId provided' };
    try {
        const info = await consultarEstadoJob(jobId);
        if (info && info.status === 'completed' && info.output) {
            // Si el trabajo completado era de edición múltiple, aplicar cambios a disco ahora
            if (modoEditaRepo) {
                try {
                    const cambios = parsearCambiosMultiples(info.output);
                    let count = 0;
                    for (const { ruta, contenido, esDirectorio } of cambios) {
                        if (!ruta) continue;
                        const rutaAbsoluta = path.join(carpeta || config.projectRoot, ruta);
                        if (esDirectorio) {
                            if (!fs.existsSync(rutaAbsoluta)) {
                                fs.mkdirSync(rutaAbsoluta, { recursive: true });
                                const gitkeep = path.join(rutaAbsoluta, '.gitkeep');
                                if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '', 'utf-8');
                            }
                            count++;
                            continue;
                        }
                        const dir = path.dirname(rutaAbsoluta);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(rutaAbsoluta, (contenido || '').trim(), 'utf-8');
                        count++;
                    }
                    return {
                        success: true,
                        status: 'completed',
                        output: info.output,
                        durationSeconds: info.durationSeconds,
                        archivosModificados: count
                    };
                } catch (e) {
                    console.error('[Job Recovery] Error aplicando cambios en disco:', e);
                }
            } else if ((modoEdicion || modoCreacion) && archivoDestino) {
                const dir = path.dirname(archivoDestino);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(archivoDestino, (info.output || '').trim(), 'utf-8');
            }

            return {
                success: true,
                status: 'completed',
                output: info.output,
                durationSeconds: info.durationSeconds
            };
        }

        return {
            success: true,
            status: info?.status || 'running',
            output: info?.output || '',
            durationSeconds: info?.durationSeconds || 0
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Procesar mensaje del usuario
ipcMain.on('mensaje-usuario', async (event, data) => {
    // Soportar tanto string directo como objeto estructurado { input, historial, carpeta, jobId }
    const inputTexto = typeof data === 'string' ? data : (data?.input || '');
    const historial = Array.isArray(data?.historial) ? data.historial : [];
    const carpeta = data?.carpeta || null;
    const jobId = data?.jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const parsed = procesarInputUsuario(inputTexto, carpeta || null);

    if (parsed.error) {
        event.sender.send('stream-ia', `[Error]: ${parsed.error}\n\n`);
        event.sender.send('fin-stream');
        return;
    }

    // Acción directa: Crear carpeta inmediatamente en el Workspace (sin quemar tokens de IA)
    if (parsed.crearCarpetaDirecta && carpeta) {
        try {
            const rutaDestino = path.join(carpeta, parsed.crearCarpetaDirecta);
            if (!fs.existsSync(rutaDestino)) {
                fs.mkdirSync(rutaDestino, { recursive: true });
                // Crear un .gitkeep para que git y el sistema reconozcan la carpeta
                const gitkeepPath = path.join(rutaDestino, '.gitkeep');
                if (!fs.existsSync(gitkeepPath)) {
                    fs.writeFileSync(gitkeepPath, '', 'utf-8');
                }
                event.sender.send('stream-ia', `✅ [Carpeta creada exitosamente en el Workspace]: ${parsed.crearCarpetaDirecta}\n\n📁 Ruta completa: ${rutaDestino}`);
            } else {
                event.sender.send('stream-ia', `ℹ️ La carpeta ya existe en el Workspace: ${parsed.crearCarpetaDirecta}`);
            }
        } catch (err) {
            event.sender.send('stream-ia', `❌ [Error creando carpeta]: ${err.message}`);
        }
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
    } else if (parsed.modoCreacion) {
        event.sender.send('stream-ia', `[Creando ${parsed.archivoDestino}...]\n\n`);
    } else if (parsed.modoEditaRepo) {
        event.sender.send('stream-ia', `[Analizando repositorio para edición múltiple...]\n\n`);
    }

    // ── Workspace Context ──────────────────────────────────────────────────────
    // Si hay workspace asignado, inyectarlo como mensaje 'system' en Ollama en lugar
    // de concatenarlo al prompt del usuario. Esto evita el "recency bias": los modelos
    // pequeños (< 14B) tienden a responder sobre lo que está más cercano a la instrucción,
    // ignorando el historial y confundiendo el código del repo con el sujeto de la pregunta.
    //
    // Estrategia de envío por turno de sesión:
    //   - Primer mensaje (historial vacío): repo completo → el modelo conoce todo el código.
    //   - Mensajes siguientes (historial > 0): solo mapa de archivos → no re-enviar los mismos
    //     tokens, el modelo ya los vio y los recuerda via su KV-cache.
    //   - Si commands.js ya cargó un archivo/repo explícito (workspaceYaCargado, /lee, etc.):
    //     solo mapa estructural para complementar sin duplicar.
    //
    // En modoEditaRepo: commands.js genera su propia instruccionSistema (la restricción JSON),
    // que reemplaza al systemPrompt del workspace para que el modelo no la olvide por recency bias.
    let systemPrompt = '';
    if (parsed.instruccionSistema) {
        // Modo agente autónomo: la instrucción JSON forzada tiene prioridad absoluta como system role
        systemPrompt = parsed.instruccionSistema;
    } else if (carpeta && !parsed.modoEdicion && !parsed.modoCreacion && !parsed.modoEditaRepo) {
        try {
            const { archivos, totalBytes, limitAlcanzado } = leerCarpetaRecursiva(carpeta);
            if (archivos.length > 0) {
                const mapEstructura =
                    `Workspace: ${carpeta}\n` +
                    `Archivos disponibles (${archivos.length}${limitAlcanzado ? ', hay más fuera del límite de carga' : ''}):\n` +
                    archivos.map(a => `- ${a.ruta}`).join('\n') + '\n';

                const esConversacionNueva = historial.filter(m => m.texto?.trim()).length === 0;
                const tieneContextoComando = parsed.workspaceYaCargado || parsed.contexto.includes('=== CONTENIDO DE:');

                if (!tieneContextoComando && esConversacionNueva) {
                    // Primer turno sin comando explícito: enviar el repo completo como 'system'
                    const { resumen } = formatearContextoCarpeta(carpeta, archivos, totalBytes, limitAlcanzado);
                    systemPrompt = resumen;
                } else {
                    // Turnos siguientes o si commands.js ya tiene el contexto: solo mapa
                    systemPrompt = mapEstructura;
                }
            }
        } catch (e) {
            console.error('[Workspace] Error leyendo carpeta del workspace:', e.message);
        }
    }

    // Notificar al renderer del Job ID para persistencia en sesión si la Mac se apaga
    event.sender.send('job-asignado', {
        jobId,
        carpeta: carpeta || null,
        modoEditaRepo: Boolean(parsed.modoEditaRepo),
        modoEdicion: Boolean(parsed.modoEdicion),
        modoCreacion: Boolean(parsed.modoCreacion),
        archivoDestino: parsed.archivoDestino || null
    });

    // El promptCompleto lleva el contenido del repo + instrucción del usuario.
    // En modoEditaRepo, parsed.contexto es '' (vacío) y parsed.promptFinal ya contiene todo estructurado.
    const promptCompleto = `${parsed.contexto}${parsed.promptFinal}`.trim();
    abortController = new AbortController();

    try {
        const respuestaFinal = await generarStream({
            jobId,
            prompt: promptCompleto,
            // instruccionSistema (restricción JSON) o workspace como rol 'system'
            systemPrompt,
            // En modos de edición/creación/skill usamos historial vacío para no contaminar el contexto.
            historial: (parsed.modoEdicion || parsed.modoCreacion || parsed.modoEditaRepo || parsed.skillAplicada)
                ? []
                : (historial || []),
            signal: abortController.signal,
            onChunk: (chunk) => event.sender.send('stream-ia', chunk),
            onReconnecting: (intento) => event.sender.send('stream-reconnecting', intento)
        });

        // Si fue edición o creación individual
        if ((parsed.modoEdicion || parsed.modoCreacion) && parsed.archivoDestino) {
            const dir = path.dirname(parsed.archivoDestino);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(parsed.archivoDestino, respuestaFinal.trim(), 'utf-8');
            const verbo = parsed.modoCreacion ? 'Creado' : 'Guardado';
            event.sender.send('stream-ia', `\n\n✅ [${verbo} en ${parsed.archivoDestino}]`);
        }

        // Si fue edición de repositorio (múltiples archivos)
        if (parsed.modoEditaRepo) {
            try {
                const cambios = parsearCambiosMultiples(respuestaFinal);
                if (!cambios || cambios.length === 0) {
                    throw new Error('No se detectaron bloques de código ni JSON estructurado para escribir');
                }

                let count = 0;
                for (const { ruta, contenido, esDirectorio } of cambios) {
                    if (!ruta) continue;
                    const rutaAbsoluta = path.join(carpeta || config.projectRoot, ruta);

                    if (esDirectorio) {
                        if (!fs.existsSync(rutaAbsoluta)) {
                            fs.mkdirSync(rutaAbsoluta, { recursive: true });
                            const gitkeep = path.join(rutaAbsoluta, '.gitkeep');
                            if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '', 'utf-8');
                        }
                        event.sender.send('stream-ia', `\n📁 [Directorio creado: ${ruta}]`);
                        count++;
                        continue;
                    }

                    const dir = path.dirname(rutaAbsoluta);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(rutaAbsoluta, (contenido || '').trim(), 'utf-8');
                    event.sender.send('stream-ia', `\n✅ [Guardado: ${ruta}]`);
                    count++;
                }
                event.sender.send('stream-ia', `\n\n🎯 [edita-repo completado: ${count} cambio(s) aplicado(s) en disco]`);
            } catch (err) {
                event.sender.send('stream-ia', `\n\n❌ [Error parseando cambios del modelo: ${err.message}]\nRespuesta cruda:\n${respuestaFinal.slice(0, 500)}`);
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
