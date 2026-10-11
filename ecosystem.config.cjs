/**
 * ==============================================================================
 * BARE-METAL FALLBACK CONFIGURATION ONLY (PM2)
 * ==============================================================================
 * ARCHITECTURAL DECISION NOTE:
 * The primary process management strategy for Sri Tirumala Dry Fruits is
 * CONTAINER-NATIVE (Docker & Docker Compose).
 *
 * DO NOT run PM2 inside Docker containers. Running PM2 inside a container creates
 * duplicate process supervisors, swallows SIGTERM signals, breaks container health
 * monitoring, and wastes memory.
 *
 * This file is retained STRICTLY as a legacy fallback for uncontainerized,
 * bare-metal on-premise host deployments where Docker is not available.
 * ==============================================================================
 */

module.exports = {
  apps: [{
    name: 'sri-tirumala-pos-legacy',
    script: './dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    kill_timeout: 10000, // 10s graceful shutdown window for SQLite WAL checkpoints
    wait_ready: true,
    listen_timeout: 8000,
    max_memory_restart: '768M',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
  }]
};
