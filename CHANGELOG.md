# Changelog

## 1.1.0 (2026-07-18)

### Added
- **EXIF Metadata Display**: Hover over images in daily notes or calendar cells to see camera info (make, model, lens, aperture, shutter, ISO, focal length, GPS, software). 
- **Multi-format EXIF Support**: Parses EXIF from JPEG, PNG, WebP, and HEIC images. Zero external dependencies — custom lightweight parser.
- **HEIC Image Display**: Auto-converts HEIC photos to displayable JPEG thumbnails using libheif-js (WASM). Calendar sidebar backgrounds and note embeds both supported.
- **Locale System**: Full Chinese/English localization for EXIF labels and settings via the existing language selector.
- **Settings Toggle**: "Show image EXIF metadata" option in plugin settings.

### Changed
- Tooltip style: frosted glass design matching the weather overlay.
- Image resolution in notes: uses Obsidian's wikilink resolver (`getFirstLinkpathDest`) for reliable file lookup regardless of vault structure.
- EXIF cache shared across calendar sidebar and note-image features for consistency.

### Fixed
- MutationObserver replaces fixed-delay scanning for note images — tooltip now appears instantly when navigating to a note.

## 1.0.0 (Initial Release)

- Monthly calendar in left sidebar
- Image thumbnails from daily notes as date cell backgrounds
- Today highlight + browsing-date highlight
- One-click open / auto-create daily notes
- Weather card with Open-Meteo integration
- Configurable daily folder, thumbnail filter, weather settings
