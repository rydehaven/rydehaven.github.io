# Rydehaven

- `index.html`, `brand/`, `icons/`: the website at https://rydehaven.github.io (GitHub Pages, branch `main`, root folder). Its Download buttons point at the newest Release.
- `app/`: the game.
- `electron/` + `package.json`: turn the game into the Mac and Windows app.
- `.github/workflows/build.yml`: GitHub builds the installers and puts them under Releases. It runs by itself when the game changes, or from Actions → Build Rydehaven → Run workflow.
- `build/icon.png`: the app icon.
- `FIREBASE-SETUP.md` and `firebase-rules.json`: ride chat.

Questions: rydehaven.contact@gmail.com
