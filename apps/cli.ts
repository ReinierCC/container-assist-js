#!/usr/bin/env node
/**
 * Container Kit MCP CLI
 * Command-line interface for the Container Kit MCP Server
 */

import { program } from 'commander';
import { ContainerKitMCPServer } from './server.js';
import { createConfig, logConfigSummaryIfDev } from '../src/config/index.js';
import { createPinoLogger } from '../src/infrastructure/logger.js';
import { exit, argv, env, cwd } from 'node:process';
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const logger = createPinoLogger({ service: 'cli' });

program
  .name('container-kit-mcp')
  .description('MCP server for AI-powered containerization workflows')
  .version(packageJson.version)
  .option('--config <path>', 'path to configuration file (.env)')
  .option('--log-level <level>', 'logging level: debug, info, warn, error (default: info)', 'info')
  .option('--workspace <path>', 'workspace directory path (default: current directory)', cwd())
  .option('--port <port>', 'port for HTTP transport (default: stdio)', parseInt)
  .option('--host <host>', 'host for HTTP transport (default: localhost)', 'localhost')
  .option('--dev', 'enable development mode with debug logging')
  .option('--mock', 'use mock AI sampler for testing')
  .option('--validate', 'validate configuration and exit')
  .option('--list-tools', 'list all available MCP tools and exit')
  .option('--health-check', 'perform system health check and exit')
  .option('--docker-socket <path>', 'Docker socket path (default: /var/run/docker.sock)', '/var/run/docker.sock')
  .option('--k8s-namespace <namespace>', 'default Kubernetes namespace (default: default)', 'default')
  .addHelpText('after', `

Examples:
  $ container-kit-mcp                           Start server with stdio transport
  $ container-kit-mcp --port 3000              Start server on HTTP port 3000
  $ container-kit-mcp --dev --log-level debug  Start in development mode with debug logs
  $ container-kit-mcp --list-tools             Show all available MCP tools
  $ container-kit-mcp --health-check           Check system dependencies
  $ container-kit-mcp --validate               Validate configuration

Quick Start:
  1. Copy .env.example to .env and configure
  2. Run: container-kit-mcp --health-check
  3. Start server: container-kit-mcp
  4. Test with: echo '{"method":"tools/ping","params":{},"id":1}' | container-kit-mcp

MCP Tools Available:
  • Analysis: analyze_repository, resolve_base_images
  • Build: generate_dockerfile, build_image, scan_image
  • Registry: tag_image, push_image
  • Deploy: generate_k8s_manifests, deploy_application
  • Orchestration: start_workflow, workflow_status
  • Utilities: ping, list_tools, server_status

For detailed documentation, see: docs/tools/README.md
For examples and tutorials, see: examples/README.md

Environment Variables:
  LOG_LEVEL                 Logging level (debug, info, warn, error)
  WORKSPACE_DIR            Working directory for operations
  DOCKER_SOCKET            Docker daemon socket path
  K8S_NAMESPACE            Default Kubernetes namespace
  MOCK_MODE                Enable mock mode for testing
  NODE_ENV                 Environment (development, production)
`);

program.parse(argv);

const options = program.opts();

