module.exports = {
  apps: [{
    name: 'skip-bo-server',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 8000,
    env: { NODE_ENV: 'production' },
  }],
};
