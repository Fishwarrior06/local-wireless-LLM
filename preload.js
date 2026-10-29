const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
    enviarMensaje: (texto, historial, carpeta) => ipcRenderer.send('mensaje-usuario', { input: texto, historial, carpeta }),
    onStream: (callback) => ipcRenderer.on('stream-ia', (event, chunk) => callback(chunk)),
    onFinStream: (callback) => ipcRenderer.on('fin-stream', () => callback()),
    detenerGeneracion: () => ipcRenderer.send('detener-generacion'),
    seleccionarArchivo: () => ipcRenderer.invoke('seleccionar-archivo'),
    seleccionarCarpetaWorkspace: () => ipcRenderer.invoke('seleccionar-carpeta-workspace'),
    obtenerRutaArchivo: (file) => webUtils ? webUtils.getPathForFile(file) : file.path,
    
    // Métodos para selector de modelos y skills
    obtenerModelos: () => ipcRenderer.invoke('obtener-modelos'),
    cambiarModelo: (nuevoModelo) => ipcRenderer.invoke('cambiar-modelo', nuevoModelo),
    obtenerSkills: () => ipcRenderer.invoke('obtener-skills'),

    // Setup y configuración de IP Tailscale
    testConexionOllama: (host) => ipcRenderer.invoke('test-conexion-ollama', host),
    guardarConfigIP: (datos) => ipcRenderer.invoke('guardar-config-ip', datos),

    // Inferencia Asíncrona Desacoplada & Recuperación de Desconexión
    onJobAsignado: (callback) => ipcRenderer.on('job-asignado', (event, data) => callback(data)),
    onStreamReconnecting: (callback) => ipcRenderer.on('stream-reconnecting', (event, intento) => callback(intento)),
    onSistemaResumed: (callback) => ipcRenderer.on('sistema-resumed', () => callback()),
    consultarJobPendiente: (datos) => ipcRenderer.invoke('consultar-job-pendiente', datos)
});
