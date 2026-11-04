# LinkChat
Realtime translated chat rooms. No login, no Firebase.
- `node server.js` (port 8787, env PORT). Saved rooms persist in `rooms.json`; Disappearing rooms expire after 2h (memory only).
- Host opens `/`, picks name, language, and room type, then creates the room and shares the `/?room=ID` link. Guests open the link, pick a name and language, and chat.
- Translation is done server-side: Google `translate_a/single?client=gtx`, with MyMemory as a fallback. Each reader sees the text in their own language plus the original.
- Public exposure: `cloudflared tunnel --url http://localhost:8787` (or ngrok, or any host such as Render or Fly.io). The cloudflared quick tunnel URL changes on each restart.
