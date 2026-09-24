const globals = require("globals");

module.exports = [
    {
        files: ["**/*.js"],

        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "script",
            globals: {
                ...globals.browser
            }
        },

        rules: {
            "no-var": "error",
            "prefer-const": "error"
        }
    }
];