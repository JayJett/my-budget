/* The accent colours a person can choose (their colours live in css/app.css, light and dark).
   Kept separate from accent.js so the tests can read it without a browser. */
export const ACCENTS = [
  { key: "mint", label: "Mint" },
  { key: "emerald", label: "Emerald" },   // Phase 8: four more
  { key: "teal", label: "Teal" },
  { key: "ocean", label: "Ocean" },
  { key: "sky", label: "Sky" },
  { key: "lavender", label: "Lavender" },
  { key: "purple", label: "Purple" },
  { key: "rose", label: "Rose" },
  { key: "coral", label: "Coral" },
  { key: "amber", label: "Amber" },
];
/** Phase 8: "custom" is your own colour (accentHex on your login), adjusted by js/ui/palette.js so text
    and buttons stay readable. */
export const CUSTOM_ACCENT = "custom";
export const DEFAULT_ACCENT = "mint";
