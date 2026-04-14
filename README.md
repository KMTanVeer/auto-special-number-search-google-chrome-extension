# Auto Special Number Search (Chrome Extension)

Chrome extension (Manifest V3) that automates searching Airtel Bangladesh SIM number availability on:

- https://www.bd.airtel.com/en/sim-services

It assumes fixed prefix `+88016` and checks `1000` generated 8-digit suffix patterns (special-looking combinations).  
Whenever page text indicates a number **is available**, it stores the full number locally and shows it in the popup.  
You can copy all found numbers to clipboard from the popup.

## Install locally in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder:
   - the local folder containing `manifest.json`

## Usage

1. Open the Airtel SIM services page.
2. Click the extension icon.
3. Click **Start 1000 Checks**.
4. Keep the tab open while checks run.
5. View found numbers in the popup and use **Copy Found Numbers**.

## Notes

- The extension uses page text matching for availability detection (`"is available"` / `"available"`).
- Because the target page can change at any time, selectors use best-effort heuristics for inputs/buttons.
