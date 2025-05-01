import globals from "globals";
import pluginJs from "@eslint/js";


export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  Object.assign(
    {
      files: ['**/*.test.js'],
      env: { jest: true },
      plugins: ['jest'],
    }
  )
];
