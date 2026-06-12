/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...r] = a.replace(/^--/, '').split('=');
  return [k, r.join('=') === '' ? true : r.join('=')];
}));

const ROOT = path.resolve(argv.root || __dirname);
const META_DIR = path.resolve(argv['out-dir'] || path.join(ROOT, '.meta'));
const MODE = String(argv.mode || 'both').toLowerCase();
const MAX_LINES = Number(argv['max-lines'] || 20000);

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

const FULL_FILE = path.join(META_DIR, 'project-games-full.txt');
const ADAPTIVE_FILE = path.join(META_DIR, 'project-games-adaptive.txt');

const toUnix = p => String(p || '').replace(/\\/g, '/');
const SELF_FULL_REL = toUnix(path.relative(ROOT, FULL_FILE));
const SELF_ADAPT_REL = toUnix(path.relative(ROOT, ADAPTIVE_FILE));

const TEXT_EXTS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx',
  '.json', '.webmanifest', '.md', '.txt', '.yml', '.yaml', '.svg'
]);

const EXCLUDE_RAW = [
  '.git/**',
  '.meta/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '.husky/**',
  '.DS_Store',
  '**/*.log',
  '**/*.tmp',
  '**/*.temp',
  '**/*.bak',
  '**/*.orig',
  '**/*.rej',
  '**/*.map',
  '**/*.min.js',
  '**/*.min.css',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'qwen-code-*',
  '**/qwen-code-*',
  '.aider*',
  '**/.aider*',
  '.continue/**',
  '.copilot/**',
  'project-full*.txt',
  'project-adaptive*.txt',
  'project-games-full*.txt',
  'project-games-adaptive*.txt'
];

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico',
  '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm',
  '.woff', '.woff2', '.ttf', '.otf',
  '.zip', '.7z', '.rar', '.gz', '.pdf'
]);

const PRIORITY = {
  critical: [
    /^index\.html?$/i,
    /^styles\.css$/i,
    /^src\/app\.js$/i,
    /^\.github\/workflows\/deploy\.ya?ml$/i,
    /^\.github\/workflows\/generate-context\.ya?ml$/i,
    /^generate-context\.js$/i,
    /^ai-rules\.txt$/i,
    /^README\.md$/i
  ],
  high: [
    /^src\/.*\.(js|mjs|ts)$/i,
    /^.*\.(css|html?)$/i,
    /^\.github\/workflows\/.*\.ya?ml$/i
  ],
  medium: [
    /^.*\.(js|mjs|cjs|ts|tsx|json|md|txt|ya?ml|css|html?|svg)$/i
  ]
};

const globToRegExp = p => {
  const hasPath = p.includes('/') || p.includes('**');
  const esc = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*');
  return hasPath ? new RegExp(`^${esc}$`) : new RegExp(`(^|/)${esc}(/|$)`);
};

const EXCLUDES = EXCLUDE_RAW.map(globToRegExp);

const isExcluded = rel => {
  const u = toUnix(rel);
  if (!u || u === SELF_FULL_REL || u === SELF_ADAPT_REL) return true;
  return EXCLUDES.some(re => re.test(u));
};

const isTextFile = rel => {
  const ext = path.extname(rel).toLowerCase();
  if (BINARY_EXTS.has(ext)) return false;
  return TEXT_EXTS.has(ext);
};

const readText = rel => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    return `// read error: ${e.message}`;
  }
};

const countLines = s => (String(s || '').match(/\n/g) || []).length + (String(s || '').length ? 1 : 0);

const listAllEntries = (includeFiles = true) => {
  const out = [];
  const stack = [ROOT];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const item of entries) {
      const full = path.join(dir, item.name);
      const rel = toUnix(path.relative(ROOT, full)) || '.';
      if (isExcluded(rel)) continue;

      if (item.isDirectory()) {
        out.push({ rel, full, dir: true });
        stack.push(full);
      } else if (item.isFile() && includeFiles) {
        out.push({ rel, full, dir: false });
      }
    }
  }

  return out.sort((a, b) => a.dir !== b.dir ? (a.dir ? -1 : 1) : a.rel.localeCompare(b.rel));
};

