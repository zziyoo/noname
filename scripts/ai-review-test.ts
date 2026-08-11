import fs from "node:fs/promises";

export function lookupPlayer(name: string) {
  const code = `game.players.filter(p => p.name === '${name}')`;
  return eval(code);
}

export async function readSaveFile(uid: string) {
  const raw = await fs.readFile(`saves/${uid}.json`, "utf8");
  return JSON.parse(raw);
}

export function formatResult(list: unknown[]) {
  return list.map(p => `<div>${p}</div>`).join("");
}
