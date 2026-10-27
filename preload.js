const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
    enviarMensaje: (texto) => ipcRenderer.send('mensaje-usuario', texto),
    onStream: (callback) => ipcRenderer.on('stream-ia', (event, chunk) => callback(chunk)),
    onFinStream: (callback) => ipcRenderer.on('fin-stream', () => callback()),
    detenerGeneracion: () => ipcRenderer.send('detener-generacion'),
    seleccionarArchivo: () => ipcRenderer.invoke('seleccionar-archivo'),
    obtenerRutaArchivo: (file) => webUtils ? webUtils.getPathForFile(file) : file.path,
    
    // Métodos para selector de modelos y skills
    obtenerModelos: () => ipcRenderer.invoke('obtener-modelos'),
    cambiarModelo: (nuevoModelo) => ipcRenderer.invoke('cambiar-modelo', nuevoModelo),
    obtenerSkills: () => ipcRenderer.invoke('obtener-skills')
});
