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
 *   node username-finder.js check <username> [username2 ...]
 *   node username-finder.js rare [--count 20] [--len 3] [--style word|pronounceable|leet]
 *   node username-finder.js check <username> --json
 *
 * Examples:
 *   node username-finder.js check vex
 *   node username-finder.js check nova axel --json
 *   node username-finder.js rare --count 15 --len 4 --style pronounceable
 *
 * Notes / honesty:
 *   - "Available" here means the profile URL returned a 404-style "no such user"
 *     response at check time. Some sites hide behind Cloudflare, rate-limit, or
 *     need JavaScript, so a result can be UNKNOWN. Always confirm on the real
 *     signup page before you count on a handle.
 *   - Be polite: this tool throttles requests. Don't hammer sites.
 */

'use strict';

// --------------------------------------------------------------------------
// Platform definitions
//
// detect: how we decide availability from the HTTP response.
//   'status'  -> 404 (or in notFound list) means AVAILABLE, 200 means TAKEN
//   'absent'  -> username is AVAILABLE only if a known "not found" marker string
//                appears in the body; otherwise TAKEN
// --------------------------------------------------------------------------
const PLATFORMS = [
  { name: 'GitHub',      url: u => `https://github.com/${u}`,                 detect: 'status' },
  { name: 'GitLab',      url: u => `https://gitlab.com/${u}`,                 detect: 'status' },
  { name: 'Reddit',      url: u => `https://www.reddit.com/user/${u}/about.json`, detect: 'status' },
  { name: 'Instagram',   url: u => `https://www.instagram.com/${u}/`,         detect: 'status' },
  { name: 'TikTok',      url: u => `https://www.tiktok.com/@${u}`,            detect: 'status' },
  { name: 'Twitch',      url: u => `https://www.twitch.tv/${u}`,              detect: 'status' },
  { name: 'YouTube',     url: u => `https://www.youtube.com/@${u}`,           detect: 'status' },
  { name: 'Pinterest',   url: u => `https://www.pinterest.com/${u}/`,         detect: 'status' },
  { name: 'Steam',       url: u => `https://steamcommunity.com/id/${u}`,      detect: 'absent', marker: 'The specified profile could not be found' },
  { name: 'Telegram',    url: u => `https://t.me/${u}`,                       detect: 'absent', marker: "If you have Telegram, you can contact" },
  { name: 'Medium',      url: u => `https://medium.com/@${u}`,                detect: 'status' },
  { name: 'Dev.to',      url: u => `https://dev.to/${u}`,                     detect: 'status' },
  { name: 'Replit',      url: u => `https://replit.com/@${u}`,                detect: 'status' },
  { name: 'SoundCloud',  url: u => `https://soundcloud.com/${u}`,             detect: 'status' },
  { name: 'Spotify',     url: u => `https://open.spotify.com/user/${u}`,      detect: 'status' },
  { name: 'Patreon',     url: u => `https://www.patreon.com/${u}`,            detect: 'status' },
  { name: 'Behance',     url: u => `https://www.behance.net/${u}`,            detect: 'status' },
  { name: 'Dribbble',    url: u => `https://dribbble.com/${u}`,               detect: 'status' },
  { name: 'Keybase',     url: u => `https://keybase.io/${u}`,                 detect: 'status' },
  { name: 'npm',         url: u => `https://www.npmjs.com/~${u}`,             detect: 'status' },
  { name: 'PyPI',        url: u => `https://pypi.org/user/${u}/`,             detect: 'status' },
  { name: 'HackerNews',  url: u => `https://news.ycombinator.com/user?id=${u}`, detect: 'absent', marker: 'No such user.' },
  { name: 'Chess.com',   url: u => `https://www.chess.com/member/${u}`,       detect: 'status' },
  { name: 'Mastodon.social', url: u => `https://mastodon.social/@${u}`,       detect: 'status' },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const STATUS = { AVAILABLE: 'AVAILABLE', TAKEN: 'TAKEN', UNKNOWN: 'UNKNOWN' };

// --------------------------------------------------------------------------
// Core check for one platform
// --------------------------------------------------------------------------
async function checkPlatform(platform, username, { timeout = 10000 } = {}) {
  const url = platform.url(username);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: platform.detect === 'absent' ? 'GET' : 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (platform.detect === 'status') {
      if (res.status === 404 || res.status === 410) return result(STATUS.AVAILABLE, url);
      if (res.status === 200) return result(STATUS.TAKEN, url);
      if (res.status === 429) return result(STATUS.UNKNOWN, url, 'rate-limited');
      return result(STATUS.UNKNOWN, url, `http ${res.status}`);
    }

    // 'absent' marker detection
    if (res.status === 404) return result(STATUS.AVAILABLE, url);
    const body = await res.text();
    if (platform.marker && body.includes(platform.marker)) {
      return result(STATUS.AVAILABLE, url);
    }
    if (res.status === 200) return result(STATUS.TAKEN, url);
    return result(STATUS.UNKNOWN, url, `http ${res.status}`);
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.code || err.message;
    return result(STATUS.UNKNOWN, url, reason);
  } finally {
    clearTimeout(timer);
  }

  function result(status, url, note) {
    return { platform: platform.name, status, url, note };
  }
}