const getPriority = rel => {
  const u = toUnix(rel);
  return Object.keys(PRIORITY).find(level => PRIORITY[level].some(re => re.test(u))) || 'low';
};

const readRepoUrl = () => {
  try {
    const cfg = path.join(ROOT, '.git', 'config');
    if (!fs.existsSync(cfg)) return '';
    return (fs.readFileSync(cfg, 'utf8').match(/url\s*=\s*(.+)\n/) || [])[1]?.trim() || '';
  } catch {
    return '';
  }
};

const renderTree = () => {
  const lines = ['СТРУКТУРА ПРОЕКТА:', `${path.basename(ROOT)}/`];

  const walk = (dir, prefix = '') => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const visible = entries
      .filter(x => !isExcluded(toUnix(path.relative(ROOT, path.join(dir, x.name)))))
      .sort((a, b) => a.isDirectory() !== b.isDirectory() ? (a.isDirectory() ? -1 : 1) : a.name.localeCompare(b.name));

    visible.forEach((x, i) => {
      const last = i === visible.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${x.name}${x.isDirectory() ? '/' : ''}`);
      if (x.isDirectory()) walk(path.join(dir, x.name), `${prefix}${last ? '    ' : '│   '}`);
    });
  };

  walk(ROOT);
  return lines.join('\n');
};

const headerBlock = () => {
  const rulesPath = path.join(ROOT, 'ai-rules.txt');
  const rules = fs.existsSync(rulesPath) ? `${fs.readFileSync(rulesPath, 'utf8').trim()}\n\n` : '';
  const repoName = String(argv['repo-name'] || path.basename(ROOT));
  const repoUrl = String(argv['repo-url'] || readRepoUrl() || 'https://github.com/apel-s-in/vi3na1bita-games');

  return `${rules}Название репозитория: ${repoName}
Адрес репозитория: ${repoUrl}
Назначение: изолированный Game Center micro-app для основного приложения vi3na1bita-music.
Публичный путь после деплоя: https://vi3na1bita.website.yandexcloud.net/Games/
Проект делается и обслуживается средствами https://github.com/ (GitHub Pages + GitHub Actions + Yandex Object Storage).

${renderTree()}

Сгенерировано: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC

`;
};

const fileBlock = rel => `//=================================================
// FILE: /${toUnix(rel)}
${readText(rel)}
`;

const generate = mode => {
  let out = headerBlock();
  let lines = countLines(out);

  const groups = listAllEntries(true)
    .filter(e => !e.dir && isTextFile(e.rel))
    .reduce((acc, e) => {
      acc[getPriority(e.rel)].push(e.rel);
      return acc;
    }, { critical: [], high: [], medium: [], low: [] });

  const order = mode === 'adaptive' ? ['critical', 'high', 'medium'] : ['critical', 'high', 'medium', 'low'];

  for (const level of order) {
    for (const rel of groups[level]) {
      const block = fileBlock(rel);
      const blockLines = countLines(block);
      if (mode === 'adaptive' && lines + blockLines > MAX_LINES) {
        return `${out}\n// ... adaptive context truncated by --max-lines=${MAX_LINES}\n`;
      }
      out += block;
      lines += blockLines;
    }
  }

  return out;
};

try {
  if (MODE === 'full' || MODE === 'both') {
    fs.writeFileSync(FULL_FILE, generate('full'), 'utf8');
    console.log(`✅ ${FULL_FILE}`);
  }

  if (MODE === 'adaptive' || MODE === 'both') {
    fs.writeFileSync(ADAPTIVE_FILE, generate('adaptive'), 'utf8');
    console.log(`✅ ${ADAPTIVE_FILE}`);
  }
} catch (e) {
  console.error('❌ context generation failed:', e);
  process.exit(1);
}
