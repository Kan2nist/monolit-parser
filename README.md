# Skazka.mobi Game Parser

This tool helps you capture game assets (textures, scripts) and analyze network traffic (HTTP requests, WebSockets) from the game [skazka.mobi](https://skazka.mobi/).

It is designed to be run on your local machine (Arch Linux). It launches a controlled browser window where you can play the game manually, while the tool automatically saves resources and logs in the background.

## Prerequisites

1.  **Node.js**: Ensure you have Node.js installed.
    ```bash
    sudo pacman -S nodejs npm
    ```

## Installation

1.  Open your terminal and navigate to the project directory.
2.  Install the required dependencies:
    ```bash
    npm install
    ```
    *Note: This will install `playwright` and its browser binaries.*

## Usage

1.  Run the parser:
    ```bash
    node parser.js
    ```
    *(Note: The script is configured to launch the browser in visible mode so you can interact with it.)*

2.  A Chromium browser window will open and navigate to `https://skazka.mobi/`.
3.  **Log in and Play**: Interact with the game as you normally would. Go to different locations, open menus, etc., to trigger the loading of various textures and scripts.
4.  **Background Capture**:
    *   **Textures (Images)**: Saved to `captured_data/textures/`.
    *   **Scripts (JS)**: Saved to `captured_data/scripts/`.
    *   **Network Logs**: Saved to `captured_data/http_log.jsonl` and `captured_data/websocket_log.jsonl`.
5.  **Stop**: When you are finished, simply close the browser window or press `Ctrl+C` in your terminal.

## Output Structure

The `captured_data/` directory will contain:

*   `textures/`: All downloaded image files. Filenames are hashes of the content to prevent duplicates.
*   `scripts/`: All downloaded JavaScript files.
*   `http_log.jsonl`: A line-by-line JSON log of all HTTP requests and responses (headers, methods, URLs).
*   `websocket_log.jsonl`: A log of all WebSocket messages sent and received.

## Notes for Analysis

*   **Logic Analysis**: Use the `websocket_log.jsonl` to understand the game protocol. You can parse this file to see exactly what data is exchanged during specific game actions (e.g., moving, attacking).
*   **Asset Reconstruction**: The textures are saved raw. You may need to map them back to their usage context based on when they were requested (check timestamps in `http_log.jsonl` vs user actions).
