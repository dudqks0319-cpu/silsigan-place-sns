import expoConfig from "eslint-config-expo/flat.js";

const config = [
  {
    ignores: ["node_modules/**", "dist/**", ".expo/**"],
  },
  ...expoConfig,
  {
    rules: {
      "import/namespace": "off",
    },
  },
];

export default config;
