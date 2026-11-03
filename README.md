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
GitHub, GitLab, Reddit, Instagram, TikTok, Twitch, YouTube, Pinterest, Steam, Telegram,
Medium, Dev.to, Replit, SoundCloud, Spotify, Patreon, Behance, Dribbble, Keybase, npm,
PyPI, Hacker News, Chess.com, and Mastodon.

### Hunt for rare usernames

```bash
node username-finder.js rare --count 15 --len 4 --style pronounceable
```

It generates candidates and keeps the ones that are free on 4+ major platforms.

| Flag        | Default         | Meaning                                              |
|-------------|-----------------|------------------------------------------------------|
| `--count N` | `20`            | How many rare picks to return                        |
| `--len N`   | `4`             | Target length for generated handles                  |
| `--style`   | `pronounceable` | `pronounceable`, `word`, or `leet` generation style  |
| `--json`    | off             | Also print machine-readable JSON                     |

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
