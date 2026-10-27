# local-wireless-LLM

> **An extension of your Local LLM now available everywhere**  
> Conecta tu Mac de forma inalámbrica a tu propio servidor de modelos de lenguaje local (Ollama) a través de tu red privada (Tailscale o LAN), con una interfaz nativa de escritorio en Electron y un agente interactivo por consola.

---

## 📋 Tabla de Contenidos

1. [Descripción General](#-descripción-general)
2. [Arquitectura](#-arquitectura)
3. [Requisitos Previos](#-requisitos-previos)
4. [Instalación en macOS](#-instalación-en-macos)
5. [Configuración del Servidor Host (Ollama)](#-configuración-del-servidor-host-ollama)
6. [Variables de Entorno (`.env`)](#-variables-de-entorno-env)
7. [Modos de Uso](#-modos-de-uso)
   - [1. Aplicación de Escritorio (Electron)](#1-aplicación-de-escritorio-electron)
   - [2. Agente de Consola (CLI)](#2-agente-de-consola-cli)
8. [Comandos y Sintaxis Especial](#-comandos-y-sintaxis-especial)
9. [Estructura del Proyecto](#-estructura-del-proyecto)
10. [Solución de Problemas Comunes](#-solución-de-problemas-comunes)

---

## 🚀 Descripción General

**local-wireless-LLM** permite aprovechar la potencia de procesamiento de un equipo anfitrión (por ejemplo, una PC de escritorio con GPU dedicada o un servidor local ejecutando Ollama) desde cualquier MacBook o Mac conectada a través de una red mallada privada y cifrada con [Tailscale](https://tailscale.com/) o mediante tu red WiFi local.

El proyecto incluye dos clientes:
- **Desktop App (Electron):** Interfaz gráfica minimalista en modo oscuro con diseño nativo de macOS (ventana sin bordes, botones integrados en la barra de título, soporte para arrastrar archivos y múltiples sesiones de chat).
- **CLI Agent (`agents.js`):** Interfaz ligera de terminal con salida en streaming por colores utilizando `chalk`.

---

## 🏗 Arquitectura

```text
┌─────────────────────────┐               Tailscale VPN / LAN             ┌─────────────────────────┐
│     Macbook / Mac       │  ◄────────────────────────────────────────►  │      PC / Servidor      │
│                         │                                               │                         │
│  - App Electron (GUI)   │         HTTP POST /api/generate               │  - Ollama Server        │
│  - Agente CLI (Node.js) │         (Streaming Text chunks)               │  - GPU Acceleration    │
│  - Sistema de archivos  │                                               │  - Modelos (Qwen, etc.) │
└─────────────────────────┘                                               └─────────────────────────┘
```

---

## 📦 Requisitos Previos

### En tu Mac (Cliente):
- **macOS:** Compatible con Apple Silicon (M1/M2/M3/M4) e Intel.
- **Node.js:** Versión 18.0.0 o superior (recomendado Node.js 20 LTS o 22). Verifica con `node -v`.
- **npm:** Incluido con Node.js. Verifica con `npm -v`.
- **Tailscale (o red local):** Instalado y autenticado en tu cuenta de Tailscale.

### En la PC o Servidor (Host con Ollama):
- [Ollama](https://ollama.ai/) instalado y funcionando.
- Modelo descargado (por ejemplo, `qwen3.5:4b`, `llama3.2`, `mistral`, etc.).
- Conexión a Tailscale activa en la misma cuenta / tailnet.
- **Ollama escuchando en red:** Por defecto Ollama solo escucha en `127.0.0.1`. Debe configurarse para escuchar en `0.0.0.0:11434` (ver sección [Configuración del Servidor Host](#-configuración-del-servidor-host-ollama)).

---

## 💻 Instalación en macOS

Sigue estos pasos en cualquier Mac donde desees instalar y ejecutar el proyecto:

### 1. Clonar el repositorio
Abre la aplicación **Terminal** en tu Mac y clona el proyecto:

```bash
git clone https://github.com/Taggie-Technologies/local-wireless-LLM.git
cd local-wireless-LLM
```

*(Si lo recibiste como archivo zip o carpeta, simplemente descomprímelo y entra a la carpeta desde la terminal)*.

### 2. Instalar dependencias de Node.js
Ejecuta el siguiente comando para instalar las librerías necesarias (Electron, Chalk, Dotenv):

```bash
npm install
```

### 3. Configurar el archivo de entorno (`.env`)
Copia la plantilla de ejemplo `.env.example` para crear tu propio archivo `.env`:

```bash
cp .env.example .env
```

Abre `.env` con tu editor preferido (o con `nano .env` / `code .env`) y define la IP de Tailscale de tu servidor host y el modelo a utilizar:

```env
OLLAMA_HOST="100.x.x.x:11434"
OLLAMA_MODEL="qwen3.5:4b"
```

> 💡 **Nota:** La IP `100.x.x.x` corresponde a la dirección IP privada que Tailscale le asigna a tu máquina host. Puedes encontrarla abriendo la app de Tailscale en tu host o en [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines).

---

## 🖥 Configuración del Servidor Host (Ollama)

Para que tu Mac pueda conectarse a Ollama a través de la red, el host debe aceptar conexiones externas:

### En Linux (systemd):
1. Edita el servicio de systemd:
   ```bash
   sudo systemctl edit ollama.service
   ```
2. Agrega bajo la sección `[Service]`:
   ```ini
   [Service]
   Environment="OLLAMA_HOST=0.0.0.0"
   ```
3. Guarda y recarga el servicio:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

### En Windows:
1. Abre **Configuración del sistema** > **Variables de entorno**.
2. Agrega una variable de usuario o del sistema:
   - Nombre: `OLLAMA_HOST`
   - Valor: `0.0.0.0`
3. Cierra Ollama desde la bandeja del sistema (ícono al lado del reloj) y vuelve a abrirlo.

### En macOS (Servidor):
Si tu host es otra Mac con Apple Silicon ejecutando Ollama:
```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
# O ejecuta Ollama en primer plano en una terminal:
OLLAMA_HOST=0.0.0.0 ollama serve
```

---

## ⚙️ Variables de Entorno (`.env`)

| Variable | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `OLLAMA_HOST` | Dirección IP y puerto del servidor Ollama (IP de Tailscale o LAN). | `100.83.114.11:11434` |
| `OLLAMA_MODEL` | Nombre del modelo que Ollama tiene descargado localmente. | `qwen3.5:4b`, `llama3.2:3b` |

---

## 🎮 Modos de Uso

### 1. Aplicación de Escritorio (Electron)

Inicia la aplicación gráfica ejecutando:

```bash
npm start
```

#### Características de la interfaz:
- **Diseño nativo para macOS:** Ventana oscura con esquinas redondeadas y controles de ventana (`traffic lights`) integrados.
- **Panel lateral de sesiones:** Botón `+` para crear nuevas conversaciones independientes.
- **Streaming en tiempo real:** Respuestas fluidas mientras se van generando token por token.
- **Botón de pánico:** Botón rojo **Detener ⏹** para abortar de inmediato cualquier respuesta en curso.
- **Carga de archivos:**
  - Botón **`+`** junto a la caja de texto para abrir el selector nativo de archivos de macOS.
  - **Drag & Drop:** Arrastra cualquier archivo directamente a la ventana de la aplicación.
- **Edición rápida de mensajes:** Haz clic en cualquiera de tus mensajes previos para cargarlo de nuevo en la caja de entrada.

---

### 2. Agente de Consola (CLI)

Si prefieres trabajar directamente desde la terminal de macOS:

```bash
node agents.js
```

El CLI te permite dialogar en streaming coloreado (`chalk`) y acepta los mismos comandos de lectura de archivos. Para salir, escribe `salir` o `exit`.

---

## 🪄 Comandos y Sintaxis Especial

Tanto en la aplicación de escritorio como en el agente por consola puedes usar comandos especiales para interactuar directamente con los archivos locales de tu Mac:

### 1. Analizar / Leer un archivo o carpeta (`lee`)
Carga el contenido de un archivo (o los archivos de una carpeta) en memoria y lo envía al modelo:

```text
lee ruta/del/archivo.js Explica qué hace esta función
```
o con rutas con comillas y espacios:
```text
lee "/Users/usuario/Desktop/mi script.py" Optimiza el uso de memoria
```
Si la ruta corresponde a una carpeta, se leerá automáticamente como directorio:
```text
lee ./src Explica qué componentes existen aquí
```

### 2. Analizar todo el repositorio actual (`lee-repo`)
Recorre el proyecto actual, ignora `node_modules`, `.git` y archivos pesados/sensibles, y envía la estructura y archivos relevantes al modelo:

```text
lee-repo Explica la arquitectura global de este proyecto
```

### 3. Analizar una carpeta específica (`lee-carpeta`)
Lee recursivamente los archivos de código dentro de la carpeta indicada:

```text
lee-carpeta src/controllers Analiza la lógica de controladores
```

### 4. Editar y sobreescribir automáticamente un archivo (`edita`)
*(Disponible en la aplicación Electron)*  
Lee el archivo objetivo, instruye al modelo para que genere el código modificado y **guarda automáticamente los cambios en el archivo en tu disco**:

```text
edita index.js Agrega manejo de errores con try/catch en la función principal
```

> ⚠️ **Precaución al usar `edita`:** El comando sobreescribe el archivo especificado directamente con la salida generada por el modelo. Se recomienda tener control de versiones (Git) o una copia de respaldo antes de ejecutarlo.

---

## 📁 Estructura del Proyecto

```text
local-wireless-LLM/
├── .env.example       # Plantilla de variables de entorno para nuevas máquinas
├── .gitignore          # Archivos excluidos de Git (node_modules, .env)
├── AGENTS.md           # Especificación y documentación de los agentes del sistema
├── README.md           # Guía de instalación y uso en macOS
├── LICENSE             # Licencia del proyecto
├── package.json        # Dependencias y scripts de npm
├── main.js             # Proceso principal de Electron (IPC, I/O de archivos, fetch a Ollama)
├── preload.js          # Puente seguro contextBridge entre Electron y el frontend
├── index.html          # Interfaz de usuario (HTML y lógica del cliente)
├── styles.css          # Estilos CSS modernos optimizados para macOS
└── agents.js           # Agente CLI interactivo para terminal
```

---

## 🛠 Solución de Problemas Comunes

### 1. `[Error de conexión con la PC]` o `FetchError: connect ECONNREFUSED`
- **Verifica Tailscale:** Asegúrate de que tanto tu Mac como el host tengan Tailscale encendido y estén en la misma red.
- **Comprueba el ping:** Desde tu Mac, ejecuta en la terminal `ping <IP_TAILSCALE_HOST>`.
- **Comprueba el puerto de Ollama:** Ejecuta `curl http://<IP_TAILSCALE_HOST>:11434` en tu Mac. Debe responder con `"Ollama is running"`.
- **Configuración de host:** Asegúrate de que el host tenga configurado `OLLAMA_HOST=0.0.0.0` y no solo `127.0.0.1`.

### 2. `Error: Falta OLLAMA_HOST en el archivo .env`
- No creaste el archivo `.env`. Ejecuta `cp .env.example .env` y añade los valores correspondientes.

### 3. Error al ejecutar `npm start` en macOS
- Asegúrate de haber ejecutado `npm install` previamente.
- Si macOS bloquea Electron o muestra una alerta de seguridad, ve a **Ajustes del Sistema > Privacidad y seguridad** y autoriza la ejecución.

### 4. Permisos de lectura/escritura de archivos
- Al usar los comandos `lee` o `edita`, asegúrate de proporcionar una ruta accesible por el usuario actual de macOS. Si utilizas rutas relativas, se tomarán a partir del directorio donde se inició la aplicación.

---

## 📄 Licencia

Este proyecto está bajo los términos de su licencia incluida en el archivo [LICENSE](LICENSE).
