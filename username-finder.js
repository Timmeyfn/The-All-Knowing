#!/usr/bin/env node
/**
 * The All Knowing — Username Finder
 * --------------------------------------------------------------------------
 * Check whether a username is available across many platforms, and generate
 * rare/short usernames and check those too.
 *
 * Requires Node 18+ (uses the built-in global fetch).
 *
 * Usage:
 *   node username-finder.js check <username> [username2 ...] [--json]
 *   node username-finder.js rare [--count 20] [--len 4] [--style word|pronounceable|leet] [--min 3]
 *
 * Examples:
 *   node username-finder.js check vex
 *   node username-finder.js check nova axel --json
 *   node username-finder.js rare --count 15 --len 4 --style pronounceable
 *
 * Notes / honesty:
 *   - "Available" means the profile URL returned a 404-style "no such user"
 *     response at check time. Some sites hide behind Cloudflare, rate-limit, or
 *     need JavaScript, so a result can be UNKNOWN (couldn't tell — not free and
 *     not taken). If you're on a school/work network with a content filter,
 *     expect lots of UNKNOWN; try again from a home connection.
 *   - Be polite: this tool throttles requests. Don't hammer sites.
 */

'use strict';

// --------------------------------------------------------------------------
// Platform definitions
//   detect 'status'  -> 404/410 means AVAILABLE, 200 means TAKEN
//   detect 'absent'  -> AVAILABLE only if a known "not found" marker appears
//   major: true      -> used by the `rare` hunter (fast, reliable-ish set)
// --------------------------------------------------------------------------
const PLATFORMS = [
  { name: 'GitHub',      url: u => `https://github.com/${u}`,                     detect: 'status', major: true },
  {
    name: 'Roblox',
    url: u => `https://www.roblox.com/users/profile?username=${u}`,
    major: true,
    // Public JSON API: resolve usernames -> users. An empty data array = free.
    probe: async (username, opts) => {
      const r = await fetchWithRetry('https://users.roblox.com/v1/usernames/users', {
        ...opts, wantBody: true,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
        },
      });
      if (r.error) return { status: STATUS.UNKNOWN, note: r.error };
      if (r.status !== 200) return { status: STATUS.UNKNOWN, note: `http ${r.status}` };
      try {
        const data = (JSON.parse(r.body).data) || [];
        const hit = data.some(u => (u.requestedUsername || u.name || '').toLowerCase() === username.toLowerCase());
        return { status: hit ? STATUS.TAKEN : STATUS.AVAILABLE };
      } catch {
        return { status: STATUS.UNKNOWN, note: 'bad-response' };
      }
    },
  },
  {
    name: 'Discord',
    url: u => `https://discord.com/ (username: ${u})`,
    // Best-effort: Discord's signup availability endpoint. No public profile
    // lookup exists since the unique-username change, so this can rate-limit
    // (then it shows as unknown). It checks the base name, ignoring the #tag.
    probe: async (username, opts) => {
      const r = await fetchWithRetry('https://discord.com/api/v9/unique-username/username-attempt-unauthenticated', {
        ...opts, wantBody: true,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        },
      });
      if (r.error) return { status: STATUS.UNKNOWN, note: r.error };
      if (r.status === 429) return { status: STATUS.UNKNOWN, note: 'rate-limited' };
      if (r.status !== 200) return { status: STATUS.UNKNOWN, note: `http ${r.status}` };
      try {
        const taken = JSON.parse(r.body).taken;
        if (taken === true) return { status: STATUS.TAKEN };
        if (taken === false) return { status: STATUS.AVAILABLE };
        return { status: STATUS.UNKNOWN, note: 'bad-response' };
      } catch {
        return { status: STATUS.UNKNOWN, note: 'bad-response' };
      }
    },
  },
  { name: 'Reddit',      url: u => `https://www.reddit.com/user/${u}/about.json`, detect: 'status', major: true },
  { name: 'Instagram',   url: u => `https://www.instagram.com/${u}/`,             detect: 'status', major: true },
  { name: 'TikTok',      url: u => `https://www.tiktok.com/@${u}`,                detect: 'status', major: true },
  { name: 'Twitch',      url: u => `https://www.twitch.tv/${u}`,                  detect: 'status', major: true },
  { name: 'GitLab',      url: u => `https://gitlab.com/${u}`,                     detect: 'status' },
  { name: 'YouTube',     url: u => `https://www.youtube.com/@${u}`,               detect: 'status' },
  { name: 'Pinterest',   url: u => `https://www.pinterest.com/${u}/`,             detect: 'status' },
  { name: 'Steam',       url: u => `https://steamcommunity.com/id/${u}`,          detect: 'absent', marker: 'The specified profile could not be found' },
  { name: 'Telegram',    url: u => `https://t.me/${u}`,                           detect: 'absent', marker: 'If you have Telegram, you can contact' },
  { name: 'Medium',      url: u => `https://medium.com/@${u}`,                    detect: 'status' },
  { name: 'Dev.to',      url: u => `https://dev.to/${u}`,                         detect: 'status' },
  { name: 'Replit',      url: u => `https://replit.com/@${u}`,                    detect: 'status' },
  { name: 'SoundCloud',  url: u => `https://soundcloud.com/${u}`,                 detect: 'status' },
  { name: 'Spotify',     url: u => `https://open.spotify.com/user/${u}`,          detect: 'status' },
  { name: 'Patreon',     url: u => `https://www.patreon.com/${u}`,                detect: 'status' },
  { name: 'Behance',     url: u => `https://www.behance.net/${u}`,                detect: 'status' },
  { name: 'Dribbble',    url: u => `https://dribbble.com/${u}`,                   detect: 'status' },
  { name: 'Keybase',     url: u => `https://keybase.io/${u}`,                     detect: 'status' },
  { name: 'npm',         url: u => `https://www.npmjs.com/~${u}`,                 detect: 'status' },
  { name: 'PyPI',        url: u => `https://pypi.org/user/${u}/`,                 detect: 'status' },
  { name: 'HackerNews',  url: u => `https://news.ycombinator.com/user?id=${u}`,   detect: 'absent', marker: 'No such user.' },
  { name: 'Chess.com',   url: u => `https://www.chess.com/member/${u}`,           detect: 'status' },
  { name: 'Mastodon.social', url: u => `https://mastodon.social/@${u}`,           detect: 'status' },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const STATUS = { AVAILABLE: 'AVAILABLE', TAKEN: 'TAKEN', UNKNOWN: 'UNKNOWN' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Generic bounded-concurrency pool
// --------------------------------------------------------------------------
async function pool(items, size, worker) {
  const queue = items.map((item, i) => ({ item, i }));
  const results = new Array(items.length);
  async function run() {
    while (queue.length) {
      const { item, i } = queue.shift();
      results[i] = await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length || 1) }, run));
  return results;
}

