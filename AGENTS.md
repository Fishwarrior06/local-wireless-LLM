# Especificación de Agentes y Arquitectura del Sistema (`AGENTS.md`)

Este documento describe la arquitectura modular, el diseño operativo, el ecosistema de **Skills**, el soporte multimodelo y las directrices técnicas para los agentes de software en el ecosistema **local-wireless-LLM**.

---

## 1. Visión y Filosofía

**local-wireless-LLM** está diseñado bajo un modelo híbrido cliente-servidor:
- **Cerebro Remoto (Inferencia LLM):** Alojado en un equipo anfitrión con aceleración por hardware (GPU/NPU) ejecutando [Ollama](https://ollama.ai/), accesible sin cables a través de una red mallada WireGuard cifrada ([Tailscale](https://tailscale.com/)) o LAN.
- **Cuerpo Local (Agente de Ejecución en macOS):** Reside en la Mac del usuario y tiene acceso directo a la interfaz gráfica, el sistema de archivos local, las APIs del sistema operativo y la terminal.

---

## 2. Estructura Modular del Proyecto (`src/`)

El backend ha sido refactorizado en módulos especializados para evitar duplicidad de código:

```text
local-wireless-LLM/
├── skills/                     # Skills en Markdown (.md con frontmatter)
│   ├── refactorizar.md         # Clean Code y SOLID
│   ├── documentar.md           # Generación de JSDoc y comentarios
│   └── testear.md              # Pruebas unitarias
│
├── src/
│   ├── config.js               # Rutas absolutas, persistencia en userData y gestión de modelo
│   ├── fs-tools.js             # Recorrido recursivo seguro y formateo de carpetas/repos
│   ├── skills-loader.js        # Carga, parseo y detección contextual de skills
│   ├── ollama.js               # Cliente HTTP stream (/api/chat), cancelación y listado de modelos
│   └── commands.js             # Parser de comandos y soporte de workspace dinámico
│
├── ui/                         # Frontend Liquid Glass (macOS 26/27)
│   ├── index.html              # Chat canvas, setup wizard, modal de modelos, workspaces
│   ├── styles.css              # Sistema de diseño Liquid Glass con animaciones nativas
│   └── assets/                 # Iconos e imágenes del sistema
│
├── main.js                     # Proceso Electron (Ventana, IPC, Dock, menús nativos)
├── agents.js                   # CLI interactivo (Readline + Chalk)
├── preload.js                  # IPC seguro (contextBridge)
└── AGENTS.md
```

---

## 3. Selector y Gestión Dinámica de Modelos

El sistema soporta conmutación en caliente entre múltiples modelos (ej. `qwen3.5:4b`, `qwen3-coder`, `gemma4:12b`):

- **Electron:** Un menú desplegable en la barra superior (`#select-modelo`) consulta `/api/tags` en Ollama y permite cambiar de modelo instantáneamente mediante el canal IPC `cambiar-modelo`.
- **CLI (`agents.js`):** El usuario puede escribir `/modelo <nombre>` (ej. `/modelo qwen3-coder`) para alternar el modelo activo en tiempo de ejecución.

---

## 4. Workspaces por Sesión (Estilo Antigravity)

Cada conversación en la aplicación puede tener asignada una **carpeta de trabajo (Workspace)** local:
1. **Asignación:** Haciendo clic derecho sobre cualquier sesión en la barra lateral ➔ `📂 Asignar Workspace`.
2. **Contexto Automático:** Si una sesión tiene un workspace asignado, el agente inyecta de forma autónoma el mapa y contenido de los archivos relevantes como contexto inicial. No es necesario usar prefijos `/lee` ni comandos manuales: el modelo sabe qué archivos existen y cómo están estructurados.
3. **Indicador Visual:** La barra superior muestra una píldora con el nombre del repositorio activo (`📂 <nombre-carpeta>`), y la sesión en el sidebar muestra el distintivo 📂.
4. **Edición contextual:** Los comandos de modificación (`edita`, `edita-repo`) y las preguntas operan directamente sobre la raíz del workspace de esa conversación.

---

## 5. Ecosistema de Skills (`skills/*.md`)

Cada skill reside en la carpeta `skills/` como un archivo Markdown con metadatos YAML en el encabezado:

```markdown
---
name: refactorizar
description: Aplica Clean Code y SOLID sin alterar la funcionalidad.
triggers: ["refactorizar", "clean-code", "modularizar"]
---
# Directrices de la Skill...
```

### Modos de activación:
1. **Comando Directo (Slash):** Escribiendo `/<nombre>` (ej. `/refactorizar edita main.js`). Aparecen automáticamente en el popup flotante del chat.
2. **Comando Explícito:** Escribiendo `/skill <nombre> <instrucción>`.
3. **Inferencia Contextual:** Si el prompt del usuario incluye palabras clave definidas en `triggers`, el agente inyecta automáticamente las directrices de la skill como supercontexto.

---

## 6. Capacidades Autónomas (Herramientas del Agente)

| Comando / Modo | Tipo | Acción |
| :--- | :--- | :--- |
| **Workspace Sesión** | Autónomo | Inyección automática del repositorio asignado a la sesión en cada mensaje. |
| `/lee <archivo\|carpeta>` | Lectura | Inyecta el contenido de un archivo o directorio específico en el contexto. |
| `/lee-repo [pregunta]` | Lectura | Empaqueta todo el repositorio de trabajo y responde preguntas sobre él. |
| `/lee-carpeta <dir>` | Lectura | Lee recursivamente el árbol de código de una carpeta dada. |
| `/edita <archivo> <instrucción>` | Escritura | Modifica un único archivo y lo sobreescribe en disco. |
| `/edita-repo <instrucción>` | Escritura | Genera un JSON estructurado con múltiples archivos y los actualiza autónomamente. |
| `/<skill> [instrucción]` | Skill | Activa directrices especializadas desde `skills/*.md`. |

---

## 7. Canales IPC en Electron (`main.js` ↔ `preload.js`)

| Canal IPC | Tipo | Dirección | Descripción |
| :--- | :--- | :--- | :--- |
| `mensaje-usuario` | `ipcMain.on` | Renderer ➔ Main | Procesa `{ input, historial, carpeta }`. |
| `stream-ia` | `event.sender.send` | Main ➔ Renderer | Emite cada token generado en tiempo real. |
| `fin-stream` | `event.sender.send` | Main ➔ Renderer | Notifica fin de transmisión y persiste sesión. |
| `detener-generacion` | `ipcMain.on` | Renderer ➔ Main | Cancela la petición HTTP vía `AbortController`. |
| `seleccionar-archivo` | `ipcMain.handle` | Renderer ⇄ Main | Diálogo nativo de selección de archivos. |
| `seleccionar-carpeta-workspace` | `ipcMain.handle` | Renderer ⇄ Main | Diálogo nativo para vincular carpeta a una sesión. |
| `obtener-modelos` | `ipcMain.handle` | Renderer ⇄ Main | Consulta modelos disponibles en Ollama (`/api/tags`). |
| `cambiar-modelo` | `ipcMain.handle` | Renderer ⇄ Main | Cambia el modelo activo en tiempo real. |
| `obtener-skills` | `ipcMain.handle` | Renderer ⇄ Main | Devuelve las skills para autocompletado en el frontend. |
| `test-conexion-ollama` | `ipcMain.handle` | Renderer ⇄ Main | Valida conectividad y latencia contra el host de Ollama. |
| `guardar-config-ip` | `ipcMain.handle` | Renderer ⇄ Main | Persiste la configuración del host e idioma en disco. |
