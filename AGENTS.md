# Especificación de Agentes y Arquitectura del Sistema (`AGENTS.md`)

Este documento describe la arquitectura, el diseño operativo, las capacidades autónomas y las directrices técnicas para los agentes de software y asistentes de IA integrados o desarrollados en el ecosistema **local-wireless-LLM**.

---

## 1. Visión y Filosofía

**local-wireless-LLM** está diseñado bajo un modelo híbrido cliente-servidor:
- **Cerebro Remoto (Inferencia LLM):** Alojado en un equipo anfitrión con aceleración por hardware (GPU/NPU) ejecutando [Ollama](https://ollama.ai/), accesible sin cables a través de una red mallada WireGuard cifrada ([Tailscale](https://tailscale.com/)) o LAN.
- **Cuerpo Local (Agente de Ejecución en macOS):** Reside en la Mac del usuario y tiene acceso directo a la interfaz gráfica, el sistema de archivos local, las APIs del sistema operativo y la terminal.

Esta separación permite que computadoras ligeras (como un MacBook Air) dispongan de modelos de lenguaje potentes y privados sin drenar su batería ni saturar la memoria RAM local.

---

## 2. Tipos de Agentes en el Repositorio

El proyecto implementa dos agentes complementarios que comparten la misma interfaz de inferencia remota:

### 2.1. Agente Gráfico de Escritorio (`main.js` + `preload.js` + `index.html`)
- **Entorno:** Electron (Node.js ESM + Chromium).
- **Rol:** Agente conversacional interactivo para el flujo de trabajo diario de desarrollo y análisis de código.
- **Características clave:**
  - Comunicación asíncrona bidireccional entre el proceso de renderizado y el proceso principal mediante IPC seguro (`contextBridge`).
  - Capacidad de streaming token por token con cancelación instantánea mediante `AbortController`.
  - Múltiples sesiones de conversación concurrentes almacenadas en memoria.
  - Soporte de arrastre de archivos (*Drag & Drop*) y explorador de archivos nativo de macOS (`dialog.showOpenDialog`).
  - Capacidad de sobreescritura autónoma en disco (`edita`).

### 2.2. Agente de Consola CLI (`agents.js`)
- **Entorno:** Node.js puro (ES Modules) ejecutado directamente en la terminal.
- **Rol:** Agente ligero de automatización y consulta rápida sin sobrecarga gráfica.
- **Características clave:**
  - Salida visualmente formateada con `chalk` y streaming en tiempo real a `process.stdout`.
  - Bucle interactivo REPL basado en `readline`.
  - Detección y análisis rápido de archivos locales.

---

## 3. Protocolos de Comunicación e IPC

### 3.1. Enlace con Ollama (Capa de Red)
Ambos agentes se comunican con el servidor host mediante el endpoint estándar de Ollama:
```http
POST http://${OLLAMA_HOST}/api/generate
Content-Type: application/json

{
  "model": "${OLLAMA_MODEL}",
  "prompt": "<Contexto del sistema y archivos> + <Instrucción del usuario>",
  "stream": true
}
```

La respuesta es recibida como un flujo **NDJSON** (*Newline Delimited JSON*):
```json
{"model":"qwen3.5:4b","created_at":"...","response":"Hola","done":false}
```
El agente decodifica cada chunk usando `TextDecoder("utf-8")`, filtra saltos de línea y envía el fragmento de texto a la interfaz.

### 3.2. Canales IPC en Electron (`main.js` ↔ `preload.js`)
La aplicación Electron desacopla la lógica del sistema del frontend usando los siguientes canales:

| Canal IPC | Tipo | Dirección | Descripción |
| :--- | :--- | :--- | :--- |
| `mensaje-usuario` | `ipcMain.on` | Renderer ➔ Main | Envía el prompt o comando del usuario al proceso principal para su procesamiento. |
| `stream-ia` | `event.sender.send` | Main ➔ Renderer | Emite cada token o fragmento de texto generado por el LLM en tiempo real. |
| `fin-stream` | `event.sender.send` | Main ➔ Renderer | Notifica que la generación ha concluido para restablecer los estados de UI. |
| `detener-generacion` | `ipcMain.on` | Renderer ➔ Main | Dispara el `abortController.abort()` para cancelar la petición HTTP en curso. |
| `seleccionar-archivo` | `ipcMain.handle` | Renderer ⇄ Main | Abre el diálogo nativo de macOS para seleccionar un archivo del disco. |

---

## 4. Capacidades Autónomas (Herramientas del Agente)

El sistema procesa el input del usuario buscando comandos especializados antes de enviar la solicitud al LLM:

### 4.1. Herramienta de Lectura e Inyección de Contexto (`lee`, `lee-carpeta`, `lee-repo`)
- **Patrones Regex:**
  - `lee`: `/^lee\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i` (Detecta automáticamente si la ruta es un archivo o una carpeta).
  - `lee-repo`: `/^lee-repo\s*(.*)/i` (Carga el repositorio de trabajo actual `process.cwd()`).
  - `lee-carpeta`: `/^lee-carpeta\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i`
- **Comportamiento:**
  1. Si es un archivo individual: Lee el archivo del disco local usando `fs.readFileSync(ruta, 'utf-8')` y lo inyecta delimitado por bloques.
  2. Si es una carpeta o repositorio: Ejecuta `leerCarpetaRecursiva()`, ignorando directorios pesados (`node_modules`, `.git`, `dist`, `.env`) y extensiones no textuales, empaqueta la lista de archivos con sus contenidos respetando límites seguros de tamaño/tokens y construye un super-contexto unificado.
  3. Concatena la instrucción del usuario y envía el prompt resultante a Ollama.

### 4.2. Herramienta de Modificación y Sobreescritura en Disco (`edita`)
- **Patrón Regex:** `/^edita\s+(?:"([^"]+)"|([^\s]+))\s*(.*)/i`
- **Comportamiento:**
  1. Extrae la ruta del archivo a modificar.
  2. Lee el contenido original del archivo para proporcionarlo como contexto base.
  3. Formula un prompt restrictivo con regla estricta:
     ```text
     Código actual de <archivo>:
     <contenido>

     Instrucción: <instrucción_usuario>

     REGLA ESTRICTA: Devuelve ÚNICAMENTE el código final modificado. Sin saludos, explicaciones ni bloques markdown.
     ```
  4. Muestra en la pantalla el streaming de la modificación en curso.
  5. Acumula la respuesta generada en `respuestaAcumulada`.
  6. Al completarse la respuesta del modelo, ejecuta:
     ```javascript
     fs.writeFileSync(archivoDestino, respuestaAcumulada.trim(), 'utf-8');
     ```
  7. Confirma al usuario con `✅ [Guardado en <archivoDestino>]`.

---

## 5. Directrices para Desarrolladores y Agentes de IA

Si un modelo de IA o un desarrollador va a modificar o extender esta base de código, debe seguir las siguientes reglas:

1. **Módulos ES (`"type": "module"`):**
   - El proyecto utiliza módulos ECMAScript estándar (`import`/`export`).
   - Siempre que se requiera la ruta del directorio en el proceso principal de Electron, usar:
     ```javascript
     import { fileURLToPath } from 'url';
     const __dirname = path.dirname(fileURLToPath(import.meta.url));
     ```
   - El script `preload.js` utiliza sintaxis CommonJS compatible con Electron (`contextBridge`, `ipcRenderer`). No transformar `preload.js` a ESM sin adaptar la configuración del webPreferences.

2. **Seguridad y Aislamiento de Contexto:**
   - Mantener siempre `contextIsolation: true` en `webPreferences`.
   - No habilitar `nodeIntegration: true` en el frontend para evitar vectores de inyección de código.

3. **Manejo de Rutas de Archivos en macOS:**
   - Soportar rutas con espacios o comillas si el usuario arrastra un archivo que contenga espacios en su nombre.
   - Resolver rutas relativas respecto al directorio de trabajo actual (`process.cwd()`).

4. **Variables de Entorno:**
   - No hardcodear IPs ni nombres de modelos en el código fuente.
   - Utilizar siempre `process.env.OLLAMA_HOST` y `process.env.OLLAMA_MODEL`.
   - Cualquier nueva variable requerida debe registrarse tanto en `.env` como en `.env.example`.

5. **Manejo de Errores de Red:**
   - Las llamadas a `fetch` deben estar envueltas en bloques `try...catch` con captura explícita de `AbortError` (para cancelaciones deliberadas por parte del usuario) y de errores de conexión (`ECONNREFUSED`, timeout) para proveer retroalimentación clara sobre el estado de Tailscale.

---

## 6. Hoja de Ruta para Nuevos Agentes y Capacidades

Mejoras sugeridas para versiones futuras del agente:
- [x] **Soporte de Multi-archivos y Carpetas:** Soporte para `lee-repo`, `lee-carpeta <dir>` y auto-detección de carpetas en `lee`.
- [ ] **Modo Diff / Dry-run para `edita`:** Mostrar una previsualización de diferencias (diff) antes de escribir los cambios en el disco.
- [ ] **Agente de Ejecución de Comandos (Bash/Zsh):** Incorporar un comando `ejecuta <comando>` con confirmación explícita del usuario en macOS.
- [ ] **Historial Persistente:** Guardar las sesiones de chat en SQLite o archivos JSON locales para conservarlas tras reiniciar la app.
- [ ] **Soporte de Parámetros de Inferencia:** Configurar dinámicamente temperatura, `top_p` y tamaño de contexto (`num_ctx`) en la petición a Ollama.
