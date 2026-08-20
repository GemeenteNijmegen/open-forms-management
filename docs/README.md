# Lokaal ontwikkelen

## Installeren

```bash
npm ci
npx projen build
```

`projen build` compileert, synthiseert de CDK-stacks, lint en draait alle tests. Een groene build betekent dus ook dat de stack succesvol synthiseert.


Jest draait met `POWERTOOLS_LOG_LEVEL=SILENT` (`test/jest.setup.ts`), dus Powertools-logregels verschijnen niet in de testoutput.

## Preview van pagina's zonder deploy

Alle server-rendered Mustache-pagina's (home, login, logout, 403, 404) zijn los van een deploy te bekijken:

```bash
npx projen preview        # rendert eenmalig alle pagina's naar preview/*.html
npx projen preview:watch  # her-rendert bij iedere wijziging aan een .mustache-bestand
```

Open de bestanden in `preview/` direct in de browser (`file://`). Links tussen pagina's zijn herschreven naar de
bestandsnamen in `preview/`; een route die nog geen preview heeft, krijgt automatisch een stub-pagina zodat elke
link ergens naartoe blijft gaan (`src/preview/render-previews.ts`).

Fixtures voor de preview-data staan in `src/preview/fixtures/`. Een nieuwe pagina toevoegen: render 'm met een
fixture in `renderAll()` (`src/preview/render-previews.ts`), en zet 'm in `ROUTE_TO_PREVIEW_FILE` als de route
ook vanuit een andere pagina gelinkt wordt.


## Open Forms API verkennen

`bruno/` bevat een Bruno-collectie om de Open Forms API zelf te bevragen tijdens ontwikkeling (bijvoorbeeld
formulierdefinities ophalen), niet deze applicatie. Vul een token in via de secret-variabele `tokenAuth` in de
gewenste environment (`acceptance`/`development`/`production`).
