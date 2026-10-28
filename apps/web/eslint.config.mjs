// The template's `.eslintrc.json` (`extends: next/core-web-vitals`, run through
// `next lint`) has no Next 16 equivalent — `next lint` is gone and
// eslint-config-next 16 ships flat configs — so this is the same rule set as a
// flat config, and the `lint` script is `eslint .`.
import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  { ignores: [".next/**", ".open-next/**", "next-env.d.ts", "cloudflare-env.d.ts"] },
];

export default config;