// --------------------------------------------------------------------------
// fetch with timeout + retries (retries on network errors and 429s)
// --------------------------------------------------------------------------
function failReason(err) {
  if (err.name === 'AbortError') return 'timeout';
  const code = (err.cause && err.cause.code) || err.code;
  if (code) return String(code).replace(/^(ERR_|UND_ERR_)/, '').toLowerCase();
  return (err.message || 'fetch failed').slice(0, 24);
}

async function fetchWithRetry(url, { timeout = 12000, retries = 2, wantBody = false, init = {} } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/json', ...(init.headers || {}) },
        redirect: 'follow',
        signal: controller.signal,
        ...init,
      });
      clearTimeout(timer);
      if (res.status === 429 && attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      let body = '';
      if (wantBody) body = await res.text();
      else if (res.body) { try { await res.body.cancel(); } catch {} }
      return { status: res.status, body };
    } catch (err) {
      clearTimeout(timer);
      last = failReason(err);
      if (attempt < retries) { await sleep(250 * (attempt + 1)); continue; }
    }
  }
  return { error: last || 'fetch failed' };
}

// --------------------------------------------------------------------------
// Check one platform for one username
// --------------------------------------------------------------------------
async function checkPlatform(platform, username, opts = {}) {
  const url = platform.url(username);
  const make = (status, note) => ({ platform: platform.name, status, url, note });

  // Custom probe (APIs that need a POST / JSON parsing, e.g. Roblox, Discord)
  if (platform.probe) {
    try {
      const { status, note } = await platform.probe(username, opts);
      return make(status, note);
    } catch (e) {
      return make(STATUS.UNKNOWN, failReason(e));
    }
  }

  const r = await fetchWithRetry(url, { ...opts, wantBody: platform.detect === 'absent' });
  if (r.error) return make(STATUS.UNKNOWN, r.error);

  if (platform.detect === 'status') {
    if (r.status === 404 || r.status === 410) return make(STATUS.AVAILABLE);
    if (r.status === 200) return make(STATUS.TAKEN);
    if (r.status === 429) return make(STATUS.UNKNOWN, 'rate-limited');
    return make(STATUS.UNKNOWN, `http ${r.status}`);
  }
  // 'absent'
  if (r.status === 404) return make(STATUS.AVAILABLE);
  if (platform.marker && r.body.includes(platform.marker)) return make(STATUS.AVAILABLE);
  if (r.status === 200) return make(STATUS.TAKEN);
  return make(STATUS.UNKNOWN, `http ${r.status}`);
}