// --------------------------------------------------------------------------
// Check one username across all platforms, with bounded concurrency
// --------------------------------------------------------------------------
async function checkUsername(username, { concurrency = 6 } = {}) {
  const queue = [...PLATFORMS];
  const results = [];

  async function worker() {
    while (queue.length) {
      const platform = queue.shift();
      results.push(await checkPlatform(platform, username));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
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

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
  return word
    .split('')
    .map(c => (Math.random() < 0.4 && map[c] ? map[c] : c))
    .join('');
}

function generateCandidates({ count, len, style }) {
  const set = new Set();
  let guard = 0;
  while (set.size < count && guard < count * 50) {
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

// A username counts as "rare" if it's free on the big social platforms.
const RARE_PLATFORMS = ['GitHub', 'Instagram', 'TikTok', 'Reddit', 'Twitch'];

async function findRare({ count = 20, len = 4, style = 'pronounceable' } = {}) {
  const candidates = generateCandidates({ count: count * 3, len, style });
  const rare = [];

  for (const candidate of candidates) {
    if (rare.length >= count) break;
    const results = await checkUsername(candidate, { concurrency: 5 });
    const relevant = results.filter(r => RARE_PLATFORMS.includes(r.platform));
    const availCount = relevant.filter(r => r.status === STATUS.AVAILABLE).length;
    const takenCount = relevant.filter(r => r.status === STATUS.TAKEN).length;

    if (availCount >= 4) {
      rare.push({ username: candidate, available: availCount, taken: takenCount, of: relevant.length });
      process.stdout.write(`  ✓ ${candidate.padEnd(14)} free on ${availCount}/${relevant.length} major platforms\n`);
    } else {
      process.stdout.write(`  · ${candidate.padEnd(14)} skip (free on ${availCount}/${relevant.length})\n`);
    }
  }
  return rare;
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
  console.log('─'.repeat(60));
  for (const r of results) {
    let tag;
    if (r.status === STATUS.AVAILABLE) tag = C.green('AVAILABLE');
    else if (r.status === STATUS.TAKEN) tag = C.red('taken    ');
    else tag = C.gray(`unknown  ${r.note ? '(' + r.note + ')' : ''}`);
    console.log(`  ${r.platform.padEnd(20)} ${tag}  ${C.gray(r.url)}`);
  }
  const free = results.filter(r => r.status === STATUS.AVAILABLE).map(r => r.platform);
  console.log('─'.repeat(60));
  console.log(free.length
    ? `  ${C.green('Free on:')} ${free.join(', ')}`
    : `  ${C.red('Not free on any checked platform.')}`);
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
    for (const username of positionals) {
      const results = await checkUsername(username);
      out[username] = results;
      if (!flags.json) printResults(username, results);
    }
    if (flags.json) console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === 'rare') {
    const count = parseInt(flags.count, 10) || 20;
    const len = parseInt(flags.len, 10) || 4;
    const style = flags.style || 'pronounceable';
    console.log(C.bold(`\nHunting for rare usernames (style: ${style}, len: ${len})…\n`));
    const rare = await findRare({ count, len, style });
    console.log(`\n${C.bold('Rare picks (free on 4+ major platforms):')}`);
    if (!rare.length) console.log('  none found this run — try again or change --style/--len');
    for (const r of rare) console.log(`  ${C.green(r.username.padEnd(14))} ${r.available}/${r.of} major platforms free`);
    if (flags.json) console.log('\n' + JSON.stringify(rare, null, 2));
    return;
  }

  usage();
}

function usage(msg) {
  if (msg) console.error(C.red(msg) + '\n');
  console.log(`The All Knowing — Username Finder

Usage:
  node username-finder.js check <username> [more...] [--json]
  node username-finder.js rare [--count N] [--len N] [--style word|pronounceable|leet] [--json]

Examples:
  node username-finder.js check vex
  node username-finder.js check nova axel --json
  node username-finder.js rare --count 15 --len 4 --style pronounceable
`);
  process.exitCode = msg ? 1 : 0;
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
