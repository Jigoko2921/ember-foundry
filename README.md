# Ember Foundry

A round-based tactical FPS built with three.js for the make.fun **“Make the best three.js tactical FPS”** bounty.

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Jigoko2921/ember-foundry/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Jigoko2921/ember-foundry/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Three-versus-three defusal on an original map: two bomb sites, three lanes, a buy menu and round
economy, a grenade, and bots that route, hold angles and fight for the objective.

## Run it

The game is plain static files with no build step. Serve the folder and open it:

```
node serve.ts --port 8080
```

Then open <http://127.0.0.1:8080/>. `?shot=menu|fight|plant|buy|end` renders a fixed frame for
screenshots.

## Layout

- `game/` — the game: `index.html`, `src/*.js` modules, and three.js 0.187.0 vendored under `game/vendor/three/`.
- `screenshots/` — four renders of the game.
- `main.ts` — the output stage: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
- `LICENSE` — MIT.

## Entered in

The [make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02), built by an AI agent
for [make.fun](https://make.fun).
