# Bundled fonts

## IBMPlexSansArabic-Regular.ttf

- **Font name:** IBM Plex Sans Arabic Regular
- **License:** SIL Open Font License 1.1 (OFL-1.1)
- **Source:** https://github.com/IBM/plex
- **Why bundled:** The PDF export (`app/api/export.py`) uses this font to render
  Arabic text correctly (right-to-left, proper ligature shaping) in any deployment
  environment — including Docker containers — without requiring the font to be
  pre-installed on the host system.

The SIL OFL 1.1 permits redistribution in software, as long as the font is not
sold on its own and any modifications use a different name. Bundling it here
(unchanged, as part of this application) is fully compliant with those terms.
