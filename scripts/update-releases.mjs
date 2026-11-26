#!/usr/bin/env node
// Fetches the discography from the iTunes Search API and bakes it into
// index.html (LATEST / RELEASES / JSONLD marker regions), releases.json,
// and sitemap.xml. Exits non-zero without touching any file when the API
// returns nothing, so the site keeps its last-known-good content.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIST_ID = "1814358514";
const SITE_URL = "https://behnamkhanbeigi.com";

const ARTIST = {
  name: "Behnam Khanbeigi",
  alternateName: ["بهنام خان‌بیگی", "بهنام خان بیگی", "بهنام خانبیگی"],
  genre: ["Modern Classical", "New Age", "Electronic", "Classical Crossover"],
  sameAs: [
    "https://open.spotify.com/artist/4h2cXpWD3zRDB2jwiL5jP6",
    "https://music.apple.com/artist/behnam-khanbeigi/1814358514",
    "https://www.deezer.com/artist/323615071",
    "https://beeptunes.com/artist/646808594/%D8%A8%D9%87%D9%86%D8%A7%D9%85-%D8%AE%D8%A7%D9%86-%D8%A8%DB%8C%DA%AF%DB%8C",
    "https://www.youtube.com/@behnam_khanbeigi",
    "https://www.instagram.com/behnam_khanbeigi/",
    "https://musicbrainz.org/artist/a9fa3d58-9e58-4102-a9a4-1400b079d3ca",
    "https://www.wikidata.org/wiki/Q136653615",
  ],
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "behnamkhanbeigi.com site updater" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function replaceRegion(html, name, content) {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(html)) throw new Error(`Marker ${name} not found in index.html`);
  return html.replace(re, (_, start, end) => `${start}\n${content}\n        ${end}`);
}

function setMeta(html, attr, value, content) {
  const re = new RegExp(`(<meta ${attr}="${value}" content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`Meta ${attr}="${value}" not found in index.html`);
  return html.replace(re, (_, a, b) => a + escapeHtml(content) + b);
}

function renderLatest(t) {
  return `        <a class="latest-hero" href="${t.songLink}" target="_blank" rel="noopener" aria-label="Listen to ${escapeHtml(t.title)}">
          <div class="latest-art-wrap">
            <img class="latest-art" src="${t.artwork}" alt="Cover art for ${escapeHtml(t.title)}" width="600" height="600" />
          </div>
          <div class="latest-info">
            <p class="eyebrow" data-i18n="latestRelease">Latest Release</p>
            <h2 class="latest-title">${escapeHtml(t.title)}</h2>
            <p class="latest-date"><span data-i18n="single">Single</span> &middot; <time datetime="${t.releaseDate}" data-date="${t.releaseDate}" data-date-mode="full">${formatDate(t.releaseDate)}</time></p>
            <span class="btn btn-gold"><span aria-hidden="true">&#9654;</span>&nbsp;<span data-i18n="listenBtn">Listen everywhere</span></span>
          </div>
        </a>`;
}

function renderCard(t) {
  return `            <li class="work">
              <a class="work-link" href="${t.songLink}" target="_blank" rel="noopener" aria-label="Listen to ${escapeHtml(t.title)}">
                <img class="work-thumb" src="${t.artwork}" alt="" width="120" height="120" loading="lazy" />
                <span class="work-title">${escapeHtml(t.title)}</span>
                <span class="work-year"><time datetime="${t.releaseDate}" data-date="${t.releaseDate}" data-date-mode="year">${t.releaseDate.slice(0, 4)}</time></span>
                <span class="work-cta" aria-hidden="true">&#8599;</span>
              </a>
            </li>`;
}

function renderJsonLd(releases) {
  const data = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    "@id": `${SITE_URL}/#artist`,
    name: ARTIST.name,
    alternateName: ARTIST.alternateName,
    url: `${SITE_URL}/`,
    image: `${SITE_URL}/images/behnam_khanbeigi.jpg`,
    genre: ARTIST.genre,
    sameAs: ARTIST.sameAs,
    track: releases.map((t) => ({
      "@type": "MusicRecording",
      name: t.title,
      datePublished: t.releaseDate,
      url: t.songLink,
      image: `${SITE_URL}/${t.artwork}`,
      byArtist: { "@id": `${SITE_URL}/#artist` },
    })),
  };
  return `  <script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n  <\/script>`;
}

async function downloadArtwork(track) {
  const dir = path.join(ROOT, "images", "artwork");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${track.trackId}.jpg`);
  try {
    await access(file);
    return; // already downloaded
  } catch {}
  const url = track.artworkUrl100.replace("100x100bb", "600x600bb");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Artwork download failed for ${track.trackName}: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`Downloaded artwork: images/artwork/${track.trackId}.jpg`);
}

async function main() {
  const data = await fetchJson(
    `https://itunes.apple.com/lookup?id=${ARTIST_ID}&entity=song&limit=200`
  );
  const tracks = (data.results || [])
    .filter((r) => r.wrapperType === "track" && r.kind === "song")
    .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));

  if (tracks.length === 0) {
    console.error("iTunes lookup returned no tracks; leaving site untouched.");
    process.exit(1);
  }

  for (const t of tracks) await downloadArtwork(t);

  const releases = tracks.map((t) => ({
    trackId: t.trackId,
    title: t.trackName,
    releaseDate: t.releaseDate.slice(0, 10),
    songLink: `https://song.link/i/${t.trackId}`,
    appleUrl: t.trackViewUrl,
    artwork: `images/artwork/${t.trackId}.jpg`,
  }));
  const latest = releases[0];

  const releasesPath = path.join(ROOT, "releases.json");
  const newJson = JSON.stringify(releases, null, 2) + "\n";
  let oldJson = null;
  try {
    oldJson = await readFile(releasesPath, "utf8");
  } catch {}
  const changed = oldJson !== newJson;
  if (changed) await writeFile(releasesPath, newJson);

  let html = await readFile(path.join(ROOT, "index.html"), "utf8");
  html = replaceRegion(html, "LATEST", renderLatest(latest));
  // The latest release is the big hero above, so the list shows the rest.
  html = replaceRegion(html, "RELEASES", releases.slice(1).map(renderCard).join("\n"));
  html = replaceRegion(html, "JSONLD", renderJsonLd(releases));

  const description =
    `Behnam Khanbeigi is a composer and producer blending modern classical and electronic music. ` +
    `Stream the latest single “${latest.title}” on Spotify, Apple Music, YouTube, and all platforms.`;
  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "name", "twitter:description", description);
  html = setMeta(html, "property", "og:image", `${SITE_URL}/${latest.artwork}`);
  html = setMeta(html, "name", "twitter:image", `${SITE_URL}/${latest.artwork}`);
  await writeFile(path.join(ROOT, "index.html"), html);

  // Refresh sitemap lastmod only when the discography actually changed,
  // so the daily run doesn't produce a commit every day.
  if (changed) {
    const today = new Date().toISOString().slice(0, 10);
    const sitemapPath = path.join(ROOT, "sitemap.xml");
    try {
      let sitemap = await readFile(sitemapPath, "utf8");
      sitemap = sitemap.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${today}</lastmod>`);
      await writeFile(sitemapPath, sitemap);
    } catch {}
  }

  console.log(
    `OK: ${releases.length} releases, latest “${latest.title}” (${latest.releaseDate})` +
      (changed ? " [discography changed]" : " [no change]")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
