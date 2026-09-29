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
      mbuild: 'mikit build --mincss',
      'mbuild:font': 'mikit build --mincss --minfont',
      png: 'mikit png',
      replace: 'mikit replace',
      'replace:dev': 'set NODE_ENV=development &&  npm run replace',
      'replace:build': 'set NODE_ENV=production &&  npm run replace',
      dev: 'npm run mbuild  && npm run replace:dev',
      build: 'npm run mbuild  && npm run replace:build',
      pack: 'mikit pack',
      'sync:svn': 'mikit sync-svn',
      'dev:svn': 'npm run dev && npm run sync:svn',
      'build:svn': 'npm run build && npm run sync:svn'
    },
    mikit: {
      author: '',
      replace: {
        root: 'dist',
        include: ['**/*.css'],
        rules: [
          {
            disabled: false,
            from: '../img/',
            to: 'https://img9.99.com/my/activity/example/'
          }
        ]
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
        targets: [],
        files: ['*']
      },
      png: {
        root: 'dist',
        mode: 'quantize',
        colors: 256,
        level: 'balanced',
        exclude: []
      },
      font: {
        pages: [],
        wait: 1000,
        timeout: 15000,
        asciiBaseline: 'none',
        dynamicTextPolicy: 'warn',
        globalExtraText: '',
        familyExtraText: {},
        familyOptions: {}
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
