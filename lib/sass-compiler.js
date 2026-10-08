const sass = require('sass');

function compileSassFile(filePath, options = {}) {
  const result = sass.compile(filePath, {
    style: options.compressed ? 'compressed' : 'expanded',
    loadPaths: options.loadPaths || [],
    ...(options.logger ? { logger: options.logger } : {})
  });

  return result.css;
}

module.exports = {
  compileSassFile
};
