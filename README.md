# ⚡ Local-LLM

> **Your local language model, accelerated by remote hardware, available wirelessly and privately on your Mac.**

![macOS](https://img.shields.io/badge/macOS-Tahoe%20%2F%20GoldenGate-000000?style=flat&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Desktop-Native%20Vibrancy-47848F?style=flat&logo=electron&logoColor=white)
![Ollama](https://img.shields.io/badge/Inference-Ollama-white?style=flat&logo=ollama&logoColor=black)
![Tailscale](https://img.shields.io/badge/Network-Tailscale%20WireGuard-202324?style=flat&logo=tailscale&logoColor=white)

---

## 🧭 How It Works

**Local-LLM** allows you to use powerful AI models on a lightweight laptop (like a MacBook Air) without overloading its RAM, overheating the device, or draining the battery.

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│     YOUR MAC (MacBook / Mac Mini) │                 │     HOST PC / SERVER            │
│     (Agent Body)                │                 │     (LLM Brain with GPU)        │
│                                 │    Tailscale    │                                 │
│  • Native Local-LLM App (.dmg)  │ ◄─────────────► │  • Ollama Server with GPU       │
│  • File system access           │    WireGuard    │  • qwen3.5, qwen-coder,         │
│  • Run commands and Skills      │   (P2P Encrypted) │    gemma4:12b, etc.             │
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

---

## 📋 Prerequisites

Before starting, make sure you have:
1. A computer with a dedicated graphics card (Nvidia/AMD or Apple Silicon) that will act as the **inference server**.
2. Your **daily-use Mac** where you'll install the app.
3. [Ollama](https://ollama.ai/) installed on the server machine.
4. [Tailscale](https://tailscale.com/) installed on both computers.

---

## 🛠️ Step-by-Step Setup Guide

### Step 1: Configure the Ollama Server

Download and install [Ollama](https://ollama.ai/) on the machine with the dedicated graphics card.

#### 📦 Recommended Models:

Download the models you plan to use based on your needs:

| Model | Download Command | Use Recommendation |
| :--- | :--- | :--- |
| **`qwen3.5:4b`** | `ollama run qwen3.5:4b` | **Most balanced:** Lightweight, fast and efficient for daily tasks. |
| **`qwen3-coder`** | `ollama run qwen3-coder` | **Code specialist:** Maximum accuracy for refactoring, editing code and debugging. |
| **`gemma4:12b`** | `ollama run gemma4:12b` | **Maximum performance:** Ideal if your GPU has sufficient VRAM and you seek advanced reasoning. |

---

### Step 2: Set Up Private Network with Tailscale

Download [Tailscale](https://tailscale.com/download) on both computers:

1. **Create 2 accounts or sign in:**
   - One account for the host machine (where the LLM runs).
   - Another (or the same with sharing/invite function) on your Mac to securely connect point-to-point.
2. Open Tailscale on the LLM PC and copy its **Tailscale IP address** (it starts with `100.x.y.z`, e.g., `100.0.0.0`).

---

### Step 3: Set Environment Variables on the LLM Host

To allow connections from your Mac through the Tailscale tunnel, you need to set two environment variables on the host machine:

#### On Windows (PowerShell as Administrator):

```powershell
# 1. Listen for requests on your Tailscale IP (replace with your real Tailscale IP)
[System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '100.0.0.0:11434', 'User')

# Optional (if you prefer to listen on all network interfaces):
# [System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')

# 2. Allow cross-origin calls from the app
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
```

*(After running these commands, right-click on the Ollama icon in Windows taskbar and select **Quit**, then reopen it for new settings to take effect.)*

#### On Linux / macOS (Host):

Add to your `~/.bashrc` or `~/.zshrc`:
```bash
export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_ORIGINS="*"
```
And restart the service with `ollama serve`.

---

### Step 4: Open Port in Windows Firewall (Host)

If your LLM server runs on Windows, you must allow incoming TCP traffic on port `11434`. Open **PowerShell as Administrator** and run:

```powershell
netsh advfirewall firewall add rule name="Ollama Tailscale" dir=in action=allow protocol=TCP localport=11434
```

---

### Step 5: Install and Enjoy on Your Mac (.dmg)

1. Download the installer **`Local-LLM-1.0.0.dmg`** from the [Releases section of this repository](../../releases).
2. Open the `.dmg` file and drag **Local-LLM** into your **Applications** folder.
3. Launch **Local-LLM**:
   - **Step 1:** Select your preferred language (*Spanish* or *English*).
   - **Step 2:** Paste your Tailscale IP (e.g., `100.0.0.0:11434`) and click **"Test and Save"**.
   - **Step 3:** The app will automatically detect your installed models (`qwen3.5:4b`, `qwen3-coder`, etc.) and display them in a confirmation popup.

That's it! You can now chat and code with your local model from anywhere in the world using your Mac.

---

## 🤖 Natural Language Autonomous Agent (No '/' Commands Needed!)

When working within an active **Workspace** (`📂`), Local-LLM operates as a fully autonomous coding agent. You **do not need** to use slash commands (`/`): simply request actions in plain English or Spanish.

### 💬 Examples of Natural Language Prompts:

- **Create folders:**
  - *"create a folder named test inside src"*
  - *"crea una carpeta llamada test adentro de src"*
  - *"make directory src/components/button"*
- **Generate new files and tests:**
  - *"create unit tests for commands.js inside src/test using Jest"*
  - *"crea los unit tests para commands.js adentro de src/test"*
  - *"add a helper module in src/utils.js with string formatting utilities"*
- **Edit and modify existing code:**
  - *"change main.js to add hello function"*
  - *"modify src/commands.js to support English natural language queries"*
  - *"update package.json with test script"*

The agent automatically resolves project paths, creates directories recursively, and applies multi-file code modifications straight to disk.

---

## ⚡ Optional Slash Commands (`/`)

If you prefer explicit control, you can still type `/` to access direct shortcuts:

| Command | Action |
| :--- | :--- |
| `/crea <file> <instruction>` | Generates a new file and creates all required parent folders on disk. |
| `/edita <file> <instruction>` | Modifies and overwrites an existing file on disk. |
| `/edita-repo <instruction>` | Multi-file agent: generates structured changes and creates/modifies files. |
| `/lee <file\|folder>` | Injects content of a specific file or directory into context. |
| `/lee-repo [question]` | Loads and inspects the complete codebase repository. |
| `/lee-carpeta <dir>` | Recursively reads a specific folder on your machine. |
| `/<skill> [instruction]` | Activates custom skills from `skills/` (e.g., `/refactorizar`, `/testear`, `/documentar`). |

> ⚙️ **Changed your Tailscale IP?**  
> Click the gear icon **⚙️** in the top bar next to the model selector to change the IP address or re-scan models at any time without reinstalling the app.

---

## 🛠️ Local Development and Build

If you want to compile the app yourself:

```bash
# 1. Clone repo and install dependencies
git clone https://github.com/tu-usuario/local-wireless-LLM.git
cd local-wireless-LLM
npm install

# 2. Start in development mode
npm start

# 3. Build the .dmg installer for macOS
npm run dist:mac
```

---

## 📄 License

Distributed under the ISC License. See [LICENSE](LICENSE) file for more information.