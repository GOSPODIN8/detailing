"use strict";
// Downloads the site images into public/ if they are not there yet.
// Runs automatically after `npm install` (locally and on Railway).
const fs = require("fs");
const path = require("path");

const BASE = "https://d2ol7oe51mr4n9.cloudfront.net/user_3Jj3LR9ku5XIB1jz84ef0kK2Gzk/";
const FILES = {
  "assets/hero-night.webp": "3de0052a-7ce1-44ff-98ef-a5bec07ae74a.webp",
  "assets/facade-day.webp": "9bd0f0ee-3e87-4f1e-8143-4843c63610ae.webp",
  "assets/tint.webp": "02cd339f-eefe-476c-8cdb-709f2df1da76.webp",
  "assets/fog.webp": "953204d9-27ff-4944-9d89-b2e1f9158cc6.webp",
  "assets/covers.webp": "ab7dced8-2d26-4789-b816-8e534ac3285b.webp",
  "assets/lounge.webp": "a96522b9-bd21-4c65-94cd-7d35a539d911.webp",
  "assets/team.webp": "19413162-0b93-4700-8cd6-e393ecc653ed.webp",
  "assets/sticker.webp": "0752e619-395b-4966-b806-7f90d54d1204.webp",
  "assets/sign.webp": "95966654-0b39-4d39-a76a-5ace84b777c5.webp",
  "assets/mark.png": "4b8f3ed1-57cd-4e5c-8f3b-bdd648b4feda.png",
  "favicon.png": "21c265cb-8999-4bb3-ab18-b145939441eb.png",
  "og.jpg": "288c2220-cc0c-4689-a9f5-86a9a23d7988.jpg",
};

async function main() {
  const publicDir = path.join(__dirname, "..", "public");
  let failed = 0;
  for (const [rel, remote] of Object.entries(FILES)) {
    const dest = path.join(publicDir, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const res = await fetch(BASE + remote);
      if (!res.ok) throw new Error("HTTP " + res.status);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log("✓", rel);
    } catch (err) {
      failed++;
      console.warn("Не удалось скачать", rel, "-", err.message);
    }
  }
  if (failed) console.warn(`Картинок не скачано: ${failed}. Положите их в public/ вручную.`);
}

if (typeof fetch !== "function") {
  console.warn("Нужен Node.js 18+, картинки не скачаны.");
} else {
  main();
}
