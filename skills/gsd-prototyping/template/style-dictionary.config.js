// Builds the DTCG token files under tokens/ into a single CSS custom-property
// layer at css/tokens.css. Prototype CSS consumes only those custom properties,
// so a literal color or length in a rule is always a defect.
//
// `usesDtcg` is explicit: style-dictionary only auto-detects `$value`/`$type` for
// tokens passed imperatively, so a file-sourced build must state DTCG mode itself.
export default {
  usesDtcg: true,
  source: ["tokens/**/*.json"],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "css/",
      files: [
        {
          destination: "tokens.css",
          format: "css/variables",
          options: { selector: ":root", outputReferences: true },
        },
      ],
    },
  },
};
