# ⚡ Local Wireless LLM

> **Tu modelo de lenguaje local, acelerado por hardware remoto, disponible en tu Mac de forma inalámbrica.**

![macOS](https://img.shields.io/badge/macOS-Sonoma%20%2F%20Sequoia-000000?style=flat&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-Desktop-47848F?style=flat&logo=electron&logoColor=white)
![Ollama](https://img.shields.io/badge/Inferencia-Ollama-white?style=flat&logo=ollama&logoColor=black)
![Tailscale](https://img.shields.io/badge/Red-Tailscale%20WireGuard-202324?style=flat&logo=tailscale&logoColor=white)

---

## 🧭 ¿Qué es Local Wireless LLM?

**Local Wireless LLM** es una aplicación de escritorio nativa para macOS diseñada bajo un **modelo híbrido**:

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│     MACBOOK AIR / PRO           │                 │       PC / SERVIDOR ANFITRIÓN   │
│     (Cuerpo del Agente)         │                 │       (Cerebro de Inferencia)   │
│                                 │                 │                                 │
│  • UI nativa translúcida        │    Tailscale    │  • Aceleración GPU/NPU          │
│  • Acceso al sistema de archivos│ ◄─────────────► │  • Servidor Ollama              │
│  • Ejecución autónoma y Skills  │    WireGuard    │  • Modelos: qwen3-coder,        │
│  • Sin drenar batería ni RAM    │   (Cifrado P2P) │    gemma4:12b, qwen3.5, etc.    │
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

Esta arquitectura te permite tener **modelos pesados de 12B o 32B parámetros** programando o editando repositorios desde una laptop ligera, sin que se caliente ni gaste batería.

---

## 🚀 Guía de Configuración Inicial (Paso a Paso)

### 1. Preparar el Servidor / PC Anfitrión (Ollama)

En la máquina que tiene la tarjeta gráfica dedicada (GPU Nvidia/AMD/Apple Silicon o NPU):

1. **Instala Ollama:** Descárgalo desde [ollama.ai](https://ollama.ai).
2. **Permite conexiones desde la red:** Por defecto, Ollama solo escucha en `localhost`. Debes configurarlo para escuchar en todas las interfaces de red:
   - **En Windows (PowerShell como Administrador):**
     ```powershell
     [System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')
     ```
     *(Reinicia Ollama desde el área de notificaciones).*
   - **En Linux / macOS:**
     ```bash
     export OLLAMA_HOST=0.0.0.0:11434
     ollama serve
     ```
3. **Descarga tus modelos favoritos:**
   ```bash
   ollama run qwen3-coder
   ollama run gemma4:12b
   ollama run qwen3.5:4b
   ```

---

### 2. Conectar la Mac y la PC con Tailscale

[Tailscale](https://tailscale.com/) crea una red privada cifrada punto a punto (WireGuard) sin necesidad de abrir puertos en tu router ni configurar IP fija.

1. Instala **Tailscale** tanto en tu PC servidora como en tu Mac.
2. Inicia sesión con la misma cuenta en ambos dispositivos.
3. Copia la **IP de Tailscale de la PC servidora** (empieza con `100.x.y.z`, ej. `100.83.114.11`).

---

### 3. Iniciar la Aplicación en la Mac

No necesitas tocar ningún archivo de configuración. La aplicación cuenta con un **Asistente de Primer Inicio (Setup Wizard)**:

1. Clona el repositorio e instala las dependencias:
   ```bash
   git clone https://github.com/tu-usuario/local-wireless-LLM.git
   cd local-wireless-LLM
   npm install
   ```
2. Inicia la app:
   ```bash
   npm start
   ```
3. **Setup Automático:** Al abrir por primera vez, verás la ventana nativa de configuración:
   - Pega tu IP de Tailscale (ejemplo: `100.83.114.11:11434`).
   - Pulsa **"Probar y Guardar"**.
   - La app se conectará automáticamente, listará todos los modelos que tienes instalados en Ollama y los dejará listos en el selector superior.

> 💡 **¿Cambió tu IP de Tailscale?**
> No necesitas recompilar ni editar archivos. Haz clic en el icono **⚙️** en la barra superior junto al selector de modelos para cambiar la IP o volver a escanear tus modelos en cualquier momento.

---

## 🛠️ Comandos del Sistema (`/`)

Al presionar `/` en el campo de texto aparece un menú contextual flotante con autocompletado:

| Comando | Tipo | Descripción |
| :--- | :--- | :--- |
| `/lee <archivo\|carpeta>` | Lectura | Inyecta el contenido de un archivo o directorio en el contexto del modelo. |
| `/lee-repo [pregunta]` | Lectura | Empaqueta todo el repositorio local (respetando filtros) y responde sobre él. |
| `/lee-carpeta <dir>` | Lectura | Analiza recursivamente cualquier carpeta en tu Mac. |
| `/edita <archivo> <instrucción>` | Escritura | Modifica un archivo y guarda los cambios de inmediato en el disco. |
| `/edita-repo <instrucción>` | Escritura | Analiza el repositorio completo y modifica múltiples archivos de forma autónoma. |

---

## 🧠 Ecosistema de Skills (`skills/`)

Puedes enseñarle nuevas habilidades a tu modelo creando archivos Markdown en la carpeta `skills/`.

Ejemplo: `skills/refactorizar.md`
```markdown
---
name: refactorizar
description: Aplica Clean Code y SOLID sin alterar la interfaz pública.
triggers: ["refactorizar", "clean-code", "modularizar"]
---
# Instrucciones de la Skill:
1. Divide funciones complejas de más de 30 líneas.
2. Prioriza inmutabilidad y nombres expresivos.
```

### Formas de uso:
- **Slash directo:** Escribe `/refactorizar` y la skill se cargará en el prompt.
- **Inferencia contextual:** Si dices *"Oye, ayúdame a refactorizar este componente"*, el agente detecta la palabra clave y aplica automáticamente la skill correspondiente.

---

## 🖥️ Modo CLI (Terminal Interactiva)

Si prefieres trabajar desde la terminal sin interfaz gráfica:

```bash
npm run cli
```

- Soporta todos los comandos `/lee`, `/edita` y `/edita-repo`.
- Puedes cambiar de modelo en caliente escribiendo `/modelo qwen3-coder`.

---

## 📦 Compilar y Empaquetar la App (.dmg para macOS)

Para generar la aplicación nativa lista para arrastrar a tu carpeta `/Applications`:

```bash
npm run dist:mac
```

Esto generará el archivo instalador `.dmg` en la carpeta `dist/`. La app es totalmente portable y conservará tu configuración de Tailscale incluso entre actualizaciones.

---

## 📄 Licencia

Distribuido bajo la Licencia ISC. Consulta el archivo `LICENSE` para más información.
