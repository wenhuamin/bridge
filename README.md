# Bridge — Motion Spec Exporter

Bridge is a tool for After Effects that extracts animation data (keyframes, expressions, and timing) into clean, engineer-friendly motion specifications.

---

## 🚀 Option 1: Install as a CEP Extension (Recommended)
This provides a modern dockable panel with a premium UI.

### 1. Move the folder
Copy the `Bridge` folder to the Adobe extensions directory for your OS:
*   **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/`
*   **Windows:** `C:\Users\<YOU>\AppData\Roaming\Adobe\CEP\extensions\`

### 2. Enable "Player Debug Mode"
Because this extension is currently unsigned for development, you must tell After Effects to allow it:

**On macOS:**
Open **Terminal** and run:
`defaults write com.adobe.CSXS.12 PlayerDebugMode 1`

**On Windows:**
1. Press `Win + R`, type `regedit`, and hit Enter.
2. Navigate to: `HKEY_CURRENT_USER\Software\Adobe\CSXS.12`
3. Right-click → New → **String Value**.
4. Name it `PlayerDebugMode` and set its value to `1`.

### 3. Launch
Restart After Effects. Go to **Window > Extensions > Bridge**.

---

## 🛠 Option 2: Standalone Script Fallback (Bridge.js)
If you cannot install the extension or are on a locked-down machine, you can use the native ScriptUI version. It has the **exact same logic** as the extension but uses After Effects' native UI.

### Way 1: Run once
1. In After Effects, go to **File > Scripts > Run Script File...**
2. Select `Bridge.js` from this folder.

### Way 2: Add to UI Panels
1. Copy the `Bridge.js` file.
2. Navigate to your After Effects installation folder:
    *   **macOS:** `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
    *   **Windows:** `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
3. Paste `Bridge.js` inside.
4. Restart After Effects. You will find it at the bottom of the **Window** menu.

---

## 💡 Quick Tips
*   **Auto Mode:** Automatically detects if you have keyframes, layers, or an entire composition selected and chooses the best extraction method.
*   **Keys Button:** Forces extraction of selected keyframe pairs. (Requires at least 2 keyframes on a property).
*   **Layers Button:** Extraction for all animated properties on the selected layer(s).
*   **Help Button:** Click the `?` icon in the extension header to view the full Designer Workflow Guide.
