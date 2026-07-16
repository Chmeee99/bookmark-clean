declare const module: {
  exports: {
    CHROME_HTML_MAX_INPUT_BYTES: 16_777_216;
  };
};

const CHROME_HTML_MAX_INPUT_BYTES = 16_777_216 as const;

module.exports = { CHROME_HTML_MAX_INPUT_BYTES };
