# The All Knowing — Username Finder

A zero-dependency Node.js CLI that checks whether a username is **available** across
many platforms, and hunts for **rare** short/pronounceable usernames that are still free.

Requires **Node 18+** (uses the built-in global `fetch`).

## Install

```bash
git clone https://github.com/Timmeyfn/The-All-Knowing.git
cd The-All-Knowing
```

No `npm install` needed — there are no dependencies.

## Usage

### Check a handle across platforms

```bash
node username-finder.js check vex
node username-finder.js check nova axel
node username-finder.js check vex --json
```

Each platform is marked `AVAILABLE`, `taken`, or `unknown`. Platforms checked include
GitHub, **Roblox**, **Discord**, GitLab, Reddit, Instagram, TikTok, Twitch, YouTube,
Pinterest, Steam, Telegram, Medium, Dev.to, Replit, SoundCloud, Spotify, Patreon,
Behance, Dribbble, Keybase, npm, PyPI, Hacker News, Chess.com, and Mastodon.

> **Roblox** uses its official public API, so results are reliable.
> **Discord** is best-effort: since the unique-username change there's no public
> profile lookup, so this uses Discord's signup availability check. It rate-limits
> easily and will then show `unknown`. It checks the base name only (ignores the
> `#tag`).

### Hunt for rare usernames

```bash
node username-finder.js rare --count 15 --len 4 --style pronounceable
```

It generates candidates and, for each keeper, **lists exactly which major platforms
it's free on** (GitHub, Roblox, Instagram, TikTok, Reddit, Twitch) — for example:

```
  ovut           free on: GitHub, Roblox, TikTok, Reddit
```

Only the major platforms are checked in `rare` mode, which is what makes it fast.

| Flag        | Default         | Meaning                                              |
|-------------|-----------------|------------------------------------------------------|
| `--count N` | `20`            | How many rare picks to return                        |
| `--len N`   | `4`             | Target length for generated handles                  |
| `--style`   | `pronounceable` | `pronounceable`, `word`, or `leet` generation style  |
| `--min N`   | `3`             | Require the name be free on at least N major platforms |
| `--json`    | off             | Also print machine-readable JSON                     |

On a school/work network, lots of checks get blocked, so you'll find fewer picks —
lower `--min` (e.g. `--min 2`) or try from a home connection.

## How "available" is decided

"Available" means the platform's profile URL returned a not-found response at check
time. This is a strong hint, not a guarantee:

- Some sites hide behind Cloudflare, rate-limit, or require JavaScript, so you'll see
  `unknown` rather than a false answer.
- Platforms reserve names, ban words, and enforce length/character rules that a URL
  check can't see.

**Always confirm on the real signup page before you commit to a handle.**

## Be a good citizen

The tool throttles requests on purpose. Don't crank concurrency up to hammer sites —
you'll just get rate-limited and blocked.

## License

MIT — see [LICENSE](LICENSE).
