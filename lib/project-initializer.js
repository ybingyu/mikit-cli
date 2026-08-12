'use strict';

const fs = require('fs');
const path = require('path');

function createInitialPackageJson(projectDir) {
  const resolvedProjectDir = path.resolve(projectDir || process.cwd());
  const packagePath = path.join(resolvedProjectDir, 'package.json');
  const packageJson = {
    name: path.basename(resolvedProjectDir),
    version: '1.0.0',
    private: true,
    scripts: {
      start: 'mikit start',
      build: 'mikit build',
      replace: 'mikit replace',
      pack: 'mikit pack',
      'sync:svn': 'mikit sync-svn'
    },
    mikit: {
      replace: {
        root: 'dist',
        include: ['**/*.css'],
        rules: []
      },
      pack: {
        source: 'wwwroot',
        dist: 'dist',
        output: 'packed',
        pageDirs: ['.', 'include'],
        assetDirs: ['js', 'css'],
        excludePages: ['*font*.shtml']
      },
      syncSvn: {
        source: 'dist/css',
        target: '',
        files: ['*']
      }
    }
  };

  try {
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx'
    });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error('package.json 已存在，不会覆盖：' + packagePath);
    }
    throw error;
  }

  return { packagePath, packageJson };
}

module.exports = {
  createInitialPackageJson
};