// --------------------------------------------------------------------------
// Check one username across a set of platforms
// --------------------------------------------------------------------------
async function checkUsername(username, { concurrency = 10, platforms = PLATFORMS, timeout = 12000, retries = 2 } = {}) {
  const results = await pool(platforms, concurrency, p => checkPlatform(p, username, { timeout, retries }));
  results.sort((a, b) => a.platform.localeCompare(b.platform));
  return results;
}

// --------------------------------------------------------------------------
// Rare username generator
// --------------------------------------------------------------------------
const CONSONANTS = 'bcdfghjklmnpqrstvwxz'.split('');
const VOWELS = 'aeiouy'.split('');
const WORDS = [
  'vex', 'nyx', 'zen', 'lux', 'rue', 'oni', 'ash', 'ivo', 'kai', 'jin',
  'axe', 'orb', 'rex', 'vox', 'zed', 'fox', 'hex', 'jax', 'kir', 'lyo',
  'nova', 'echo', 'onyx', 'flux', 'vale', 'rook', 'sage', 'wren', 'crux', 'halo',
  'myth', 'volt', 'rift', 'drex', 'quar', 'zephyr', 'cove', 'fenn', 'gale', 'iris',
];

const randItem = arr => arr[Math.floor(Math.random() * arr.length)];

function pronounceable(len) {
  let out = '';
  let useConsonant = Math.random() < 0.6;
  while (out.length < len) {
    out += useConsonant ? randItem(CONSONANTS) : randItem(VOWELS);
    useConsonant = !useConsonant;
  }
  return out.slice(0, len);
}

function leetify(word) {
  const map = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };
  return word.split('').map(c => (Math.random() < 0.4 && map[c] ? map[c] : c)).join('');
}

function generateCandidates({ count, len, style }) {
  const set = new Set();
  let guard = 0;
  while (set.size < count && guard < count * 60) {
    guard++;
    let candidate;
    if (style === 'word') {
      candidate = randItem(WORDS);
      if (candidate.length > len + 2) continue;
    } else if (style === 'leet') {
      candidate = leetify(randItem(WORDS));
    } else {
      candidate = pronounceable(len);
    }
    if (/^[a-z0-9_]{1,30}$/i.test(candidate)) set.add(candidate.toLowerCase());
  }
  return [...set];
}

const MAJORS = PLATFORMS.filter(p => p.major);

