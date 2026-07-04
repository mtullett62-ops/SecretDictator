# SecretDictator

A small single-server, multi-browser implementation of Secret Hitler.

## Run

```sh
npm install
npm start
```

Open `http://localhost:3000` in several browser windows. Everyone joins the same in-memory game.

## Test

```sh
npm test
```

## Notes

- The server is the source of truth for all game logic.
- The client only renders state and sends player actions.
- There is one game, no accounts, no persistence, no reconnect support, and no database.
- Restarting the server resets the game.
- The server pings its own `/health` endpoint every 45 seconds so a Render free-tier deployment doesn't spin down from inactivity. Set `RENDER_EXTERNAL_URL` (Render sets this automatically) so the ping targets the public URL instead of localhost.