// Validation function for CLI options
function validateOptions(opts: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (opts.logLevel && !validLogLevels.includes(opts.logLevel)) {
    errors.push(`Invalid log level: ${opts.logLevel}. Valid options: ${validLogLevels.join(', ')}`);
  }

  // Validate port
  if (opts.port && (opts.port < 1 || opts.port > 65535)) {
    errors.push(`Invalid port: ${opts.port}. Must be between 1 and 65535`);
  }

  // Validate workspace directory exists
  if (opts.workspace) {
    try {
      const stat = statSync(opts.workspace);
      if (!stat.isDirectory()) {
        errors.push(`Workspace path is not a directory: ${opts.workspace}`);
      }
    } catch (error) {
      errors.push(`Workspace directory does not exist: ${opts.workspace}`);
    }
  }

  // Validate Docker socket path (if not mock mode)
  if (!opts.mock && opts.dockerSocket) {
    try {
      statSync(opts.dockerSocket);
    } catch (error) {
      errors.push(`Docker socket not found: ${opts.dockerSocket}. Try --mock for testing without Docker.`);
    }
  }

  // Validate config file exists if specified
  if (opts.config) {
    try {
      statSync(opts.config);
    } catch (error) {
      errors.push(`Configuration file not found: ${opts.config}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

async function main(): Promise<void> {
  try {
    // Validate CLI options
    const validation = validateOptions(options);
    if (!validation.valid) {
      console.error('❌ Configuration errors:');
      validation.errors.forEach(error => console.error(`  • ${error}`));
      console.error('\nUse --help for usage information');
      exit(1);
    }

    // Set environment variables based on CLI options
    if (options.logLevel) env.LOG_LEVEL = options.logLevel;
    if (options.workspace) env.WORKSPACE_DIR = options.workspace;
    if (options.dockerSocket) process.env.DOCKER_SOCKET = options.dockerSocket;
    if (options.k8sNamespace) process.env.K8S_NAMESPACE = options.k8sNamespace;
    if (options.dev) process.env.NODE_ENV = 'development';
    if (options.mock) process.env.MOCK_MODE = 'true';

    // Create configuration (reads from environment)
    const config = createConfig();

    // Log configuration summary in development mode
    logConfigSummaryIfDev(config);

    if (options.validate) {
      console.log('🔍 Validating Container Kit MCP configuration...\n');
      console.log('📋 Configuration Summary:');
      console.log(`  • Log Level: ${config.server.logLevel}`);
      console.log(`  • Workspace: ${config.workspace.workspaceDir}`);
      console.log(`  • Docker Socket: ${process.env.DOCKER_SOCKET || '/var/run/docker.sock'}`);
      console.log(`  • K8s Namespace: ${process.env.K8S_NAMESPACE || 'default'}`);
      console.log(`  • Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'enabled' : 'disabled'}`);
      console.log(`  • Environment: ${process.env.NODE_ENV || 'production'}`);

      // Test Docker connection if not in mock mode
      if (!options.mock) {
        console.log('\n🐳 Testing Docker connection...');
        try {
          execSync('docker version', { stdio: 'pipe' });
          console.log('  ✅ Docker connection successful');
        } catch (error) {
          console.log('  ⚠️  Docker connection failed - consider using --mock for testing');
        }
      }

      // Test Kubernetes connection
      console.log('\n☸️  Testing Kubernetes connection...');
      try {
        execSync('kubectl version --client=true', { stdio: 'pipe' });
        console.log('  ✅ Kubernetes client available');
      } catch (error) {
        console.log('  ⚠️  Kubernetes client not found - kubectl not in PATH');
      }

      logger.info('Configuration validation completed');
      console.log('\n✅ Configuration validation complete!');
      console.log('\nNext steps:');
      console.log('  • Start server: container-kit-mcp');
      console.log('  • List tools: container-kit-mcp --list-tools');
      console.log('  • Health check: container-kit-mcp --health-check');
      process.exit(0);
    }

    // Create server
    const server = new ContainerKitMCPServer(config);

    if (options.listTools) {
      logger.info('Listing available tools');
      await server.initialize();

      const toolList = await server.listTools();
      console.log('Available tools:');
      console.log('═'.repeat(60));

      if ('tools' in toolList && Array.isArray(toolList.tools)) {
        const toolsByCategory = toolList.tools.reduce((acc: Record<string, any[]>, tool: any) => {
          const category = tool.category || 'utility';
          if (!acc[category]) acc[category] = [];
          acc[category]!.push(tool);
          return acc;
        }, {});

        for (const [category, tools] of Object.entries(toolsByCategory)) {
          console.log(`\n📁 ${category.toUpperCase()}`);
          (tools as Array<{ name: string; description: string }>).forEach((tool) => {
            console.log(`  • ${tool.name.padEnd(25)} ${tool.description}`);
          });
        }

        console.log(`\nTotal: ${toolList.tools.length} tools available`);
      }

      server.shutdown();
      process.exit(0);
    }

    if (options.healthCheck) {
      logger.info('Performing health check');
      await server.initialize();

      const health = await server.getHealth();

      console.log('🏥 Health Check Results');
      console.log('═'.repeat(40));
      console.log(`Status: ${health.status === 'healthy' ? '✅ Healthy' : '❌ Unhealthy'}`);
      console.log(`Uptime: ${Math.floor(health.uptime)}s`);
      console.log('\nServices:');

      for (const [service, status] of Object.entries(health.services)) {
        const icon = status ? '✅' : '❌';
        console.log(`  ${icon} ${service}`);
      }

      if (health.metrics) {
        console.log('\nMetrics:');
        for (const [metric, value] of Object.entries(health.metrics)) {
          console.log(`  📊 ${metric}: ${String(value)}`);
        }
      }

      server.shutdown();
      process.exit(health.status === 'healthy' ? 0 : 1);
    }

    logger.info({
      config: {
        logLevel: config.server.logLevel,
        workspace: config.workspace.workspaceDir,
        mockMode: options.mock,
        devMode: options.dev,
      },
    }, 'Starting Container Kit MCP Server');

    console.log('🚀 Starting Container Kit MCP Server...');
    console.log(`📦 Version: ${packageJson.version}`);
    console.log(`🏠 Workspace: ${config.workspace.workspaceDir}`);
    console.log(`📊 Log Level: ${config.server.logLevel}`);

    if (options.mock) {
      console.log('🤖 Running with mock AI sampler');
    }

    if (options.dev) {
      console.log('🔧 Development mode enabled');
    }

    await server.start();

    console.log('✅ Server started successfully');
    console.log('🔌 Listening on stdio transport');

    const shutdown = (signal: string): void => {
      logger.info({ signal }, 'Shutting down');
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

      try {
        server.shutdown();
        console.log('✅ Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Shutdown error');
        console.error('❌ Shutdown error:', error);
        exit(1);
      }
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Server startup failed');
    console.error('❌ Server startup failed');

    if (error instanceof Error) {
      console.error(`\n🔍 Error: ${error.message}`);

      // Provide specific troubleshooting guidance
      if (error.message.includes('Docker') || error.message.includes('ENOENT')) {
        console.error('\n💡 Docker-related issue detected:');
        console.error('  • Ensure Docker Desktop is running');
        console.error('  • Check Docker socket path: --docker-socket <path>');
        console.error('  • Try mock mode for testing: --mock');
        console.error('  • Verify Docker installation: docker version');
      }

      if (error.message.includes('EADDRINUSE')) {
        console.error('\n💡 Port already in use:');
        console.error('  • Try a different port: --port <number>');
        console.error('  • Check running processes: lsof -i :<port>');
        console.error('  • Use stdio transport (default) instead of HTTP');
      }

      if (error.message.includes('permission') || error.message.includes('EACCES')) {
        console.error('\n💡 Permission issue detected:');
        console.error('  • Check file/directory permissions');
        console.error('  • Ensure workspace is readable: --workspace <path>');
        console.error('  • Try running with appropriate permissions');
      }

      if (error.message.includes('config') || error.message.includes('Config')) {
        console.error('\n💡 Configuration issue:');
        console.error('  • Copy .env.example to .env');
        console.error('  • Validate config: --validate');
        console.error('  • Check config file path: --config <path>');
      }

      console.error('\n🛠️ Troubleshooting steps:');
      console.error('  1. Run health check: container-kit-mcp --health-check');
      console.error('  2. Validate config: container-kit-mcp --validate');
      console.error('  3. Try mock mode: container-kit-mcp --mock');
      console.error('  4. Enable debug logging: --log-level debug');
      console.error('  5. Check the documentation: docs/TROUBLESHOOTING.md');

      if (error.stack && options.dev) {
        console.error(`\n📍 Stack trace (dev mode):`);
        console.error(error.stack);
      } else if (!options.dev) {
        console.error('\n💡 For detailed error information, use --dev flag');
      }
    }

    exit(1);
  }
}

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in CLI');
  console.error('❌ Uncaught exception:', error);
  exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled rejection in CLI');
  console.error('❌ Unhandled rejection:', reason);
  exit(1);
});

// Run the CLI
void main();

