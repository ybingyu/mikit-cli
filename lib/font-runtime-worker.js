'use strict';

const {
  collectRuntimeFontCharacters,
} = require('./font-runtime-collector');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  try {
    const config = JSON.parse(input);
    const result = await collectRuntimeFontCharacters(config, {
      onWarning(message) {
        for (const line of String(message).split(/\r?\n/)) {
          process.stderr.write(`${line}\n`);
        }
      },
    });
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(`[mikit font] ${error.message}\n`);
    process.exitCode = 1;
  }
});