async function findRare({ count = 20, len = 4, style = 'pronounceable', min = 3, candidateConcurrency = 6 } = {}) {
  const candidates = generateCandidates({ count: count * 4, len, style });
  const picks = [];

  await pool(candidates, candidateConcurrency, async candidate => {
    if (picks.length >= count) return;
    // Only hit the major platforms, in parallel — this is the big speedup.
    const results = await checkUsername(candidate, {
      platforms: MAJORS, concurrency: MAJORS.length, timeout: 9000, retries: 2,
    });
    const availableOn = results.filter(r => r.status === STATUS.AVAILABLE).map(r => r.platform);
    const takenOn = results.filter(r => r.status === STATUS.TAKEN).map(r => r.platform);
    const unknownN = results.length - availableOn.length - takenOn.length;

    if (availableOn.length >= min && takenOn.length === 0 && picks.length < count) {
      picks.push({ username: candidate, availableOn, unknownN });
      process.stdout.write(
        `  ${C.green('✓')} ${C.green(candidate.padEnd(14))} free on: ${availableOn.join(', ')}` +
        `${unknownN ? C.gray(`  (${unknownN} couldn't check)`) : ''}\n`
      );
    } else {
      const note = takenOn.length ? `taken on ${takenOn.join(', ')}` : `free on ${availableOn.length}/${results.length}`;
      process.stdout.write(`  ${C.gray('·')} ${C.gray(candidate.padEnd(14))} ${C.gray('skip (' + note + ')')}\n`);
    }
  });

  return picks.slice(0, count);
}

// --------------------------------------------------------------------------
// Output helpers
// --------------------------------------------------------------------------
const C = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  gray: s => `\x1b[90m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

function printResults(username, results) {
  console.log(`\n${C.bold('Results for')} ${C.bold(C.green(username))}`);
  console.log('─'.repeat(64));
  for (const r of results) {
    let tag;
    if (r.status === STATUS.AVAILABLE) tag = C.green('AVAILABLE');
    else if (r.status === STATUS.TAKEN) tag = C.red('taken    ');
    else tag = C.gray(`unknown  ${r.note ? '(' + r.note + ')' : ''}`);
    console.log(`  ${r.platform.padEnd(20)} ${tag}  ${C.gray(r.url)}`);
  }
  const free = results.filter(r => r.status === STATUS.AVAILABLE).map(r => r.platform);
  const unknown = results.filter(r => r.status === STATUS.UNKNOWN).length;
  console.log('─'.repeat(64));
  console.log(free.length
    ? `  ${C.green('Free on:')} ${free.join(', ')}`
    : `  ${C.red('Not confirmed free on any checked platform.')}`);
  if (unknown) console.log(C.gray(`  (${unknown} platform${unknown > 1 ? 's' : ''} couldn't be checked — blocked, timed out, or filtered)`));
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
function parseFlags(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positionals.push(args[i]);
  }
  return { flags, positionals };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positionals } = parseFlags(rest);

  if (command === 'check') {
    if (!positionals.length) return usage('Give at least one username to check.');
    const out = {};
    // Check multiple usernames in parallel too.
    await pool(positionals, Math.min(positionals.length, 4), async username => {
      const results = await checkUsername(username);
      out[username] = results;
      if (!flags.json) printResults(username, results);
    });
    if (flags.json) console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === 'rare') {
    const count = parseInt(flags.count, 10) || 20;
    const len = parseInt(flags.len, 10) || 4;
    const min = parseInt(flags.min, 10) || 3;
    const style = flags.style || 'pronounceable';
    console.log(C.bold(`\nHunting for rare usernames (style: ${style}, len: ${len}, free on ${min}+ majors)…\n`));
    const t0 = Date.now();
    const picks = await findRare({ count, len, style, min });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n${C.bold('Rare picks:')}  ${C.gray(`(${secs}s)`)}`);
    if (!picks.length) {
      console.log('  none this run — try again, lower --min, or change --style/--len');
      console.log(C.gray('  (on a school/work network most checks get blocked; try home wifi)'));
    }
    for (const p of picks) {
      console.log(`  ${C.green(p.username.padEnd(14))} free on: ${p.availableOn.join(', ')}${p.unknownN ? C.gray(`  (${p.unknownN} couldn't check)`) : ''}`);
    }
    if (flags.json) console.log('\n' + JSON.stringify(picks, null, 2));
    return;
  }

  usage();
}

function usage(msg) {
  if (msg) console.error(C.red(msg) + '\n');
  console.log(`The All Knowing — Username Finder

Usage:
  node username-finder.js check <username> [more...] [--json]
  node username-finder.js rare [--count N] [--len N] [--style word|pronounceable|leet] [--min N] [--json]

Examples:
  node username-finder.js check vex
  node username-finder.js check nova axel --json
  node username-finder.js rare --count 15 --len 4 --style pronounceable
  node username-finder.js rare --min 2        (looser: free on 2+ major platforms)
`);
  process.exitCode = msg ? 1 : 0;
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
