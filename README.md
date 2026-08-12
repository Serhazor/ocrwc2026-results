# 2026 OCR World Championships Results

Interactive static results archive for the 2026 OCR World Championships in Ireland.

## Features

- Filterable results across 100m, 100m Team Relay, 400m, 400m Team Relay, Short Course, Standard Course and XC Team Relay
- Athlete profiles linking individual races and relay memberships
- Country pages with delegation results and medal breakdowns
- Event-specific and combined medal tables
- Qualification/elimination stage details where supplied
- DNC analysis for Short and Standard Course
- Championship insights, multi-event athletes and data-quality notes
- Downloadable four-slide Instagram carousels from every athlete profile, branded with the OCR Ireland logo
- Mobile-friendly static site suitable for Vercel

## Data methodology

The app is generated from the supplied timing exports. Important rules:

- Short/Standard `DNC` means the athlete finished the course but failed 3 or more obstacles. DNC results keep a finish time but are unranked and excluded from medals.
- 100m individual medals use final-stage times where available. Championship categories without a usable final-stage record use the supplied Best Time as a direct-final result.
- 400m individual stages are linked to qualification entries by normalized athlete name and exact division. Podiums use the supplied finals times; entries marked `No Final` use the time supplied in parentheses as a direct-final result.
- Athlete carousel distance totals count recorded individual starts using 100m, 400m, 3 km Short Course and 12 km+ Standard Course distances. Relay legs are excluded because individual split distances were not supplied.
- 100m Team Relay and 400m Team Relay podiums are calculated from the supplied Best Time across Q1/Q2. Open categories are excluded.
- XC Team Unranked entries are treated as DNC and excluded from podiums.

## Deploy to Vercel

This is a dependency-free static site. Import the repository into Vercel and deploy with the default settings. No build command is required.

## Local preview

```bash
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

## Flag artwork

Country flags are provided by [flag-icons](https://github.com/lipis/flag-icons) via jsDelivr and are used under the MIT License. ISO country codes remain visible as a fallback if an image cannot be loaded.
