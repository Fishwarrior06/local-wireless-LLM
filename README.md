# ⚡ Local-LLM

> **Tu modelo de lenguaje local, acelerado por hardware remoto, disponible en tu Mac de forma inalámbrica y privada.**

![macOS](https://img.shields.io/badge/macOS-Sonoma%20%2F%20Sequoia-000000?style=flat&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Desktop-Native%20Vibrancy-47848F?style=flat&logo=electron&logoColor=white)
![Ollama](https://img.shields.io/badge/Inference-Ollama-white?style=flat&logo=ollama&logoColor=black)
![Tailscale](https://img.shields.io/badge/Network-Tailscale%20WireGuard-202324?style=flat&logo=tailscale&logoColor=white)

---

## 🧭 ¿Cómo funciona?

**Local-LLM** te permite utilizar modelos de IA potentes en una laptop ligera (como una MacBook Air) sin saturar su memoria RAM, calentar el equipo ni agotar la batería.

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│     TU MAC (MacBook / Mac Mini) │                 │     PC ANFITRIONA / SERVIDOR    │
│     (Cuerpo del Agente)         │                 │     (Cerebro del LLM con GPU)   │
│                                 │    Tailscale    │                                 │
│  • App nativa Local-LLM (.dmg)  │ ◄─────────────► │  • Servidor Ollama con GPU      │
│  • Acceso al sistema de archivos│    WireGuard    │  • qwen3.5, qwen-coder,         │
│  • Ejecuta comandos y Skills    │   (Cifrado P2P) │    gemma4:12b, etc.             │
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

---

## 📋 Requisitos Previos

Antes de comenzar, asegúrate de tener:
1. Una computadora con tarjeta gráfica dedicada (GPU Nvidia/AMD o Apple Silicon) que actuará como **servidor de inferencia**.
2. Tu **Mac** de uso diario donde instalarás la app.
3. [Ollama](https://ollama.ai/) instalado en la computadora servidora.
4. [Tailscale](https://tailscale.com/) instalado en ambas computadoras.

---

## 🛠️ Guía de Configuración Paso a Paso

### Paso 1: Configurar el Servidor Ollama

Descarga e instala [Ollama](https://ollama.ai/) en la máquina que tiene la tarjeta gráfica dedicada.

#### 📦 Modelos recomendados:

Descarga los modelos que planees utilizar según tus necesidades:

| Modelo | Comando de descarga | Recomendación de uso |
| :--- | :--- | :--- |
| **`qwen3.5:4b`** | `ollama run qwen3.5:4b` | **El más equilibrado:** Ligero, rápido y eficiente para tareas cotidianas. |
| **`qwen3-coder`** | `ollama run qwen3-coder` | **Especialista en código:** Máxima precisión para refactorizar, editar código y depurar. |
| **`gemma4:12b`** | `ollama run gemma4:12b` | **Máximo rendimiento:** Ideal si tu GPU tiene suficiente VRAM y buscas razonamiento avanzado. |

---

### Paso 2: Configurar la Red Privada con Tailscale

Descarga [Tailscale](https://tailscale.com/download) en ambas computadoras:

1. **Crea 2 cuentas o inicia sesión:** 
   - Una cuenta para la máquina host (donde corre el LLM).
   - Otra cuenta (o la misma con función de compartir/invitar dispositivo) en tu Mac para conectarte de forma segura punto a punto.
2. Abre Tailscale en la PC del LLM y copia su **dirección IP de Tailscale** (es una IP que comienza con `100.x.y.z`, por ejemplo `100.0.0.0`).

---

### Paso 3: Configurar las Variables de Entorno en la PC del LLM

Para que Ollama permita conexiones desde tu Mac a través del túnel de Tailscale, debes configurar dos variables de entorno en la máquina host:

#### En Windows (PowerShell como Administrador):

```powershell
# 1. Escuchar peticiones en tu IP de Tailscale (reemplaza con tu IP real de Tailscale)
[System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '100.0.0.0:11434', 'User')

# Opcional (si prefieres que escuche en todas las interfaces de red):
# [System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')

# 2. Permitir llamadas cruzadas desde la aplicación
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
```

*(Tras ejecutar estos comandos, haz clic derecho en el icono de Ollama en la barra de tareas de Windows y dale a **Quit**, luego vuelve a abrirlo para que tome las nuevas variables).*

#### En Linux / macOS (Host):

Agrega a tu `~/.bashrc` o `~/.zshrc`:
```bash
export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_ORIGINS="*"
```
Y reinicia el servicio con `ollama serve`.

---

### Paso 4: Abrir el Puerto en el Firewall de Windows (Host)

Si tu servidor de LLM corre en Windows, debes permitir que el tráfico TCP ingrese por el puerto `11434`. Abre **PowerShell como Administrador** y ejecuta:

```powershell
netsh advfirewall firewall add rule name="Ollama Tailscale" dir=in action=allow protocol=TCP localport=11434
```

---

### Paso 5: Instalar y Disfrutar en tu Mac (.dmg)

1. Descarga el instalador **`Local-LLM-1.0.0.dmg`** desde la sección de [Releases de este repositorio](../../releases).
2. Abre el `.dmg` y arrastra **Local-LLM** a tu carpeta de **Aplicaciones**.
3. Abre **Local-LLM**:
   - **Paso 1:** Selecciona tu idioma preferido (*Español* o *English*).
   - **Paso 2:** Pega tu IP de Tailscale (ejemplo: `100.0.0.0:11434`) y pulsa **"Probar y Guardar"**.
   - **Paso 3:** La app detectará automáticamente tus modelos instalados (`qwen3.5:4b`, `qwen3-coder`, etc.) y te los mostrará en un popup de confirmación.

¡Y listo! Ya puedes chatear y programar con tu modelo local desde tu Mac en cualquier lugar del mundo.

---

## ⚡ Comandos Rápidos del Sistema (`/`)

Escribe `/` en la caja de texto para desplegar el menú de acciones nativas:

| Comando | Acción |
| :--- | :--- |
| `/lee <archivo\|carpeta>` | Inyecta el contenido de un archivo o directorio en el contexto. |
| `/lee-repo [pregunta]` | Carga y analiza todo tu repositorio de código actual. |
| `/lee-carpeta <dir>` | Lee recursivamente una carpeta específica de tu Mac. |
| `/edita <archivo> <instrucción>` | Modifica y sobreescribe un archivo en disco de forma automática. |
| `/edita-repo <instrucción>` | Agente multi-archivo: genera cambios estructurados y actualiza el repositorio. |
| `/<skill> [instrucción]` | Activa habilidades personalizadas desde la carpeta `skills/` (ej: `/refactorizar`, `/documentar`, `/testear`). |

> ⚙️ **¿Cambió tu IP de Tailscale?**
> Haz clic en el icono de engranaje **⚙️** en la barra superior junto al selector de modelos para cambiar la dirección IP o volver a escanear modelos en cualquier momento sin reinstalar la app.

---

## 🛠️ Desarrollo y Compilación Local

Si deseas compilar la app tú mismo:

```bash
# 1. Clonar el repositorio e instalar dependencias
git clone https://github.com/tu-usuario/local-wireless-LLM.git
cd local-wireless-LLM
npm install

# 2. Iniciar en modo desarrollo
npm start

# 3. Compilar el archivo instalador .dmg para macOS
npm run dist:mac
```

---

## 📄 Licencia

Distribuido bajo la Licencia ISC. Consulta el archivo [LICENSE](LICENSE) para más información.
