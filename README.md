# Baba-Is-You-WASM
A webassembly variation of Baba Is You so browser play is possible instead of the huge exe.

## Browser build

Open `index.html` from a static web server or the GitHub Pages deployment. Controls: arrow keys move, Z undoes, R restarts, and Space waits.

`web/game-data.json` is generated from the original data files with:

```sh
python3 tools/generate_data.py
```
