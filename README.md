# Token Radar

Token Radar is a deterministic, offline research dashboard for the `token-radar-01` competition. It ranks protocols whose sealed DefiLlama snapshot records no token, keeps every watchlist protocol, adds up to 160 eligible below-floor protocols, and separates token-bearing references from the pre-token ranking.

## Run

Requires Node.js 22.18 or later. No package install, API key, or network access is needed.

```powershell
New-Item -ItemType Directory -Force out | Out-Null
$env:MAKEFUN_OUTPUT_DIR = 'out'
node main.ts --input .\token-radar-01-kit\input\snapshot.json
```

The grader mounts the same sealed file at `/input/snapshot.json` and writes to `/output`. Use `--input <snapshot.json|directory>` and `--output <directory>` to override those paths.

## Outputs

- `board.json`: ranked rows with an implied value and a concrete, costed research plan for each protocol.
- `data.js`, `dashboard/`, and `screenshots/`: the self-contained dashboard bundle.
- `dossier.json`: generated from the dashboard sources and screenshots using the competition's `buildDossier` helper.

## Model and limitations

The model is name-agnostic: implied value is TVL multiplied by a 0.22 base multiple, a seven-day growth multiplier (clamped to -60%..+120%, weighted by 0.5), and an age multiplier (0.62..1.00 over 1,460 days). An absent age uses a fixed 540-day estimate. The ranking is an analytical estimate, not a token price, issuance forecast, or airdrop promise.

This competition supplies a frozen protocol snapshot, not live token-pair data. The entry and dashboard make no network requests and do not fabricate contract addresses, launch counts, holder concentration, mint/freeze authorities, LP locks, or historical price charts. Evidence badges describe snapshot-field completeness only; they are not safety ratings. Verify a protocol's official documentation, contracts, and risks before interacting. Farm plans are optional research actions, not financial advice.

## License

MIT. See [LICENSE](LICENSE).
