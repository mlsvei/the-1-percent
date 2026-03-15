module.exports = {
  apps: [
    {
      name: 'the1-backend',
      cwd: '/Applications/Codex stuff/backend',
      script: 'dist/src/index.js',
      interpreter: 'node',
      env: {
        PORT: '4001',
        INGEST_ENABLED: 'true',
        INGEST_INCLUDE_BRACKET_AUTO: 'false',
        INGEST_INTERVAL_SECONDS: '300'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: 'the1-frontend',
      cwd: '/Applications/Codex stuff/frontend',
      script: 'node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: 'preview --host 127.0.0.1 --port 5174 --strictPort',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000
    }
  ]
};
